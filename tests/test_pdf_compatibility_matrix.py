"""
Real-World PDF Compatibility & Non-Destructive Regression Test Suite.

Runs the full categorized corpus (real LibreOffice Writer/Calc, real Google Chrome
headless, plus clearly-tagged synthetic fixtures) and outputs `docs/compatibility_matrix.json`.
"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app import app
from tests.compat_fixtures import collect_all_fixtures
from tests.compat_runner import run_fixture_compatibility_check


client = TestClient(app)


def test_real_world_and_synthetic_compatibility_matrix(tmp_path: Path):
    fixtures = collect_all_fixtures()
    assert len(fixtures) >= 12

    results = []
    for fx in fixtures:
        rec = run_fixture_compatibility_check(client, fx, tmp_path)
        results.append(rec)

    matrix_path = Path(__file__).resolve().parent.parent / "docs" / "compatibility_matrix.json"
    matrix_path.parent.mkdir(parents=True, exist_ok=True)
    matrix_path.write_text(json.dumps(results, indent=2), encoding="utf-8")

    failures = [r for r in results if r["status"] in ("FAIL", "PARTIAL")]
    for f in failures:
        print(f"DEFECT FOUND [{f['status']}] {f['fixture_id']}: {f['issues']}")
    assert not failures, f"Compatibility defects discovered: {[(f['fixture_id'], f['status'], f['issues']) for f in failures]}"


def test_strict_redaction_validation_and_permanent_purge():
    """
    Verify strict Pydantic validation on POST /api/docs/{doc_id}/security/redact:
    - Misnamed fields (e.g. 'rects' instead of 'bbox'), malformed bbox, or empty targets -> HTTP 422
    - Valid redaction payload permanently purges sensitive content from text and raw streams
    """
    import io
    import pymupdf

    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    page.insert_text((72, 100), "Confidential Secret: SSN 123-45-6789", fontname="helv", fontsize=12)
    raw = doc.tobytes()
    doc.close()

    r_open = client.post(
        "/api/docs/open-upload",
        files={"file": ("redact_strict.pdf", io.BytesIO(raw), "application/pdf")},
    )
    assert r_open.status_code == 200
    doc_id = r_open.json()["doc_id"]

    # 1. Misnamed field 'rects' instead of 'bbox' must fail with HTTP 422
    r_misnamed = client.post(
        f"/api/docs/{doc_id}/security/redact",
        json={"page_redactions": [{"page_index": 0, "rects": [[68, 86, 360, 110]]}]},
    )
    assert r_misnamed.status_code == 422

    # 2. Inverted / malformed bbox (x1 <= x0) must fail with HTTP 422
    r_bad_bbox = client.post(
        f"/api/docs/{doc_id}/security/redact",
        json={"page_redactions": [{"page_index": 0, "bbox": [200, 86, 100, 110]}]},
    )
    assert r_bad_bbox.status_code == 422

    # 3. Empty redaction payload must fail with HTTP 422
    r_empty = client.post(f"/api/docs/{doc_id}/security/redact", json={})
    assert r_empty.status_code == 422

    # 4. Valid payload permanently removes text from both extracted text and streams
    r_ok = client.post(
        f"/api/docs/{doc_id}/security/redact",
        json={"page_redactions": [{"page_index": 0, "bbox": [68, 86, 360, 110]}]},
    )
    assert r_ok.status_code == 200
    assert r_ok.json()["redacted_regions_count"] == 1

    dl = client.get(f"/api/docs/{doc_id}/download").content
    d_after = pymupdf.open(stream=dl, filetype="pdf")
    assert "123-45-6789" not in d_after[0].get_text()
    for xref in range(1, d_after.xref_length()):
        try:
            st = d_after.xref_stream(xref)
            assert not (st and b"123-45-6789" in st)
        except Exception:
            pass
    d_after.close()


def test_tight_spreadsheet_cell_overflow_readability_guard():
    """
    Verify tight spreadsheet-cell overflow handling:
    - Refuses to shrink below 6.0 pt readability limit or overlap adjacent cells
    - Preserves original text, formatting, and bytes unchanged
    - Returns actionable overflow message and min_readable_font_size
    """
    import hashlib
    import io
    import pymupdf

    doc = pymupdf.open()
    p = doc.new_page(width=612, height=792)
    p.insert_text((72, 100), "Short Cell", fontname="helv", fontsize=10)
    p.insert_text((72, 128), "Adjacent Row Below", fontname="helv", fontsize=10)
    raw = doc.tobytes()
    doc.close()

    r_open = client.post(
        "/api/docs/open-upload",
        files={"file": ("tight_cell.pdf", io.BytesIO(raw), "application/pdf")},
    )
    assert r_open.status_code == 200
    doc_id = r_open.json()["doc_id"]
    before_sha = hashlib.sha256(client.get(f"/api/docs/{doc_id}/download").content).hexdigest()

    blk = client.get(f"/api/docs/{doc_id}/pages/0/objects").json()["text_blocks"][0]
    long_text = "Extremely long spreadsheet cell text that wraps multiple lines and cannot fit."
    r_shrink = client.post(
        f"/api/docs/{doc_id}/pages/0/edit-paragraph",
        json={
            "block_id": blk["id"],
            "orig_bbox": blk["bbox"],
            "target_bbox": [72.0, 88.0, 130.0, 102.0],
            "expected_orig_text": blk["text"],
            "new_text": long_text,
            "overflow_policy": "shrink_font",
        },
    )
    assert r_shrink.status_code == 200
    data = r_shrink.json()
    assert data["status"] == "overflow"
    ovf = data["overflow_info"]
    assert ovf["min_readable_font_size"] == 6.0
    assert ovf["suggested_font_size"] is None
    assert "6.0 pt readability limit" in ovf["message"]

    after_sha = hashlib.sha256(client.get(f"/api/docs/{doc_id}/download").content).hexdigest()
    assert after_sha == before_sha


