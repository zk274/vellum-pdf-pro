"""Regression & quality-scoring tests for Stage A/B/C Hybrid Scanned Form Detection."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Dict, List

import pymupdf
import pypdfium2 as pdfium
from fastapi.testclient import TestClient

from backend.app import app
from backend.engine.forms_signatures import detect_form_field_candidates_detailed

client = TestClient(app)

NSD_FIXTURE = Path("tests/fixtures/NNSDFILLABLEAPP (1).pdf")
W9_FIXTURE = Path("tests/fixtures/W9 Form - March 2024 (1) (3) (1).pdf")
EXPECTED_NSD_SHA256 = "a7a56cc0536e4476b6a3e7c27bb81a6bcb4deb09f7c77c19252759f70bd9973e"
EXPECTED_W9_SHA256 = "2d420cbb4123dcf1fb82595b2359cfbb5d81f00b9df9d359fcc7af361d093f53"
OUTPUT_DIR = Path("tests/output")


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_w9_existing_acroform_preserved_and_zero_duplicates():
    """W-9 Page 1 has 23 existing AcroForm widgets; hybrid detector must emit 0 duplicates across all 6 pages."""
    assert W9_FIXTURE.exists()
    assert _sha256(W9_FIXTURE) == EXPECTED_W9_SHA256
    w9_bytes = W9_FIXTURE.read_bytes()

    r0 = detect_form_field_candidates_detailed(w9_bytes, page_index=0)
    assert r0["existing_widgets_count"] == 23
    assert r0["detection_mode"] == "existing_acroform"
    assert len(r0["candidates"]) == 0

    for p in range(1, 6):
        rp = detect_form_field_candidates_detailed(w9_bytes, page_index=p)
        assert rp["existing_widgets_count"] == 0
        assert len(rp["candidates"]) == 0

    assert _sha256(W9_FIXTURE) == EXPECTED_W9_SHA256


def test_nsd_16page_manifest_scoring_conversion_fill_save_reopen():
    """Score NSD 16-page hybrid detection (OCR + geometry), convert, fill, save separately, and reopen."""
    assert NSD_FIXTURE.exists()
    assert _sha256(NSD_FIXTURE) == EXPECTED_NSD_SHA256

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    fillable_out = OUTPUT_DIR / "NNSDFILLABLEAPP_fillable.pdf"

    with NSD_FIXTURE.open("rb") as fh:
        open_res = client.post(
            "/api/docs/open-upload",
            files={"file": ("NNSDFILLABLEAPP (1).pdf", fh, "application/pdf")},
        )
    assert open_res.status_code == 200
    doc_id = open_res.json()["doc_id"]

    # Scan key representative pages via API (image-based p1, p2, p3; dense contract p5; vector p7; ACH p14; ACORD p15; rate table p16)
    page_reports: Dict[int, Dict] = {}
    used_names: List[str] = []
    for p_idx in [0, 1, 2, 4, 6, 13, 14, 15]:
        res = client.post(
            f"/api/docs/{doc_id}/forms/detect-candidates",
            json={"page_index": p_idx, "used_names": used_names},
        )
        assert res.status_code == 200, res.text
        data = res.json()
        page_reports[p_idx] = data
        for c in data["candidates"]:
            if c["field_name"] not in used_names:
                used_names.append(c["field_name"])

    # Page 1: image-based, 0 native chars -> must detect business info & Yes/No candidates
    p1_cands = page_reports[0]["candidates"]
    assert page_reports[0]["detection_mode"] == "ocr"
    assert len(p1_cands) >= 25
    p1_names = " ".join(c["field_name"] for c in p1_cands)
    for kw in ("legal_business_name", "business_address", "city", "state", "zip", "owner_name"):
        assert kw in p1_names, f"Missing expected NSD p1 keyword '{kw}'"

    # Page 2: checkboxes + Yes/No radio groups + fleet lines
    p2_cands = page_reports[1]["candidates"]
    assert page_reports[1]["detection_mode"] == "ocr"
    assert len(p2_cands) >= 40
    assert any(c["field_type"] in ("checkbox", "radiobutton") for c in p2_cands)

    # Page 3: service area checkboxes + comments/acknowledgement
    assert len(page_reports[2]["candidates"]) >= 6

    # Page 5: dense contract prose -> 0 false positives
    assert len(page_reports[4]["candidates"]) == 0

    # Page 7: vector-outlined signature block -> 6 signature/name/title fields
    assert len(page_reports[6]["candidates"]) >= 4

    # Page 14: ACH banking form
    p14_names = " ".join(c["field_name"] for c in page_reports[13]["candidates"])
    assert "company_name" in p14_names
    assert "depository_name" in p14_names

    # Page 15: miniature ACORD 25 example thumbnail -> 0 false positives
    assert len(page_reports[14]["candidates"]) == 0

    # Page 16: landscape rate table -> geometry candidates
    assert len(page_reports[15]["candidates"]) >= 10

    # Convert Page 1 candidates into real AcroForm widgets
    for c in p1_cands:
        cr = client.post(
            f"/api/docs/{doc_id}/forms/create",
            json={
                "page_index": c["page_index"],
                "field_type": c["field_type"],
                "field_name": c["field_name"],
                "tooltip": c["label"],
                "bbox": c["bbox"],
                "multiline": c["field_type"] == "multiline",
                "font_size": 11.0,
                "font_name": "helv",
                "text_color_hex": "#000000",
                "fill_color_hex": "transparent",
                "border_color_hex": "transparent",
            },
        )
        assert cr.status_code == 200, cr.text

    # Fill key text fields with fictional sample data and save to separate _fillable.pdf
    fill_values = {
        "legal_business_name": "Example Roadside Recovery LLC",
        "doing_business_as_dba": "Example Towing",
        "business_address": "123 Example Boulevard",
        "city": "Exampleton",
        "state": "VA",
        "zip": "23451",
    }
    fill_res = client.post(
        f"/api/docs/{doc_id}/forms/fill",
        json={"page_index": 0, "values": fill_values, "auto_fit": True},
    )
    assert fill_res.status_code == 200

    save_res = client.post(
        f"/api/docs/{doc_id}/save",
        json={"target_path": str(fillable_out), "create_backup": False},
    )
    assert save_res.status_code == 200
    assert fillable_out.exists()

    # Reopen and verify with PyMuPDF & pypdfium2
    reopened = pymupdf.open(str(fillable_out))
    try:
        assert len(reopened) == 16
        w_map = {w.field_name: w for w in (reopened[0].widgets() or [])}
        assert len(w_map) >= 25
        assert w_map["legal_business_name"].field_value == "Example Roadside Recovery LLC"
        assert w_map["business_address"].field_value == "123 Example Boulevard"
        assert w_map["city"].field_value == "Exampleton"
    finally:
        reopened.close()

    pdfium_doc = pdfium.PdfDocument(str(fillable_out))
    try:
        assert len(pdfium_doc) == 16
        bmp = pdfium_doc[0].render(scale=1.2).to_pil()
        assert bmp.width > 700 and bmp.height > 900
    finally:
        pdfium_doc.close()

    # Original fixture MUST be byte-for-byte unchanged
    assert _sha256(NSD_FIXTURE) == EXPECTED_NSD_SHA256

