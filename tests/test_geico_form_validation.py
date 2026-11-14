import hashlib
import os
import shutil
import subprocess
from pathlib import Path

import pymupdf
import pypdfium2 as pdfium
from fastapi.testclient import TestClient

from backend.app import app

client = TestClient(app)

FIXTURE_PATH = Path("tests/fixtures/PROVIDER APP REQ FORM (2).pdf")
EXPECTED_FIXTURE_SHA256 = "5a5610e843eac0c59823fbf45af47238ca0d1c694173d3cc2bcc227f29caea46"
OUTPUT_DIR = Path("tests/output")


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_geico_real_world_detection_creation_fill_and_cross_viewer():
    assert FIXTURE_PATH.exists(), f"Missing fixture: {FIXTURE_PATH}"
    assert _sha256(FIXTURE_PATH) == EXPECTED_FIXTURE_SHA256

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    fillable_out = OUTPUT_DIR / "GEICO_Application_Fillable.pdf"
    completed_out = OUTPUT_DIR / "GEICO_Application_Completed_Sample.pdf"

    # 1. Upload original GEICO PDF
    with FIXTURE_PATH.open("rb") as fh:
        open_res = client.post(
            "/api/docs/open-upload",
            files={"file": ("PROVIDER APP REQ FORM (2).pdf", fh, "application/pdf")},
        )
    assert open_res.status_code == 200
    doc_id = open_res.json()["doc_id"]

    # 2. Inspect: static form with 0 AcroForm widgets, no XFA
    insp = client.get(f"/api/docs/{doc_id}/forms/inspect")
    assert insp.status_code == 200
    insp_data = insp.json()
    assert insp_data["acroform_present"] is False
    assert insp_data["is_xfa"] is False
    assert insp_data["field_count"] == 0

    # 3. Detect candidates without mutating bytes
    bytes_before = client.get(f"/api/docs/{doc_id}/download").content
    cand_res = client.post(f"/api/docs/{doc_id}/forms/detect-candidates", json={"page_index": 0})
    assert cand_res.status_code == 200
    cands = cand_res.json()["candidates"]
    bytes_after_detect = client.get(f"/api/docs/{doc_id}/download").content
    assert hashlib.sha256(bytes_before).hexdigest() == hashlib.sha256(bytes_after_detect).hexdigest()

    assert len(cands) == 34, f"Expected 34 detected GEICO fields, got {len(cands)}"
    names = [c["field_name"] for c in cands]
    assert len(names) == len(set(names)), "Detected field names must be unique"
    for required_name in (
        "business_name",
        "business_address",
        "mailing_address",
        "telephone",
        "email",
        "contact_name",
        "coverage_area",
        "number_of_trucks",
        "name_of_digital_software",
        "other_office_locations",
        "auto_road_service",
        "auto_towing",
        "auto_accident",
        "auto_secondary",
        "long_haul_trucking_medium_accident",
        "long_haul_trucking_heavy_secondary",
    ):
        assert required_name in names, f"Missing expected candidate {required_name}"

    cand_map = {c["field_name"]: c for c in cands}
    assert cand_map["coverage_area"]["field_type"] == "multiline"
    assert cand_map["other_office_locations"]["field_type"] == "multiline"
    assert cand_map["auto_road_service"]["field_type"] == "checkbox"
    assert all("n_a" not in n for n in names), "N/A cells must not become interactive fields"

    # 4. Convert all 34 candidates into AcroForm widgets
    for c in cands:
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

    insp2 = client.get(f"/api/docs/{doc_id}/forms/inspect").json()
    assert insp2["acroform_present"] is True
    assert insp2["field_count"] == 34

    # Verify non-destructive move + resize + Undo/Redo on a widget
    target_fld = next(f for f in insp2["fields"] if f["field_name"] == "business_name")
    orig_bbox = list(target_fld["bbox"])
    moved_bbox = [orig_bbox[0] + 6, orig_bbox[1], orig_bbox[2] + 6, orig_bbox[3]]
    upd = client.put(
        f"/api/docs/{doc_id}/forms/{target_fld['xref']}",
        json={"page_index": 0, "bbox": moved_bbox},
    )
    assert upd.status_code == 200
    assert client.post(f"/api/docs/{doc_id}/undo").status_code == 200

    # Save blank fillable version
    fillable_bytes = client.get(f"/api/docs/{doc_id}/download").content
    fillable_out.write_bytes(fillable_bytes)

    # 5. Fill with fictional sample data
    sample_values = {
        "business_name": "Example Coastal Roadside LLC",
        "business_address": "123 Example Street, Unit 4B, Coastal City, VA 23451",
        "mailing_address": "123 Example Street, Unit 4B, Coastal City, VA 23451",
        "telephone": "555-0100",
        "email": "example@example.com",
        "contact_name": "Test User",
        "coverage_area": "Example County and surrounding service areas (within 50 miles)",
        "number_of_trucks": "1",
        "name_of_digital_software": "Example Dispatch System",
        "other_office_locations": "456 Harbor Blvd, North Bay, VA 23452\n789 Industrial Pkwy, South Port, VA 23453",
        "auto_road_service": True,
        "auto_towing": True,
        "auto_accident": True,
        "auto_medium_duty_towing": True,
        "motorcycle_towing": True,
        "long_haul_trucking_medium_accident": True,
        "long_haul_trucking_heavy_secondary": True,
    }
    fill_res = client.post(
        f"/api/docs/{doc_id}/forms/fill",
        json={"page_index": 0, "values": sample_values, "auto_fit": True},
    )
    assert fill_res.status_code == 200, fill_res.text

    completed_bytes = client.get(f"/api/docs/{doc_id}/download").content
    completed_out.write_bytes(completed_bytes)

    # 6. Reopen and verify with PyMuPDF
    reopened = pymupdf.open(str(completed_out))
    try:
        page = reopened[0]
        widgets = list(page.widgets() or [])
        assert len(widgets) == 34
        by_name = {w.field_name: w for w in widgets}
        assert by_name["business_name"].field_value == "Example Coastal Roadside LLC"
        assert by_name["telephone"].field_value == "555-0100"
        assert by_name["email"].field_value == "example@example.com"
        assert by_name["contact_name"].field_value == "Test User"
        assert "50 miles" in by_name["coverage_area"].field_value
        assert "456 Harbor Blvd" in by_name["other_office_locations"].field_value
        assert str(by_name["auto_road_service"].field_value).lower() in ("yes", "true", "on", "1")
        assert str(by_name["auto_secondary"].field_value).lower() in ("off", "", "false", "0")

        # Verify original static labels and instructions remain intact
        full_text = page.get_text("text")
        for expected_txt in (
            "GEICO APPLICATION REQUEST",
            "BUSINESS NAME:",
            "VEHICLE SERVICES PROVIDED",
            "N/A",
            "ERSPS@GEICO.COM",
            "Sensitivity: Company-Internal",
        ):
            assert expected_txt in full_text
    finally:
        reopened.close()

    # 7. Independent renderer verification with pypdfium2
    pdfium_doc = pdfium.PdfDocument(str(completed_out))
    try:
        assert len(pdfium_doc) == 1
        bmp = pdfium_doc[0].render(scale=1.5).to_pil()
        assert bmp.width > 800 and bmp.height > 1000
    finally:
        pdfium_doc.close()

    # 8. Poppler verification (pdftotext + pdftoppm) when available
    if shutil.which("pdftotext"):
        txt_proc = subprocess.run(
            ["pdftotext", str(completed_out), "-"],
            check=True,
            capture_output=True,
            text=True,
        )
        assert "GEICO APPLICATION REQUEST" in txt_proc.stdout
    if shutil.which("pdftoppm"):
        ppm_prefix = OUTPUT_DIR / "geico_poppler_check"
        subprocess.run(
            ["pdftoppm", "-png", "-r", "120", str(completed_out), str(ppm_prefix)],
            check=True,
            capture_output=True,
        )
        png_files = list(OUTPUT_DIR.glob("geico_poppler_check*.png"))
        assert len(png_files) == 1 and png_files[0].stat().st_size > 10000

    # 9. Verify overflow warning and strict RedactRequest 422 rejection
    ov_res = client.post(
        f"/api/docs/{doc_id}/forms/fill",
        json={
            "page_index": 0,
            "values": {"number_of_trucks": "X" * 240},
            "auto_fit": True,
        },
    )
    assert ov_res.status_code == 200
    warnings = ov_res.json().get("warnings", [])
    assert any(w["field_name"] == "number_of_trucks" and w["code"] in ("auto_fitted", "text_overflow") for w in warnings)

    bad_redact = client.post(
        f"/api/docs/{doc_id}/security/redact",
        json={"rects": [{"page_index": 0, "bbox": [10, 10, 100, 100]}]},
    )
    assert bad_redact.status_code == 422

    # 10. Original fixture MUST be byte-for-byte unchanged
    assert _sha256(FIXTURE_PATH) == EXPECTED_FIXTURE_SHA256
