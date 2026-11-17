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
from tests.nsd_expected_manifest import (
    NSD_EXPECTED_PAGE_SUMMARY,
    PAGE_2_EXPECTED,
    evaluate_page_against_expected,
)

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

    # Scan all 16 pages via API
    page_reports: Dict[int, Dict] = {}
    used_names: List[str] = []
    for p_idx in range(16):
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

    # Page 1: image-based, 0 native chars -> 25 text + 14 radiobuttons (7 Yes/No pairs) = 39
    p1_cands = page_reports[0]["candidates"]
    assert page_reports[0]["detection_mode"] == "ocr"
    assert len(p1_cands) == 39, f"Expected 39 fields on p1, got {len(p1_cands)}"
    assert sum(1 for c in p1_cands if c["field_type"] == "radiobutton") == 14
    assert sum(1 for c in p1_cands if c["field_type"] == "text") == 25
    p1_names = " ".join(c["field_name"] for c in p1_cands)
    for kw in ("legal_business_name", "business_address", "city", "state", "zip", "owner_name"):
        assert kw in p1_names, f"Missing expected NSD p1 keyword '{kw}'"

    # Page 2: independent 71-field expected manifest evaluation (18 radios + 40 checkboxes + 13 text)
    p2_cands = page_reports[1]["candidates"]
    assert page_reports[1]["detection_mode"] == "ocr"
    p2_metrics = evaluate_page_against_expected(p2_cands, PAGE_2_EXPECTED)
    assert p2_metrics["expected"] == 71
    assert p2_metrics["detected"] == 71, f"P2 metrics: {p2_metrics}"
    assert p2_metrics["true_positives"] == 71, f"P2 metrics: {p2_metrics}"
    assert p2_metrics["false_negatives"] == 0, f"P2 metrics: {p2_metrics}"
    assert p2_metrics["false_positives"] == 0, f"P2 metrics: {p2_metrics}"
    assert p2_metrics["incorrect_types"] == 0, f"P2 metrics: {p2_metrics}"
    assert p2_metrics["duplicates"] == 0, f"P2 metrics: {p2_metrics}"
    assert p2_metrics["precision"] == 1.0 and p2_metrics["recall"] == 1.0

    # Verify per-page type summary across all 16 pages
    for p_idx, exp_summary in NSD_EXPECTED_PAGE_SUMMARY.items():
        cands = page_reports[p_idx]["candidates"]
        assert len(cands) == exp_summary["total"], f"P{p_idx+1}: expected {exp_summary['total']}, got {len(cands)}"
        for ftype, exp_n in exp_summary.items():
            if ftype == "total":
                continue
            got_n = sum(1 for c in cands if c["field_type"] == ftype)
            assert got_n == exp_n, f"P{p_idx+1} {ftype}: expected {exp_n}, got {got_n}"

    # Page 4: 4 genuine opening-paragraph blanks (day, month, year, provider name), 0 prose false positives
    p4_cands = page_reports[3]["candidates"]
    assert len(p4_cands) == 4, f"Expected 4 blanks on p4, got {len(p4_cands)}: {[c['field_name'] for c in p4_cands]}"
    p4_names = {c["field_name"] for c in p4_cands}
    assert {"effective_day", "effective_month", "effective_year", "provider_name"} <= p4_names

    # Page 5, 6, 8, 9, 10, 11: dense contract prose -> 0 false positives
    for prose_idx in (4, 5, 7, 8, 9, 10):
        assert len(page_reports[prose_idx]["candidates"]) == 0, f"False positive on p{prose_idx+1}: {page_reports[prose_idx]['candidates']}"

    # Page 7: vector-outlined signature block -> 6 signature/name/title fields
    assert len(page_reports[6]["candidates"]) == 6

    # Page 12: 5 "(Initial)" fields detected, zero digit false positives
    p12_cands = page_reports[11]["candidates"]
    assert len(p12_cands) == 5, f"Expected 5 initial fields on p12, got {len(p12_cands)}"
    assert all("initial" in c["field_name"] for c in p12_cands)
    assert all(c["field_type"] == "text" for c in p12_cands)

    # Page 13: 4 signature/title fields, zero Roman-numeral false positives
    assert len(page_reports[12]["candidates"]) == 4

    # Page 14: ACH banking form (13 fields, no bottom artifact)
    p14_cands = page_reports[13]["candidates"]
    assert len(p14_cands) == 13
    p14_names = " ".join(c["field_name"] for c in p14_cands)
    assert "company_name" in p14_names
    assert "depository_name" in p14_names
    assert "field_1" not in p14_names

    # Page 15: miniature ACORD 25 example thumbnail -> 0 false positives
    assert len(page_reports[14]["candidates"]) == 0

    # Page 16: landscape rate table -> 121 clean cells (Name of Business + 110 rate cells + 10 Initials)
    p16_cands = page_reports[15]["candidates"]
    assert len(p16_cands) == 121, f"Expected 121 cells on p16, got {len(p16_cands)}"
    assert all((c["bbox"][2] - c["bbox"][0]) <= 200 for c in p16_cands if "electric_js" in c["field_name"])
    logo_r = pymupdf.Rect(50.4, 57.7, 240.3, 92.9)
    p16_rects = [pymupdf.Rect(c["bbox"]) for c in p16_cands]
    assert all((r & logo_r).is_empty for r in p16_rects), "Page 16 field overlaps NSD logo"
    for a in range(len(p16_rects)):
        for b in range(a + 1, len(p16_rects)):
            inter = p16_rects[a] & p16_rects[b]
            assert inter.is_empty or inter.get_area() <= 0.5, f"Page 16 cell overlap: {p16_cands[a]['field_name']} vs {p16_cands[b]['field_name']}"

    # Convert Page 1, Page 4, and Page 12 candidates into real AcroForm widgets
    for c in p1_cands + p4_cands + p12_cands:
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

    p4_fill = {
        "effective_day": "17",
        "effective_month": "November",
        "effective_year": "26",
        "provider_name": "Example Roadside Recovery LLC",
    }
    assert client.post(f"/api/docs/{doc_id}/forms/fill", json={"page_index": 3, "values": p4_fill, "auto_fit": True}).status_code == 200

    p12_fill = {c["field_name"]: f"ER{idx}" for idx, c in enumerate(p12_cands, start=1)}
    assert client.post(f"/api/docs/{doc_id}/forms/fill", json={"page_index": 11, "values": p12_fill, "auto_fit": True}).status_code == 200

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
        w_map_p4 = {w.field_name: w.field_value for w in (reopened[3].widgets() or [])}
        for k, v in p4_fill.items():
            assert w_map_p4.get(k) == v, f"P4 field {k} expected {v!r}, got {w_map_p4.get(k)!r}"
        w_map_p12 = {w.field_name: w.field_value for w in (reopened[11].widgets() or [])}
        assert len(w_map_p12) == 5
        for k, v in p12_fill.items():
            assert w_map_p12.get(k) == v, f"P12 initial {k} expected {v!r}, got {w_map_p12.get(k)!r}"
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

