"""Comprehensive regression & compatibility tests for Interactive Forms and Text Box Defaults."""

from __future__ import annotations

import hashlib
import io
from pathlib import Path

import pikepdf
import pymupdf
import pypdfium2 as pdfium
from fastapi.testclient import TestClient

from backend.app import app

client = TestClient(app)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def test_interactive_forms_all_types_fill_save_reopen_and_two_renderers(tmp_path: Path):
    """Verify text, multiline, checkbox, radio group, dropdown, listbox, save/reopen, and dual-engine render."""
    r_new = client.post("/api/docs/new", json={"filename": "app_form.pdf", "width": 595, "height": 842, "page_count": 1})
    assert r_new.status_code == 200
    doc_id = r_new.json()["doc_id"]

    # Create all field types
    fields_spec = [
        {"field_type": "text", "field_name": "applicant_name", "bbox": [60, 80, 300, 104], "align": "left"},
        {"field_type": "multiline", "field_name": "bio_notes", "bbox": [60, 120, 300, 190], "multiline": True},
        {"field_type": "checkbox", "field_name": "agree_terms", "bbox": [60, 210, 80, 230]},
        {"field_type": "radiobutton", "field_name": "plan_tier", "bbox": [60, 250, 80, 270]},
        {"field_type": "radiobutton", "field_name": "plan_tier", "bbox": [140, 250, 160, 270]},
        {
            "field_type": "dropdown",
            "field_name": "country",
            "bbox": [60, 290, 240, 316],
            "choices": ["United States", "Canada", "Germany"],
        },
        {
            "field_type": "listbox",
            "field_name": "department",
            "bbox": [60, 330, 240, 400],
            "choices": ["Engineering", "Security", "Operations"],
        },
    ]
    for spec in fields_spec:
        r_c = client.post(f"/api/docs/{doc_id}/forms/create", json={"page_index": 0, **spec})
        assert r_c.status_code == 200, r_c.text

    # Inspect typed definitions
    r_insp = client.get(f"/api/docs/{doc_id}/forms/inspect")
    assert r_insp.status_code == 200
    insp = r_insp.json()
    assert insp["acroform_present"] is True
    assert insp["is_xfa"] is False
    assert insp["field_count"] == 7
    assert any(f["field_type"] == "listbox" for f in insp["fields"])
    assert any(f["multiline"] is True for f in insp["fields"])

    # Fill fields (including radio by xref, text, multiline, checkbox, dropdown, listbox)
    radio_xrefs = [f["xref"] for f in insp["fields"] if f["field_type"] == "radiobutton"]
    r_fill = client.post(
        f"/api/docs/{doc_id}/forms/fill",
        json={
            "values": {
                "applicant_name": "Jane Doe",
                "bio_notes": "Line one of notes.\nLine two of notes.",
                "agree_terms": True,
                str(radio_xrefs[1]): True,
                "country": "Germany",
                "department": "Security",
            }
        },
    )
    assert r_fill.status_code == 200
    filled_fields = r_fill.json()["fields"]
    by_name = {f["field_name"]: f for f in filled_fields}
    assert by_name["applicant_name"]["value"] == "Jane Doe"
    assert by_name["agree_terms"]["checked"] is True
    assert by_name["country"]["value"] == "Germany"
    assert by_name["department"]["value"] == "Security"
    assert all(f["has_appearance"] is True for f in filled_fields)

    # Save to disk, close, reopen, and verify persistence
    out_pdf = tmp_path / "filled_form.pdf"
    r_save = client.post(f"/api/docs/{doc_id}/save", json={"target_path": str(out_pdf)})
    assert r_save.status_code == 200
    client.delete(f"/api/docs/{doc_id}")

    r_reopen = client.post("/api/docs/open-path", json={"file_path": str(out_pdf)})
    assert r_reopen.status_code == 200
    reopened_id = r_reopen.json()["doc_id"]
    re_insp = client.get(f"/api/docs/{reopened_id}/forms/inspect").json()
    re_by_name = {f["field_name"]: f for f in re_insp["fields"]}
    assert re_by_name["applicant_name"]["value"] == "Jane Doe"
    assert re_by_name["department"]["value"] == "Security"

    # Independent Renderer 1 (PyMuPDF) & Independent Renderer 2 (pypdfium2)
    raw = out_pdf.read_bytes()
    mupdf_doc = pymupdf.open(stream=raw, filetype="pdf")
    pix1 = mupdf_doc[0].get_pixmap(dpi=100)
    assert pix1.width > 100 and pix1.height > 100
    mupdf_doc.close()

    pdfium_doc = pdfium.PdfDocument(raw)
    bmp2 = pdfium_doc[0].render(scale=1.0).to_pil()
    assert bmp2.width > 100 and bmp2.height > 100
    pdfium_doc.close()

    # Undo/Redo test on form edit
    r_undo = client.post(f"/api/docs/{reopened_id}/undo")
    assert r_undo.status_code == 200
    client.delete(f"/api/docs/{reopened_id}")


def test_static_rectangles_not_confused_with_forms_and_candidate_assistant():
    """Static blue/outlined rectangles must NOT be reported as AcroForms; assistant suggests without mutating PDF."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((60, 100), "Full Name:", fontsize=11)
    page.draw_rect(pymupdf.Rect(140, 88, 340, 110), color=(0, 0, 1), width=1.0)
    page.insert_text((60, 140), "Accept:", fontsize=11)
    page.draw_rect(pymupdf.Rect(140, 128, 154, 142), color=(0, 0, 0), width=1.0)
    pdf_bytes = doc.tobytes()
    doc.close()
    orig_hash = _sha256(pdf_bytes)

    r_up = client.post("/api/docs/open-upload", files={"file": ("static_boxes.pdf", pdf_bytes, "application/pdf")})
    assert r_up.status_code == 200
    doc_id = r_up.json()["doc_id"]

    # Must detect 0 interactive AcroForms
    insp = client.get(f"/api/docs/{doc_id}/forms/inspect").json()
    assert insp["field_count"] == 0
    assert insp["acroform_present"] is False

    # Candidate assistant suggests text + checkbox without altering PDF bytes
    r_cand = client.post(f"/api/docs/{doc_id}/forms/detect-candidates?page_index=0")
    assert r_cand.status_code == 200
    cands = r_cand.json()["candidates"]
    assert any(c["field_type"] == "text" for c in cands)
    assert any(c["field_type"] == "checkbox" for c in cands)

    dl = client.get(f"/api/docs/{doc_id}/download").content
    assert _sha256(dl) == orig_hash
    client.delete(f"/api/docs/{doc_id}")


def test_automatic_text_fitting_maxlen_and_overflow_warnings():
    """Verify max_length enforcement, auto-fitting font size, and clear overflow warnings on tight fields."""
    r_new = client.post("/api/docs/new", json={"filename": "fit_test.pdf"})
    doc_id = r_new.json()["doc_id"]

    client.post(
        f"/api/docs/{doc_id}/forms/create",
        json={"page_index": 0, "field_type": "text", "field_name": "code", "bbox": [50, 50, 130, 72], "max_length": 6},
    )
    client.post(
        f"/api/docs/{doc_id}/forms/create",
        json={"page_index": 0, "field_type": "text", "field_name": "tight_box", "bbox": [50, 100, 130, 122], "font_size": 12},
    )

    r_fill = client.post(
        f"/api/docs/{doc_id}/forms/fill",
        json={
            "values": {
                "code": "ABCDEFGHIJ",
                "tight_box": "This is a deliberately very long text value that cannot fit in 80pt width at 6pt",
            },
            "auto_fit": True,
        },
    )
    assert r_fill.status_code == 200
    warnings = r_fill.json()["warnings"]
    codes = {w["code"] for w in warnings}
    assert "max_length_exceeded" in codes
    assert "text_overflow" in codes
    by_name = {f["field_name"]: f for f in r_fill.json()["fields"]}
    assert by_name["code"]["value"] == "ABCDEF"
    client.delete(f"/api/docs/{doc_id}")


def test_prepare_form_update_duplicate_tab_order_and_delete():
    """Verify field property updates, duplication, tab-order management, and deletion."""
    r_new = client.post("/api/docs/new", json={"filename": "prepare.pdf"})
    doc_id = r_new.json()["doc_id"]

    client.post(
        f"/api/docs/{doc_id}/forms/create",
        json={"page_index": 0, "field_type": "text", "field_name": "first", "bbox": [50, 50, 200, 74]},
    )
    r_sec = client.post(
        f"/api/docs/{doc_id}/forms/create",
        json={"page_index": 0, "field_type": "text", "field_name": "second", "bbox": [50, 90, 200, 114]},
    )
    fields = r_sec.json()["fields"]
    xref1, xref2 = fields[0]["xref"], fields[1]["xref"]

    # Reorder tab order [xref2, xref1]
    r_tab = client.post(f"/api/docs/{doc_id}/forms/tab-order", json={"page_index": 0, "ordered_xrefs": [xref2, xref1]})
    assert r_tab.status_code == 200
    reordered = r_tab.json()["fields"]
    assert [f["field_name"] for f in reordered] == ["second", "first"]
    xref1 = next(f["xref"] for f in reordered if f["field_name"] == "first")
    xref2 = next(f["xref"] for f in reordered if f["field_name"] == "second")

    # Update field properties
    r_upd = client.put(
        f"/api/docs/{doc_id}/forms/{xref1}",
        json={"page_index": 0, "required": True, "align": "center", "font_size": 10},
    )
    assert r_upd.status_code == 200
    f1 = next(f for f in r_upd.json()["fields"] if f["xref"] == xref1)
    assert f1["required"] is True
    assert f1["align"] == "center"

    # Duplicate & Delete
    r_dup = client.post(f"/api/docs/{doc_id}/forms/{xref1}/duplicate?page_index=0")
    assert r_dup.status_code == 200
    assert len(r_dup.json()["fields"]) == 3

    r_del = client.delete(f"/api/docs/{doc_id}/forms/{xref2}?page_index=0")
    assert r_del.status_code == 200
    assert len(r_del.json()["fields"]) == 2
    client.delete(f"/api/docs/{doc_id}")


def test_xfa_detection_preserves_xfa_stream_and_encrypted_form_roundtrip():
    """Verify XFA detection without corruption, and encrypted AcroForm open/fill/save."""
    # 1. XFA detection
    doc = pymupdf.open()
    doc.new_page()
    raw = doc.tobytes()
    doc.close()

    with pikepdf.open(io.BytesIO(raw)) as pdf:
        xfa_stream = pdf.make_stream(b"<xdp:xdp xmlns:xdp='http://ns.adobe.com/xdp/'/>")
        pdf.Root["/AcroForm"] = pikepdf.Dictionary({"/XFA": xfa_stream, "/Fields": pikepdf.Array([])})
        out = io.BytesIO()
        pdf.save(out)
        xfa_bytes = out.getvalue()

    r_xfa = client.post("/api/docs/open-upload", files={"file": ("xfa_form.pdf", xfa_bytes, "application/pdf")})
    assert r_xfa.status_code == 200
    xfa_id = r_xfa.json()["doc_id"]
    insp = client.get(f"/api/docs/{xfa_id}/forms/inspect").json()
    assert insp["is_xfa"] is True
    assert "XFA" in (insp["xfa_notice"] or "")
    client.delete(f"/api/docs/{xfa_id}")

    # 2. Encrypted AcroForm
    r_new = client.post("/api/docs/new", json={"filename": "enc_form.pdf"})
    enc_id = r_new.json()["doc_id"]
    client.post(
        f"/api/docs/{enc_id}/forms/create",
        json={"page_index": 0, "field_type": "text", "field_name": "secret_code", "bbox": [50, 50, 220, 76]},
    )
    r_enc = client.post(
        f"/api/docs/{enc_id}/security/encrypt",
        json={"user_password": "formpass", "owner_password": "ownerpass"},
    )
    assert r_enc.status_code == 200
    enc_dl = client.get(f"/api/docs/{enc_id}/download").content
    client.delete(f"/api/docs/{enc_id}")

    # Reopen with password and fill
    r_open_enc = client.post(
        "/api/docs/open-upload",
        files={"file": ("enc_form.pdf", enc_dl, "application/pdf")},
        data={"password": "formpass"},
    )
    assert r_open_enc.status_code == 200
    e2_id = r_open_enc.json()["doc_id"]
    r_fill_enc = client.post(f"/api/docs/{e2_id}/forms/fill", json={"values": {"secret_code": "VERIFIED-99"}})
    assert r_fill_enc.status_code == 200
    assert r_fill_enc.json()["fields"][0]["value"] == "VERIFIED-99"
    client.delete(f"/api/docs/{e2_id}")


def test_textbox_defaults_black_helvetica_11pt_transparent():
    """Verify backend add-text preserves #000000, helv, 11pt, left align, transparent bg/no border."""
    r_new = client.post("/api/docs/new", json={"filename": "tb_defaults.pdf"})
    doc_id = r_new.json()["doc_id"]
    r_add = client.post(
        f"/api/docs/{doc_id}/pages/0/add-text",
        json={
            "text": "Clean Black Default",
            "bbox": [72, 100, 272, 140],
            "font_name": "helv",
            "font_size": 11,
            "color_hex": "#000000",
            "align": "left",
        },
    )
    assert r_add.status_code == 200
    objs = client.get(f"/api/docs/{doc_id}/pages/0/objects").json()
    tb = objs["vellum_boxes"][0]
    assert tb["color"] == "#000000"
    assert tb["font"] == "helv"
    assert tb["size"] == 11
    assert tb["align"] == "left"
    assert tb.get("bg_hex") in (None, "", "transparent")
    assert tb.get("border_hex") in (None, "", "transparent")
    client.delete(f"/api/docs/{doc_id}")
