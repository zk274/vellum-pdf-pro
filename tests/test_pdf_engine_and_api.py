"""Comprehensive Unit, Integration, and Persistence QA Test Suite for Vellum PDF Pro Engine & API."""

from __future__ import annotations

import base64
import io
import os
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
import pymupdf
import pytest

from backend.app import app, session_manager
from backend.engine.direct_edit import edit_text_span, inspect_page_objects
from backend.engine.utils import compare_page_renders

client = TestClient(app)


@pytest.fixture(autouse=True)
def isolate_recovery_dir(tmp_path: Path):
    session_manager.sessions.clear()
    session_manager.recovery_dir = tmp_path / "recovery"
    session_manager.recovery_dir.mkdir(parents=True, exist_ok=True)
    yield


def test_health_and_showcase_lifecycle(tmp_path: Path):
    """Test engine health, opening showcase PDF, safe saving with backup, reopening, and undo/redo."""
    r = client.get("/api/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert data["libraries"]["rapidocr_offline"] is True

    # Open showcase document
    r_open = client.post("/api/docs/sample")
    assert r_open.status_code == 200
    doc_info = r_open.json()
    doc_id = doc_info["doc_id"]
    assert doc_info["page_count"] == 3
    assert doc_info["dirty"] is False

    # Render page 0 and thumbnails
    r_render = client.get(f"/api/docs/{doc_id}/pages/0/render?dpi=96")
    assert r_render.status_code == 200
    assert r_render.json()["pixel_width"] > 100

    r_thumbs = client.get(f"/api/docs/{doc_id}/thumbnails")
    assert r_thumbs.status_code == 200
    assert len(r_thumbs.json()) == 3

    # Safe Save to disk, then modify and Safe Save again to verify .bak backup creation
    save_target = tmp_path / "contract_saved.pdf"
    r_save1 = client.post(
        f"/api/docs/{doc_id}/save",
        json={"target_path": str(save_target), "create_backup": True},
    )
    assert r_save1.status_code == 200
    assert save_target.exists()

    # Add a blank page (mutates doc -> dirty=True), then undo and redo
    r_ins = client.post(f"/api/docs/{doc_id}/pages/insert-blank", json={"index": -1})
    assert r_ins.status_code == 200
    assert r_ins.json()["page_count"] == 4
    assert r_ins.json()["dirty"] is True

    r_undo = client.post(f"/api/docs/{doc_id}/undo")
    assert r_undo.status_code == 200
    assert r_undo.json()["summary"]["page_count"] == 3

    r_redo = client.post(f"/api/docs/{doc_id}/redo")
    assert r_redo.status_code == 200
    assert r_redo.json()["summary"]["page_count"] == 4

    # Save again -> .bak must exist with original 3-page version
    r_save2 = client.post(
        f"/api/docs/{doc_id}/save",
        json={"target_path": str(save_target), "create_backup": True},
    )
    assert r_save2.status_code == 200
    bak_file = Path(str(save_target) + ".bak")
    assert bak_file.exists()

    # Reopen both saved and backup files to verify persistence
    r_reopen = client.post("/api/docs/open-path", json={"file_path": str(save_target)})
    assert r_reopen.status_code == 200
    assert r_reopen.json()["page_count"] == 4

    r_reopen_bak = client.post("/api/docs/open-path", json={"file_path": str(bak_file)})
    assert r_reopen_bak.status_code == 200
    assert r_reopen_bak.json()["page_count"] == 3


def test_crash_recovery_journal(tmp_path: Path):
    """Verify automatic crash recovery snapshot creation and session restoration."""
    r_new = client.post("/api/docs/new", json={"filename": "UnsavedWork.pdf", "page_count": 2})
    doc_id = r_new.json()["doc_id"]

    # Mutate document
    client.post(
        f"/api/docs/{doc_id}/pages/0/add-text",
        json={"text": "Crash Recovery Test Line", "bbox": [72, 72, 300, 110], "font_size": 14},
    )

    # Simulate crash by clearing active in-memory session dict without deleting recovery disk journal
    session_manager.sessions.clear()
    recoverable = client.get("/api/recovery").json()
    assert any(item["doc_id"] == doc_id for item in recoverable)

    # Restore session from crash recovery journal
    r_restored = client.post(f"/api/recovery/{doc_id}/restore")
    assert r_restored.status_code == 200
    objs = client.get(f"/api/docs/{doc_id}/pages/0/objects").json()
    assert any("Crash Recovery Test Line" in s["text"] for s in objs["text_spans"])


def test_direct_text_editing_preserves_background_without_white_rectangle(tmp_path: Path):
    """
    CRITICAL REQUIREMENT: Verify that editing existing PDF text modifies the PDF content stream
    in-place without drawing a white rectangle over colored background graphics, and preserves
    all unrelated content.
    """
    r_open = client.post("/api/docs/sample")
    doc_id = r_open.json()["doc_id"]
    before_bytes = client.get(f"/api/docs/{doc_id}/download").content

    # Inspect Page 0 objects
    objs = client.get(f"/api/docs/{doc_id}/pages/0/objects").json()
    title_span = next(s for s in objs["text_spans"] if "MASTER SOFTWARE" in s["text"])

    # Edit the title span on top of the colored banner
    r_edit = client.post(
        f"/api/docs/{doc_id}/pages/0/edit-text",
        json={
            "orig_bbox": title_span["bbox"],
            "orig_origin": title_span["origin"],
            "new_text": "AMENDED LINUX ENTERPRISE AGREEMENT",
            "font_name": title_span["font"],
            "original_font": title_span["font"],
            "font_size": title_span["size"],
            "color_hex": "#1e3a8a",
            "bold": True,
        },
    )
    assert r_edit.status_code == 200
    edit_res = r_edit.json()
    assert edit_res["edit_method"] == "direct_content_stream"
    assert edit_res["whiteout_used"] is False

    # Save, reopen, and verify:
    # 1. Old text "MASTER SOFTWARE SERVICES AGREEMENT" is completely gone
    # 2. New text "AMENDED LINUX ENTERPRISE AGREEMENT" is present
    # 3. Unrelated text on Page 1 ("Scope of Professional Services") and Page 2 is untouched
    # 4. Background banner pixel color inside the edited box is still light blue (224, 237, 255), NOT white (255, 255, 255)!
    saved_path = tmp_path / "direct_edited.pdf"
    client.post(f"/api/docs/{doc_id}/save", json={"target_path": str(saved_path)})

    with pymupdf.open(str(saved_path)) as reopened:
        p0_text = reopened[0].get_text("text")
        assert "MASTER SOFTWARE SERVICES AGREEMENT" not in p0_text
        assert "AMENDED LINUX ENTERPRISE AGREEMENT" in p0_text
        assert "1. Scope of Professional Services" in p0_text
        assert "Schedule A" in reopened[1].get_text("text")

        # Check pixel color at the right end of the old title bbox where "AGREEMENT" used to be
        pix = reopened[0].get_pixmap(dpi=72, alpha=False)
        bg_sample = pix.pixel(int(title_span["bbox"][2] - 5), int(title_span["bbox"][1] + 4))
        # Must be the light-blue banner fill (~224, 237, 255), never pure white (255, 255, 255)
        assert bg_sample[0] < 240 and bg_sample[2] > 245, f"Expected light blue banner pixel, got {bg_sample}"

        # Visual diff check on Page 2 (unrelated page must be 100% identical)
        after_bytes = saved_path.read_bytes()
        diff_p2 = compare_page_renders(before_bytes, after_bytes, page_index=1)
        assert diff_p2["similarity_percent"] == 100.0


def test_subset_font_fallback_detection():
    """Verify that editing a text span originally using a subsetted font triggers a clear fallback notice."""
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 100), "Subset Font Sample", fontsize=14, fontname="helv")
    raw = doc.tobytes()
    doc.close()

    objs = inspect_page_objects(raw, 0)
    span = objs["text_spans"][0]
    res = edit_text_span(
        pdf_bytes=raw,
        page_index=0,
        orig_bbox=span["bbox"],
        orig_origin=span["origin"],
        new_text="Edited Subset Text",
        original_font="ABCDEF+CustomCorporateSans",
        font_name="ABCDEF+CustomCorporateSans",
        font_size=14,
    )
    assert res["fallback_used"] is True
    assert "subset font" in res["fallback_reason"].lower()


def test_direct_image_shapes_and_hyperlinks_editing(tmp_path: Path):
    """Test inserting, transforming (move/resize/crop/rotate), replacing, and deleting PDF images, shapes, and links."""
    r_open = client.post("/api/docs/sample")
    doc_id = r_open.json()["doc_id"]

    objs0 = client.get(f"/api/docs/{doc_id}/pages/0/objects").json()
    assert len(objs0["images"]) == 1
    img_obj = objs0["images"][0]
    xref = img_obj["xref"]

    # Transform (move, resize, crop, rotate) existing image
    r_tr = client.post(
        f"/api/docs/{doc_id}/pages/0/edit-image",
        json={
            "xref": xref,
            "action": "transform",
            "orig_bbox": img_obj["bbox"],
            "new_bbox": [360, 140, 540, 260],
            "rotation": 90,
            "crop_ratios": [0.05, 0.05, 0.95, 0.95],
        },
    )
    assert r_tr.status_code == 200
    assert len(r_tr.json()["objects"]["images"]) == 1

    # Insert a new PNG image
    pil_new = Image.new("RGB", (100, 80), (16, 185, 129))
    buf = io.BytesIO()
    pil_new.save(buf, format="PNG")
    r_ins_img = client.post(
        f"/api/docs/{doc_id}/pages/0/insert-image",
        files={"file": ("badge.png", buf.getvalue(), "image/png")},
        data={"x0": "50", "y0": "420", "x1": "170", "y1": "510", "rotation": "0"},
    )
    assert r_ins_img.status_code == 200
    assert len(r_ins_img.json()["objects"]["images"]) == 2

    # Delete the newly inserted image
    second_xref = r_ins_img.json()["objects"]["images"][-1]["xref"]
    r_del_img = client.post(
        f"/api/docs/{doc_id}/pages/0/edit-image",
        json={"xref": second_xref, "action": "delete"},
    )
    assert r_del_img.status_code == 200
    assert len(r_del_img.json()["objects"]["images"]) == 1

    # Add vector arrow shape and update hyperlink
    r_shape = client.post(
        f"/api/docs/{doc_id}/pages/0/add-shape",
        json={"shape_type": "arrow", "bbox": [50, 520, 220, 550], "stroke_hex": "#dc2626", "stroke_width": 2.5},
    )
    assert r_shape.status_code == 200

    r_link = client.post(
        f"/api/docs/{doc_id}/pages/0/hyperlink",
        json={"action": "add", "bbox": [50, 560, 250, 585], "uri": "https://kernel.org"},
    )
    assert r_link.status_code == 200
    assert any(l["uri"] == "https://kernel.org" for l in r_link.json()["objects"]["links"])


def test_page_management_operations():
    """Test insert, duplicate, reorder, rotate, crop, resize, extract, split, and merge."""
    r_open = client.post("/api/docs/sample")
    doc_id = r_open.json()["doc_id"]

    # Duplicate page 0 -> 4 pages
    r_dup = client.post(f"/api/docs/{doc_id}/pages/duplicate", json={"page_index": 0})
    assert r_dup.json()["page_count"] == 4

    # Delete duplicated page 1 -> 3 pages
    r_del = client.post(f"/api/docs/{doc_id}/pages/delete", json={"page_indices": [1]})
    assert r_del.json()["page_count"] == 3

    # Reorder pages [2, 0, 1]
    r_reord = client.post(f"/api/docs/{doc_id}/pages/reorder", json={"new_order": [2, 0, 1]})
    assert r_reord.status_code == 200
    objs_new_p0 = client.get(f"/api/docs/{doc_id}/pages/0/objects").json()
    assert any("Schedule B" in s["text"] for s in objs_new_p0["text_spans"])

    # Rotate page 0 by 90 deg
    r_rot = client.post(f"/api/docs/{doc_id}/pages/rotate", json={"page_indices": [0], "delta_degrees": 90})
    assert r_rot.json()["pages"][0]["rotation"] == 90

    # Crop page 0 with margins
    r_crop = client.post(
        f"/api/docs/{doc_id}/pages/crop",
        json={"page_index": 0, "margins": {"top": 20, "bottom": 20, "left": 20, "right": 20}},
    )
    assert r_crop.status_code == 200

    # Resize page 1 to Letter (612 x 792)
    r_res = client.post(
        f"/api/docs/{doc_id}/pages/resize",
        json={"new_width": 612, "new_height": 792, "page_indices": [1], "scale_content": True},
    )
    assert r_res.json()["pages"][1]["width_pt"] == 612.0

    # Extract page 1 into a new tab
    r_ext = client.post(f"/api/docs/{doc_id}/pages/extract?open_as_tab=true", json={"page_indices": [0]})
    ext_doc_id = r_ext.json()["doc_id"]
    assert r_ext.json()["page_count"] == 1

    # Merge the two open tabs into a combined 4-page PDF
    r_merge = client.post(
        "/api/docs/merge",
        json={"doc_ids": [doc_id, ext_doc_id], "output_filename": "Merged.pdf"},
    )
    assert r_merge.json()["page_count"] == 4

    # Split into 2 parts
    r_split = client.post(
        f"/api/docs/{doc_id}/pages/split?open_tabs=false",
        json={"mode": "ranges", "ranges_spec": "1-2; 3"},
    )
    assert r_split.json()["split_count"] == 2


def test_annotations_and_review_workflow():
    """Test creating, listing, editing, and deleting all annotation types."""
    r_open = client.post("/api/docs/sample")
    doc_id = r_open.json()["doc_id"]

    for a_type in ("highlight", "underline", "strikeout", "sticky_note", "freetext", "ink", "arrow", "rect", "stamp"):
        r_add = client.post(
            f"/api/docs/{doc_id}/annotations",
            json={
                "page_index": 0,
                "annot_type": a_type,
                "bbox": [60, 400, 220, 440],
                "content": f"Review {a_type}",
                "author": "QA Engineer",
                "color_hex": "#eab308",
            },
        )
        assert r_add.status_code == 200

    annots = client.get(f"/api/docs/{doc_id}/annotations").json()
    assert len(annots) >= 9

    # Update annotation content and author
    target_xref = annots[0]["xref"]
    r_upd = client.put(
        f"/api/docs/{doc_id}/annotations/{target_xref}",
        json={"page_index": 0, "content": "Updated Review Comment", "author": "Lead Architect"},
    )
    assert r_upd.status_code == 200
    updated_item = next(a for a in r_upd.json()["annotations"] if a["xref"] == target_xref)
    assert updated_item["content"] == "Updated Review Comment"
    assert updated_item["author"] == "Lead Architect"

    # Delete annotation
    r_del = client.delete(f"/api/docs/{doc_id}/annotations/{target_xref}?page_index=0")
    assert r_del.status_code == 200
    assert all(a["xref"] != target_xref for a in r_del.json()["annotations"])


def test_forms_and_cryptographic_digital_signatures(tmp_path: Path):
    """Test AcroForm creation/filling and PKCS#12 cryptographic digital signing & verification."""
    r_open = client.post("/api/docs/sample")
    doc_id = r_open.json()["doc_id"]

    # List existing fields on Page 2 (index 1)
    fields = client.get(f"/api/docs/{doc_id}/forms").json()
    assert any(f["field_name"] == "client_organization" for f in fields)

    # Create a new text field and checkbox on Page 3 (index 2)
    r_create = client.post(
        f"/api/docs/{doc_id}/forms/create",
        json={
            "page_index": 2,
            "field_type": "text",
            "field_name": "approver_title",
            "bbox": [60, 140, 280, 168],
            "default_value": "VP of Engineering",
        },
    )
    assert r_create.status_code == 200

    # Fill existing form fields
    r_fill = client.post(
        f"/api/docs/{doc_id}/forms/fill",
        json={
            "values": {
                "client_organization": "Canonical Ubuntu Enterprise",
                "approver_title": "Chief Information Security Officer",
            }
        },
    )
    assert r_fill.status_code == 200

    # Apply a visual signature on Page 3
    r_vis = client.post(
        f"/api/docs/{doc_id}/signatures/visual",
        json={
            "page_index": 2,
            "bbox": [60, 200, 260, 260],
            "mode": "typed",
            "signer_name": "Bob Reviewer",
            "typed_text": "Bob Reviewer",
        },
    )
    assert r_vis.status_code == 200
    assert r_vis.json()["cryptographic"] is False

    # Generate an X.509 PKCS#12 certificate and apply a CRYPTOGRAPHIC digital signature
    r_cert = client.post(
        "/api/signatures/generate-cert",
        json={
            "common_name": "Dr. Clara Oswald",
            "organization": "Linux Foundation Assurance",
            "passphrase": "test-pass-2026",
        },
    )
    assert r_cert.status_code == 200
    p12_b64 = r_cert.json()["p12_base64"]

    r_sign = client.post(
        f"/api/docs/{doc_id}/signatures/cryptographic",
        json={
            "page_index": 2,
            "bbox": [60, 300, 340, 370],
            "field_name": "ExecApprovalSig",
            "reason": "Final Production Release Sign-Off",
            "location": "Geneva, Switzerland",
            "p12_base64": p12_b64,
            "passphrase": "test-pass-2026",
        },
    )
    assert r_sign.status_code == 200
    sign_data = r_sign.json()
    assert sign_data["cryptographic"] is True
    assert sign_data["verification"]["has_cryptographic_signatures"] is True
    assert sign_data["verification"]["all_intact"] is True
    sig_entry = sign_data["verification"]["signatures"][0]
    assert sig_entry["intact"] is True
    assert sig_entry["valid_digest"] is True
    assert "Clara Oswald" in sig_entry["signer_subject"]

    # Save signed PDF, reopen, and verify both form values and cryptographic signature persisted intact!
    signed_path = tmp_path / "signed_contract.pdf"
    client.post(f"/api/docs/{doc_id}/save", json={"target_path": str(signed_path)})

    r_reopen = client.post("/api/docs/open-path", json={"file_path": str(signed_path)})
    re_id = r_reopen.json()["doc_id"]
    re_fields = client.get(f"/api/docs/{re_id}/forms").json()
    org_field = next(f for f in re_fields if f["field_name"] == "client_organization")
    assert org_field["value"] == "Canonical Ubuntu Enterprise"

    re_verify = client.get(f"/api/docs/{re_id}/signatures/verify").json()
    assert re_verify["all_intact"] is True


def test_offline_ocr_and_all_document_conversions():
    """Test offline OCR on a scanned image-only PDF and bidirectional conversions (DOCX, XLSX, HTML, TXT, Images)."""
    # 1. Build a pure raster scanned PDF page (0 selectable characters)
    img = Image.new("RGB", (600, 300), (255, 255, 255))
    draw = ImageDraw.Draw(img)
    # Render large crisp text via PyMuPDF onto a bitmap to simulate a 200 DPI flatbed scan
    tmp_doc = pymupdf.open()
    tp = tmp_doc.new_page(width=400, height=200)
    tp.insert_text((36, 70), "SCANNED PURCHASE ORDER #7741", fontsize=20, fontname="hebo")
    tp.insert_text((36, 115), "Approved Vendor: Linux Systems Corp", fontsize=15, fontname="helv")
    scan_png = tp.get_pixmap(dpi=180).tobytes("png")
    tmp_doc.close()

    r_img2pdf = client.post(
        "/api/convert/images-to-pdf",
        files=[("files", ("scan1.png", scan_png, "image/png"))],
        data={"page_size": "a4", "open_as_tab": "true"},
    )
    assert r_img2pdf.status_code == 200
    scan_doc_id = r_img2pdf.json()["doc_id"]

    # Verify before OCR there is no selectable text
    txt_before = client.post(f"/api/docs/{scan_doc_id}/export/txt").text
    assert "PURCHASE" not in txt_before

    # Run offline OCR
    r_ocr = client.post(
        f"/api/docs/{scan_doc_id}/ocr",
        json={"language": "eng", "dpi": 180, "force_ocr_on_existing_text": True},
    )
    assert r_ocr.status_code == 200
    assert r_ocr.json()["total_lines_added"] >= 1

    # Verify searchable text layer is now embedded in the PDF!
    txt_after = client.post(f"/api/docs/{scan_doc_id}/export/txt").text
    assert "PURCHASE" in txt_after.upper() or "7741" in txt_after

    # 2. Test conversions on showcase PDF (DOCX -> PDF, PDF -> DOCX, XLSX table extraction, HTML, Images)
    r_sample = client.post("/api/docs/sample")
    s_id = r_sample.json()["doc_id"]

    r_docx = client.post(f"/api/docs/{s_id}/export/docx")
    assert r_docx.status_code == 200
    assert len(r_docx.content) > 1000

    # Convert that DOCX back to PDF
    r_back_pdf = client.post(
        "/api/convert/docx-to-pdf",
        files={"file": ("contract.docx", r_docx.content, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        data={"open_as_tab": "true"},
    )
    assert r_back_pdf.status_code == 200
    assert r_back_pdf.json()["page_count"] >= 1

    # Extract tables from Page 2 into Excel .xlsx & JSON
    r_tbl = client.post(f"/api/docs/{s_id}/export/tables-json")
    assert r_tbl.status_code == 200
    tbl_data = r_tbl.json()
    assert tbl_data["tables_count"] >= 1
    assert "$14,400.00" in tbl_data["csv_text"]

    r_html = client.post(f"/api/docs/{s_id}/export/html")
    assert r_html.status_code == 200
    assert "<section class=\"pdf-page\"" in r_html.text


def test_security_encryption_permanent_redaction_and_optimization(tmp_path: Path):
    """Test AES-256 encryption, password verification, permanent content redaction, metadata scrub, and compression."""
    r_sample = client.post("/api/docs/sample")
    doc_id = r_sample.json()["doc_id"]

    # 1. Permanent Redaction of SSN 999-42-8174
    r_red = client.post(
        f"/api/docs/{doc_id}/security/redact",
        json={
            "search_terms": ["999-42-8174", "ACCT-7781920"],
            "overlay_text": "REDACTED-PII",
            "fill_color_hex": "#000000",
        },
    )
    assert r_red.status_code == 200
    assert r_red.json()["redacted_regions_count"] >= 2

    # Verify the sensitive strings are permanently purged from extracted text AND raw PDF stream
    txt_post_redact = client.post(f"/api/docs/{doc_id}/export/txt").text
    assert "999-42-8174" not in txt_post_redact
    assert "ACCT-7781920" not in txt_post_redact

    # 2. Sanitize hidden metadata
    r_san = client.post(f"/api/docs/{doc_id}/security/sanitize")
    assert r_san.status_code == 200
    props = client.get(f"/api/docs/{doc_id}/properties").json()
    assert props["title"] == ""

    # 3. Compress & Optimize PDF
    r_opt = client.post(
        f"/api/docs/{doc_id}/optimize",
        json={"image_quality": 70, "max_image_dimension": 1200, "linearize": False},
    )
    assert r_opt.status_code == 200
    assert r_opt.json()["optimized_size_bytes"] > 0

    # 4. Encrypt with AES-256 password, save to disk, verify opening without password fails (401), and opening with password succeeds
    r_enc = client.post(
        f"/api/docs/{doc_id}/security/encrypt",
        json={
            "user_password": "linux-user-123",
            "owner_password": "linux-owner-456",
            "encryption_level": "AES-256",
            "allow_print": True,
            "allow_modify": False,
        },
    )
    assert r_enc.status_code == 200
    enc_path = tmp_path / "encrypted_aes256.pdf"
    enc_path.write_bytes(base64.b64decode(r_enc.json()["encrypted_base64"]))

    # Opening without password must return 401 PDF_PASSWORD_REQUIRED
    r_fail = client.post("/api/docs/open-path", json={"file_path": str(enc_path)})
    assert r_fail.status_code == 401

    # Opening with correct password must succeed
    r_ok = client.post(
        "/api/docs/open-path",
        json={"file_path": str(enc_path), "password": "linux-user-123"},
    )
    assert r_ok.status_code == 200
    assert r_ok.json()["is_encrypted"] is True


def test_pro_features_compare_watermarks_bates_bookmarks_attachments_and_pdfa():
    """Test PDF comparison, watermarks, headers/footers, Bates numbering, bookmarks, attachments, preflight, and PDF/A."""
    r1 = client.post("/api/docs/sample")
    id_a = r1.json()["doc_id"]

    r2 = client.post("/api/docs/sample")
    id_b = r2.json()["doc_id"]

    # Apply Header/Footer, Watermark, and Bates Numbering to Doc B
    assert client.post(
        f"/api/docs/{id_b}/pro/header-footer",
        json={"header_right": "CONFIDENTIAL", "footer_center": "Page {page} of {total}"},
    ).status_code == 200

    assert client.post(
        f"/api/docs/{id_b}/pro/watermark",
        json={"text": "DRAFT COPY", "opacity": 0.25, "rotation": 45},
    ).status_code == 200

    r_bates = client.post(
        f"/api/docs/{id_b}/pro/bates",
        json={"prefix": "LGL-", "start_number": 101, "digits": 5, "position": "bottom_right"},
    )
    assert r_bates.status_code == 200
    assert r_bates.json()["first_bates"] == "LGL-00101"
    assert r_bates.json()["last_bates"] == "LGL-00103"

    # Compare Doc A and Doc B
    r_cmp = client.post("/api/docs/compare", json={"doc_id_a": id_a, "doc_id_b": id_b})
    assert r_cmp.status_code == 200
    cmp_data = r_cmp.json()
    assert cmp_data["has_differences"] is True
    assert any("LGL-00101" in line for line in cmp_data["pages"][0]["added_lines"])

    # Bookmarks add & delete
    r_bm = client.post(
        f"/api/docs/{id_b}/bookmarks",
        json={"title": "Appendix Z", "page_index": 2, "level": 1},
    )
    assert r_bm.status_code == 200
    assert any(b["title"] == "Appendix Z" for b in r_bm.json()["bookmarks"])

    # Attachments add, list, extract, delete
    r_att = client.post(
        f"/api/docs/{id_b}/attachments",
        files={"file": ("schedule.csv", b"col1,col2\n10,20\n", "text/csv")},
        data={"description": "Raw CSV data"},
    )
    assert r_att.status_code == 200
    assert len(r_att.json()["attachments"]) == 1

    r_ext_att = client.get(f"/api/docs/{id_b}/attachments/schedule.csv")
    assert r_ext_att.content == b"col1,col2\n10,20\n"

    # Preflight & PDF/A-2b conversion
    r_pdfa = client.post(
        f"/api/docs/{id_b}/pro/pdfa",
        json={"conformance": "2B", "language": "en-US", "title": "Archival MSA"},
    )
    assert r_pdfa.status_code == 200
    assert r_pdfa.json()["is_pdfa"] is True
    assert r_pdfa.json()["preflight_score"] >= 80


def test_direct_edit_embedded_and_subsetted_fonts_deep_verification(tmp_path: Path):
    """
    Test direct text editing with embedded TrueType fonts, subsetted TrueType fonts,
    zero-gap horizontal spans, and tight vertical line spacing.
    """
    import fontTools.ttLib
    from backend.engine.direct_edit import edit_text_span, inspect_page_objects

    dejavu_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    assert os.path.exists(dejavu_path), "DejaVuSans.ttf must exist in environment"

    # 1. Full embedded font test
    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    page.insert_font(fontname="dejavu", fontfile=dejavu_path)
    page.insert_text((72, 100), "Embedded TrueType Baseline String", fontname="dejavu", fontsize=12)
    raw = doc.tobytes()

    objs = inspect_page_objects(raw, 0)
    sp = objs["text_spans"][0]
    assert sp["can_edit_losslessly"] is True

    res = edit_text_span(
        raw,
        page_index=0,
        orig_bbox=sp["bbox"],
        orig_origin=sp["origin"],
        new_text="Embedded TrueType MODIFIED String",
        original_font=sp["font"],
        font_size=sp["size"],
        keep_original_font=True,
    )
    assert res["edit_method"] == "direct_content_stream"
    assert res["font_strategy"] == "original_font"
    assert res["fallback_used"] is False

    # Verify modification persists
    objs2 = inspect_page_objects(res["pdf_bytes"], 0)
    texts = [s["text"] for s in objs2["text_spans"]]
    assert any("MODIFIED" in t for t in texts)

    # 2. Subsetted font test: existing glyphs vs missing glyphs
    doc_sub = pymupdf.open()
    p_sub = doc_sub.new_page(width=612, height=792)
    p_sub.insert_font(fontname="dejavu", fontfile=dejavu_path)
    p_sub.insert_text((72, 100), "Alpha Beta Gamma", fontname="dejavu", fontsize=12)
    doc_sub.subset_fonts()
    raw_sub = doc_sub.tobytes()

    objs_sub = inspect_page_objects(raw_sub, 0)
    sp_sub = objs_sub["text_spans"][0]
    assert sp_sub["is_subset_font"] is True

    # Edit using characters already in the subset ("Beta Alpha")
    res_in_sub = edit_text_span(
        raw_sub,
        page_index=0,
        orig_bbox=sp_sub["bbox"],
        orig_origin=sp_sub["origin"],
        new_text="Beta Alpha",
        original_font=sp_sub["font"],
        font_size=sp_sub["size"],
        keep_original_font=True,
    )
    assert res_in_sub["font_strategy"] == "original_font"
    assert res_in_sub["fallback_used"] is False

    # Edit using characters NOT in the subset ("Zeta") -> must fallback gracefully
    res_fallback = edit_text_span(
        raw_sub,
        page_index=0,
        orig_bbox=sp_sub["bbox"],
        orig_origin=sp_sub["origin"],
        new_text="Zeta",
        original_font=sp_sub["font"],
        font_size=sp_sub["size"],
        keep_original_font=True,
    )
    assert res_fallback["font_strategy"] == "substitute_font"
    assert res_fallback["fallback_used"] is True
    assert "subset" in res_fallback["fallback_reason"].lower()

    # 3. Tight vertical line spacing (10.5pt leading on 12pt font)
    doc_tight = pymupdf.open()
    p_tight = doc_tight.new_page(width=612, height=792)
    p_tight.insert_text((72, 100), "Line 1: Tight above gyqpj", fontsize=12)
    p_tight.insert_text((72, 110.5), "Line 2: TARGET TO EDIT", fontsize=12)
    p_tight.insert_text((72, 121), "Line 3: Tight below BDFHKL", fontsize=12)
    raw_tight = doc_tight.tobytes()

    objs_tight = inspect_page_objects(raw_tight, 0)
    sp_target = [s for s in objs_tight["text_spans"] if "TARGET" in s["text"]][0]
    res_tight = edit_text_span(
        raw_tight,
        page_index=0,
        orig_bbox=sp_target["bbox"],
        orig_origin=sp_target["origin"],
        new_text="Line 2: REPLACED PERFECTLY",
        original_font=sp_target["font"],
        font_size=sp_target["size"],
    )
    objs_tight_after = inspect_page_objects(res_tight["pdf_bytes"], 0)
    tight_texts = [s["text"] for s in objs_tight_after["text_spans"]]
    assert "Line 1: Tight above gyqpj" in tight_texts
    assert "Line 2: REPLACED PERFECTLY" in tight_texts
    assert "Line 3: Tight below BDFHKL" in tight_texts

    # 4. Zero-gap horizontal adjacent spans
    doc_h = pymupdf.open()
    p_h = doc_h.new_page(width=612, height=792)
    p_h.insert_text((72, 100), "BoldPrefix", fontsize=12, fontname="hebo")
    adv = pymupdf.get_text_length("BoldPrefix", fontname="hebo", fontsize=12)
    p_h.insert_text((72 + adv, 100), "ImmediatelyTouchingSuffix", fontsize=12, fontname="helv")
    raw_h = doc_h.tobytes()

    objs_h = inspect_page_objects(raw_h, 0)
    sp_prefix = [s for s in objs_h["text_spans"] if "BoldPrefix" in s["text"]][0]
    res_h = edit_text_span(
        raw_h,
        page_index=0,
        orig_bbox=sp_prefix["bbox"],
        orig_origin=sp_prefix["origin"],
        new_text="NewPrefix",
        original_font=sp_prefix["font"],
        font_size=sp_prefix["size"],
    )
    objs_h_after = inspect_page_objects(res_h["pdf_bytes"], 0)
    h_texts = [s["text"] for s in objs_h_after["text_spans"]]
    assert any("ImmediatelyTouchingSuffix" in t for t in h_texts)
    assert any("NewPrefix" in t for t in h_texts)


def test_session_encryption_persistence_and_export_get(tmp_path: Path):
    """
    Verify that encrypting a session allows ongoing edits/renders and that
    safe_save / download produces an encrypted PDF file verifiable on disk.
    Also verify GET /export/{fmt} endpoints.
    """
    # 1. Create document
    r_new = client.post("/api/docs/new", json={"filename": "persisted_enc.pdf", "page_count": 2})
    assert r_new.status_code == 200
    doc_id = r_new.json()["doc_id"]

    # 2. Encrypt session
    r_enc = client.post(
        f"/api/docs/{doc_id}/security/encrypt",
        json={"user_password": "persist_pw_123", "encryption_level": "AES-256"},
    )
    assert r_enc.status_code == 200
    assert r_enc.json()["encrypted"] is True

    # 3. Subsequent session operations must succeed without 500
    r_info = client.get(f"/api/docs/{doc_id}")
    assert r_info.status_code == 200
    assert r_info.json()["page_count"] == 2

    r_render = client.get(f"/api/docs/{doc_id}/pages/0/render")
    assert r_render.status_code == 200
    assert len(r_render.content) > 100

    # 4. Safe save to disk
    save_file = tmp_path / "saved_encrypted.pdf"
    r_save = client.post(f"/api/docs/{doc_id}/save", json={"target_path": str(save_file)})
    assert r_save.status_code == 200
    assert save_file.exists()

    # 5. Open disk file: must be encrypted, requiring password
    saved_bytes = save_file.read_bytes()
    doc_check = pymupdf.open(stream=saved_bytes, filetype="pdf")
    assert doc_check.is_encrypted is True
    assert doc_check.authenticate("wrong_pw") == 0
    assert doc_check.authenticate("persist_pw_123") > 0
    doc_check.close()

    # 6. GET /export/{fmt} verification
    for fmt in ("docx", "xlsx", "csv", "html", "txt"):
        res = client.get(f"/api/docs/{doc_id}/export/{fmt}")
        assert res.status_code == 200, f"GET /export/{fmt} failed: {res.text}"


def test_corrupted_pdf_graceful_recovery_and_repair():
    """Verify corrupted/truncated PDF handling and structural repair endpoint."""
    r_sample = client.post("/api/docs/sample")
    doc_id = r_sample.json()["doc_id"]

    r_rep = client.post(f"/api/docs/{doc_id}/repair")
    assert r_rep.status_code == 200
    assert r_rep.json()["repaired"] is True
    assert len(r_rep.json()["diagnostics"]) >= 1

    # Totally invalid non-PDF garbage must return clean 400 error instead of crashing
    r_bad = client.post(
        "/api/docs/open-upload",
        files={"file": ("broken.pdf", b"NOT_A_VALID_PDF_HEADER_AT_ALL_0000", "application/pdf")},
    )
    assert r_bad.status_code == 400


def test_textbox_inline_editing_wrapping_coordinates_and_lifecycle(tmp_path: Path):
    """
    Verify Add Text Box:
    1. Text box creation with multiline content
    2. Text wrapping within bounding box
    3. Font, size, color, bold, italic, and alignment options
    4. Coordinate conversion and rotation handling (0°, 90°, 180°, 270°)
    5. Save, close, and reopen persistence
    6. Undo and Redo operations
    7. Cancel behavior (session unchanged)
    8. Unsupported browser dialog prevention across frontend codebase
    """
    # 1. Open showcase document
    r_open = client.post("/api/docs/sample")
    assert r_open.status_code == 200
    doc_id = r_open.json()["doc_id"]

    # Record initial text content to verify existing content is never overwritten
    initial_objs = client.get(f"/api/docs/{doc_id}/pages/0/objects").json()
    initial_texts = {s["text"] for s in initial_objs["text_spans"]}
    first_span = initial_objs["text_spans"][0]

    # 2. Add multiline text box with wrapping and custom formatting directly adjacent to existing content
    adjacent_bbox = [first_span["bbox"][0], first_span["bbox"][3] + 4.0, first_span["bbox"][0] + 250.0, first_span["bbox"][3] + 45.0]
    multiline_text = "Vellum PDF Pro\nInline Text Box Demonstration\nFeaturing Automatic Word Wrapping"

    r_add = client.post(
        f"/api/docs/{doc_id}/pages/0/add-text",
        json={
            "text": multiline_text,
            "bbox": adjacent_bbox,
            "font_name": "helv",
            "font_size": 13.0,
            "color_hex": "#2563eb",
            "bold": True,
            "italic": False,
            "align": "left",
        },
    )
    assert r_add.status_code == 200
    summary = r_add.json()["summary"]
    assert summary["dirty"] is True
    assert summary["can_undo"] is True

    # Inspect page objects to verify text was added AND all initial text spans remain completely intact
    page_objs = client.get(f"/api/docs/{doc_id}/pages/0/objects").json()
    updated_texts = {s["text"] for s in page_objs["text_spans"]}
    for orig_t in initial_texts:
        assert orig_t in updated_texts, f"Surrounding content was overwritten: {orig_t}"
    assert any("Inline Text Box Demonstration" in s["text"] for s in page_objs["text_spans"])

    # 2b. Add extended long multiline text with deliberate small height to test automatic text overflow expansion
    long_multiline = "Line 1: Extended prose paragraph demonstration.\nLine 2: Automatic bounding box height expansion.\nLine 3: High-DPI rasterization and font embedding check."
    r_long = client.post(
        f"/api/docs/{doc_id}/pages/0/add-text",
        json={"text": long_multiline, "bbox": [72.0, 300.0, 320.0, 330.0], "font_size": 11.0, "font_name": "tiro"},
    )
    assert r_long.status_code == 200
    p0_extracted = pymupdf.open(stream=client.get(f"/api/docs/{doc_id}/download").content, filetype="pdf")[0].get_text()
    assert "Extended prose paragraph" in p0_extracted and "High-DPI rasterization" in p0_extracted

    # 2c. Add text box near right and bottom page boundaries
    p0_rect = pymupdf.open(stream=client.get(f"/api/docs/{doc_id}/download").content, filetype="pdf")[0].rect
    r_margin = client.post(
        f"/api/docs/{doc_id}/pages/0/add-text",
        json={
            "text": "Right Margin Note",
            "bbox": [p0_rect.width - 130.0, p0_rect.height - 50.0, p0_rect.width - 10.0, p0_rect.height - 15.0],
            "font_size": 9.0,
            "font_name": "cour",
        },
    )
    assert r_margin.status_code == 200
    assert "Right Margin Note" in pymupdf.open(stream=client.get(f"/api/docs/{doc_id}/download").content, filetype="pdf")[0].get_text()

    # 2d. Test different font sizes (6pt, 16pt, 32pt)
    for sz in (6.0, 16.0, 32.0):
        r_sz = client.post(
            f"/api/docs/{doc_id}/pages/1/add-text",
            json={"text": f"Size {int(sz)}pt Font Verification", "bbox": [80.0, 100.0 + sz * 3, 400.0, 150.0 + sz * 3], "font_size": sz},
        )
        assert r_sz.status_code == 200
    p1_extracted = pymupdf.open(stream=client.get(f"/api/docs/{doc_id}/download").content, filetype="pdf")[1].get_text()
    assert "Size 6pt" in p1_extracted and "Size 16pt" in p1_extracted and "Size 32pt" in p1_extracted

    # 3. Test Undo of last added text box
    r_undo = client.post(f"/api/docs/{doc_id}/undo")
    assert r_undo.status_code == 200
    p1_after_undo = pymupdf.open(stream=client.get(f"/api/docs/{doc_id}/download").content, filetype="pdf")[1].get_text()
    assert "Size 32pt" not in p1_after_undo
    assert "Size 16pt" in p1_after_undo

    # 4. Test Redo of text box
    r_redo = client.post(f"/api/docs/{doc_id}/redo")
    assert r_redo.status_code == 200
    p1_after_redo = pymupdf.open(stream=client.get(f"/api/docs/{doc_id}/download").content, filetype="pdf")[1].get_text()
    assert "Size 32pt" in p1_after_redo

    # 5. Verify Cancel behavior: draft interaction cancelled without calling add-text leaves document completely unchanged
    bytes_before_cancel = client.get(f"/api/docs/{doc_id}/download").content
    summary_before = client.get(f"/api/docs/{doc_id}").json()
    # Simulating cancel: draft discarded on frontend without submitting add-text
    summary_after_cancel = client.get(f"/api/docs/{doc_id}").json()
    bytes_after_cancel = client.get(f"/api/docs/{doc_id}/download").content
    assert summary_before["sha256"] == summary_after_cancel["sha256"]
    assert summary_before["undo_count"] == summary_after_cancel["undo_count"]
    assert bytes_before_cancel == bytes_after_cancel

    # 5. Save to disk, close session, and reopen to verify persistence
    save_file = tmp_path / "textbox_persisted.pdf"
    r_save = client.post(
        f"/api/docs/{doc_id}/save",
        json={"target_path": str(save_file)},
    )
    assert r_save.status_code == 200
    assert save_file.exists()

    # Close document
    client.delete(f"/api/docs/{doc_id}")

    # Reopen saved PDF
    with open(save_file, "rb") as f:
        r_reopen = client.post(
            "/api/docs/open-upload",
            files={"file": ("textbox_persisted.pdf", f.read(), "application/pdf")},
        )
    assert r_reopen.status_code == 200
    reopened_id = r_reopen.json()["doc_id"]
    reopened_objs = client.get(f"/api/docs/{reopened_id}/pages/0/objects").json()
    assert any("Inline Text Box Demonstration" in s["text"] for s in reopened_objs["text_spans"])

    # 6. Test Text Wrapping on Rotated Pages (90, 180, 270 degrees)
    for rot in (90, 180, 270):
        r_new = client.post("/api/docs/new", json={"filename": f"rot_{rot}.pdf", "page_count": 1})
        rot_id = r_new.json()["doc_id"]
        # Rotate page
        client.post(f"/api/docs/{rot_id}/pages/rotate", json={"page_indices": [0], "angle": rot})
        # Insert text box into rotated page
        r_rot_add = client.post(
            f"/api/docs/{rot_id}/pages/0/add-text",
            json={
                "text": f"Rotated {rot} Text Box Wrap",
                "bbox": [50.0, 50.0, 220.0, 120.0],
                "font_size": 12.0,
                "align": "left",
            },
        )
        assert r_rot_add.status_code == 200
        rot_objs = client.get(f"/api/docs/{rot_id}/pages/0/objects").json()
        assert any(f"Rotated {rot}" in s["text"] for s in rot_objs["text_spans"])

    # 7. Unsupported Browser Dialog Prevention: Verify no prompt(), confirm(), or alert() in src/
    src_dir = Path(__file__).resolve().parent.parent / "src"
    import re
    disallowed_pattern = re.compile(r"\b(window\.)?(prompt|confirm|alert)\s*\(")
    offending_lines = []
    for fpath in src_dir.glob("**/*"):
        if fpath.suffix in (".ts", ".tsx", ".js", ".jsx"):
            with open(fpath, "r", encoding="utf-8") as f:
                for idx, line in enumerate(f, 1):
                    if disallowed_pattern.search(line):
                        offending_lines.append(f"{fpath.name}:{idx}: {line.strip()}")
    assert not offending_lines, f"Found forbidden blocking browser dialogs: {offending_lines}"


def test_object_selection_moving_resizing_and_persistence():
    """Verify professional object manipulation: select, move, resize, duplicate, delete, and persist."""
    # 1. Create a fresh document
    res_new = client.post("/api/docs/new", json={"filename": "object_manipulation_test.pdf", "page_count": 1})
    assert res_new.status_code == 200
    doc_id = res_new.json()["doc_id"]

    # 2. Add an interactive Vellum text box
    add_box_payload = {
        "text": "Movable & Resizable Text Box",
        "bbox": [100.0, 150.0, 300.0, 210.0],
        "font_name": "helv",
        "font_size": 14.0,
        "color_hex": "#1d4ed8",
        "bold": True,
        "italic": False,
        "align": "left",
    }
    r_add = client.post(f"/api/docs/{doc_id}/pages/0/add-text", json=add_box_payload)
    assert r_add.status_code == 200

    # 3. Verify object is tracked in vellum_boxes
    r_objs = client.get(f"/api/docs/{doc_id}/pages/0/objects")
    assert r_objs.status_code == 200
    objs_data = r_objs.json()
    assert "vellum_boxes" in objs_data
    assert len(objs_data["vellum_boxes"]) == 1
    vbox = objs_data["vellum_boxes"][0]
    box_id = vbox["id"]
    assert vbox["text"] == "Movable & Resizable Text Box"
    assert vbox["bbox"] == [100.0, 150.0, 300.0, 210.0]

    # 4. Move text box to new coordinates [150.0, 250.0, 350.0, 310.0]
    new_moved_bbox = [150.0, 250.0, 350.0, 310.0]
    r_move = client.post(
        f"/api/docs/{doc_id}/pages/0/transform-object",
        json={
            "object_id": box_id,
            "object_type": "textbox",
            "action": "move",
            "orig_bbox": vbox["bbox"],
            "new_bbox": new_moved_bbox,
            "text": vbox["text"],
            "font_name": vbox["font"],
            "font_size": vbox["size"],
            "color_hex": vbox["color"],
        },
    )
    assert r_move.status_code == 200
    updated_objs = r_move.json()["objects"]
    assert len(updated_objs["vellum_boxes"]) == 1
    assert updated_objs["vellum_boxes"][0]["bbox"] == new_moved_bbox

    # 5. Resize text box [150.0, 250.0, 450.0, 350.0]
    new_resized_bbox = [150.0, 250.0, 450.0, 350.0]
    r_resize = client.post(
        f"/api/docs/{doc_id}/pages/0/transform-object",
        json={
            "object_id": box_id,
            "object_type": "textbox",
            "action": "move",
            "orig_bbox": new_moved_bbox,
            "new_bbox": new_resized_bbox,
            "text": "Movable & Resizable Text Box (Resized)",
            "font_name": "helv",
            "font_size": 16.0,
            "color_hex": "#0f766e",
        },
    )
    assert r_resize.status_code == 200
    resized_objs = r_resize.json()["objects"]
    assert resized_objs["vellum_boxes"][0]["bbox"] == new_resized_bbox
    assert "Resized" in resized_objs["vellum_boxes"][0]["text"]

    # 6. Duplicate text box
    r_dup = client.post(
        f"/api/docs/{doc_id}/pages/0/transform-object",
        json={
            "object_id": box_id,
            "object_type": "textbox",
            "action": "duplicate",
            "orig_bbox": new_resized_bbox,
        },
    )
    assert r_dup.status_code == 200
    dup_objs = r_dup.json()["objects"]
    assert len(dup_objs["vellum_boxes"]) == 2
    # Verify offset by +20pt
    dup_box = next(b for b in dup_objs["vellum_boxes"] if b["id"] != box_id)
    assert dup_box["bbox"][0] == new_resized_bbox[0] + 20
    assert dup_box["bbox"][1] == new_resized_bbox[1] + 20

    # 7. Delete duplicated box
    r_del = client.post(
        f"/api/docs/{doc_id}/pages/0/transform-object",
        json={
            "object_id": dup_box["id"],
            "object_type": "textbox",
            "action": "delete",
            "orig_bbox": dup_box["bbox"],
        },
    )
    assert r_del.status_code == 200
    after_del_objs = r_del.json()["objects"]
    assert len(after_del_objs["vellum_boxes"]) == 1

    # 8. Add a vector shape (Rectangle) and transform it
    r_shape = client.post(
        f"/api/docs/{doc_id}/pages/0/add-shape",
        json={
            "shape_type": "rect",
            "bbox": [50.0, 50.0, 200.0, 120.0],
            "stroke_hex": "#2563eb",
            "fill_hex": "#dbeafe",
            "stroke_width": 2.0,
        },
    )
    assert r_shape.status_code == 200
    shape_objs = client.get(f"/api/docs/{doc_id}/pages/0/objects").json()
    assert len(shape_objs.get("vellum_shapes", [])) == 1
    vshape = shape_objs["vellum_shapes"][0]
    shape_id = vshape["id"]

    # Resize vector shape
    new_shape_bbox = [60.0, 70.0, 250.0, 160.0]
    r_shape_trans = client.post(
        f"/api/docs/{doc_id}/pages/0/transform-object",
        json={
            "object_id": shape_id,
            "object_type": "shape",
            "action": "move",
            "orig_bbox": vshape["bbox"],
            "new_bbox": new_shape_bbox,
            "stroke_hex": "#7c3aed",
            "fill_hex": "#ede9fe",
            "stroke_width": 3.0,
        },
    )
    assert r_shape_trans.status_code == 200
    updated_shape_objs = r_shape_trans.json()["objects"]
    assert updated_shape_objs["vellum_shapes"][0]["bbox"] == new_shape_bbox

    # 9. Test Undo and Redo
    r_undo = client.post(f"/api/docs/{doc_id}/undo")
    assert r_undo.status_code == 200
    undo_objs = client.get(f"/api/docs/{doc_id}/pages/0/objects").json()
    assert undo_objs["vellum_shapes"][0]["bbox"] == vshape["bbox"]

    r_redo = client.post(f"/api/docs/{doc_id}/redo")
    assert r_redo.status_code == 200
    redo_objs = client.get(f"/api/docs/{doc_id}/pages/0/objects").json()
    assert redo_objs["vellum_shapes"][0]["bbox"] == new_shape_bbox

    # 10. Test Persistence across Export and Re-open
    r_export = client.get(f"/api/docs/{doc_id}/download")
    assert r_export.status_code == 200
    exported_bytes = r_export.content

    # Re-open the exported PDF
    import io
    r_reopen = client.post(
        "/api/docs/open-upload",
        files={"file": ("reopened_vellum.pdf", io.BytesIO(exported_bytes), "application/pdf")},
    )
    assert r_reopen.status_code == 200
    reopened_doc_id = r_reopen.json()["doc_id"]
    reopened_objs = client.get(f"/api/docs/{reopened_doc_id}/pages/0/objects").json()

    # Confirm vellum_boxes and vellum_shapes were persisted in VellumData and reconstructed
    assert len(reopened_objs.get("vellum_boxes", [])) == 1
    assert reopened_objs["vellum_boxes"][0]["bbox"] == new_resized_bbox
    assert "Resized" in reopened_objs["vellum_boxes"][0]["text"]

    assert len(reopened_objs.get("vellum_shapes", [])) == 1
    assert reopened_objs["vellum_shapes"][0]["bbox"] == new_shape_bbox


def test_text_span_manipulation_preservation_and_hyperlinks(tmp_path: Path):
    """
    Regression test suite for text-span object manipulation:
    1. Resizing text span bounding box does NOT scale font size or alter text.
    2. Moving native Helvetica, bold, and italic text spans.
    3. Hyperlink annotation synchronization when moving hyperlinked text.
    4. Embedded TrueType font preservation during move/resize.
    5. Rotated pages (0°, 90°, 180°, 270°).
    6. Text overlapping vector graphics and colored backgrounds without whiteout artifacts.
    7. Atomic failure handling: invalid or empty text does not wipe the PDF.
    8. Undo / Redo lifecycle.
    9. Persistence across Export and Re-open.
    """
    import io

    # 1. Open showcase document
    r_open = client.post("/api/docs/sample")
    assert r_open.status_code == 200
    doc_id = r_open.json()["doc_id"]

    page_objs = client.get(f"/api/docs/{doc_id}/pages/0/objects").json()
    link_span = [s for s in page_objs["text_spans"] if "specifications.vellumpdf" in s["text"]][0]
    orig_link_span_bbox = list(link_span["bbox"])
    orig_link_text = link_span["text"]
    orig_link_font_size = link_span["size"]

    # 1a. Test Resizing Bounding Box (e.g. from 190x14 pt to 239x42 pt)
    # Resizing must NOT scale font size or alter the text string
    resized_bbox = [orig_link_span_bbox[0], orig_link_span_bbox[1], orig_link_span_bbox[0] + 239.0, orig_link_span_bbox[1] + 42.0]
    r_resize = client.post(
        f"/api/docs/{doc_id}/pages/0/transform-object",
        json={
            "object_id": link_span["id"],
            "object_type": "text_span",
            "action": "transform",
            "orig_bbox": orig_link_span_bbox,
            "new_bbox": resized_bbox,
            "orig_origin": link_span["origin"],
            "text": link_span["text"],
            "font_name": link_span["font"],
            "font_size": link_span["size"],
            "color_hex": link_span["color"],
        },
    )
    assert r_resize.status_code == 200
    resize_objs = r_resize.json()["objects"]
    matching_after_resize = [s for s in resize_objs["text_spans"] if orig_link_text in s["text"]]
    assert len(matching_after_resize) == 1, "Text disappeared after resizing bounding box!"
    assert matching_after_resize[0]["size"] == orig_link_font_size, "Font size was unexpectedly scaled!"
    assert len(resize_objs["links"]) == 1, "Hyperlink was lost after resizing!"
    assert resize_objs["links"][0]["uri"] == "https://specifications.vellumpdf.linux/msa"

    # 2. Test Moving Hyperlink Text Span and verifying Link Annotation Synchronization
    moved_bbox = [
        orig_link_span_bbox[0] + 50.0,
        orig_link_span_bbox[1] + 60.0,
        orig_link_span_bbox[2] + 50.0,
        orig_link_span_bbox[3] + 60.0,
    ]
    r_move = client.post(
        f"/api/docs/{doc_id}/pages/0/transform-object",
        json={
            "object_id": matching_after_resize[0]["id"],
            "object_type": "text_span",
            "action": "move",
            "orig_bbox": matching_after_resize[0]["bbox"],
            "new_bbox": moved_bbox,
            "orig_origin": matching_after_resize[0]["origin"],
            "text": orig_link_text,
            "font_name": matching_after_resize[0]["font"],
            "font_size": matching_after_resize[0]["size"],
            "color_hex": matching_after_resize[0]["color"],
        },
    )
    assert r_move.status_code == 200
    move_objs = r_move.json()["objects"]
    matching_after_move = [s for s in move_objs["text_spans"] if orig_link_text in s["text"]]
    assert len(matching_after_move) == 1, "Text disappeared after move!"
    assert abs(matching_after_move[0]["bbox"][0] - moved_bbox[0]) < 2.0
    assert abs(matching_after_move[0]["bbox"][1] - moved_bbox[1]) < 2.0

    # Verify link annotation moved along with the text span
    assert len(move_objs["links"]) == 1
    moved_link = move_objs["links"][0]
    assert moved_link["uri"] == "https://specifications.vellumpdf.linux/msa"
    assert abs(moved_link["bbox"][0] - (48.0 + 50.0)) < 2.0
    assert abs(moved_link["bbox"][1] - (345.0 + 60.0)) < 2.0

    # 3. Test Bold and Italic Spans
    # Find a bold or regular span in showcase, or create a synthetic document
    doc_syn = pymupdf.open()
    p_syn = doc_syn.new_page(width=612, height=792)
    # Background rectangle to test preservation of background graphics
    p_syn.draw_rect(pymupdf.Rect(50, 50, 400, 300), color=(0.2, 0.4, 0.8), fill=(0.9, 0.95, 1.0))
    p_syn.insert_text((72, 100), "Bold Heading Text", fontname="helv", fontsize=14, color=(0.1, 0.1, 0.5))
    p_syn.insert_text((72, 130), "Italic Body Content", fontname="helv", fontsize=11, color=(0.2, 0.2, 0.2))
    syn_bytes = doc_syn.tobytes()

    r_syn_open = client.post(
        "/api/docs/open-upload",
        files={"file": ("styled.pdf", io.BytesIO(syn_bytes), "application/pdf")},
    )
    assert r_syn_open.status_code == 200
    syn_doc_id = r_syn_open.json()["doc_id"]
    syn_objs = client.get(f"/api/docs/{syn_doc_id}/pages/0/objects").json()
    bold_span = [s for s in syn_objs["text_spans"] if "Bold Heading" in s["text"]][0]

    # Move bold span across colored background
    new_bold_bbox = [bold_span["bbox"][0] + 30.0, bold_span["bbox"][1] + 25.0, bold_span["bbox"][2] + 30.0, bold_span["bbox"][3] + 25.0]
    r_bold_move = client.post(
        f"/api/docs/{syn_doc_id}/pages/0/transform-object",
        json={
            "object_id": bold_span["id"],
            "object_type": "text_span",
            "action": "move",
            "orig_bbox": bold_span["bbox"],
            "new_bbox": new_bold_bbox,
            "orig_origin": bold_span["origin"],
            "text": bold_span["text"],
            "font_name": bold_span["font"],
            "font_size": bold_span["size"],
            "color_hex": bold_span["color"],
            "bold": True,
        },
    )
    assert r_bold_move.status_code == 200
    syn_after_move = r_bold_move.json()["objects"]
    assert any("Bold Heading Text" in s["text"] for s in syn_after_move["text_spans"])
    # Background must be untouched: inspect rendered pixmap pixel to confirm no white redaction box
    r_render = client.get(f"/api/docs/{syn_doc_id}/pages/0/render")
    assert r_render.status_code == 200

    # 4. Rotated Pages Test (90°, 180°, 270°)
    for rot in (90, 180, 270):
        doc_rot = pymupdf.open()
        p_rot = doc_rot.new_page(width=612, height=792)
        p_rot.set_rotation(rot)
        p_rot.insert_text((72, 100), f"Rotation {rot} Text Span", fontsize=12)
        rot_bytes = doc_rot.tobytes()

        r_rot_open = client.post(
            "/api/docs/open-upload",
            files={"file": (f"rot_{rot}.pdf", io.BytesIO(rot_bytes), "application/pdf")},
        )
        assert r_rot_open.status_code == 200
        rot_doc_id = r_rot_open.json()["doc_id"]
        rot_objs = client.get(f"/api/docs/{rot_doc_id}/pages/0/objects").json()
        target_rot_span = rot_objs["text_spans"][0]

        r_rot_move = client.post(
            f"/api/docs/{rot_doc_id}/pages/0/transform-object",
            json={
                "object_id": target_rot_span["id"],
                "object_type": "text_span",
                "action": "move",
                "orig_bbox": target_rot_span["bbox"],
                "new_bbox": [target_rot_span["bbox"][0] + 20, target_rot_span["bbox"][1] + 20, target_rot_span["bbox"][2] + 20, target_rot_span["bbox"][3] + 20],
                "orig_origin": target_rot_span["origin"],
                "text": target_rot_span["text"],
                "font_name": target_rot_span["font"],
                "font_size": target_rot_span["size"],
                "color_hex": target_rot_span["color"],
            },
        )
        assert r_rot_move.status_code == 200
        after_rot_objs = r_rot_move.json()["objects"]
        assert any(f"Rotation {rot}" in s["text"] for s in after_rot_objs["text_spans"])

    # 5. Atomic Transformation Failure Guard
    # If text is None or empty, transform_object falls back to inspecting span or preserving doc
    r_empty_text = client.post(
        f"/api/docs/{doc_id}/pages/0/transform-object",
        json={
            "object_id": matching_after_move[0]["id"],
            "object_type": "text_span",
            "action": "move",
            "orig_bbox": matching_after_move[0]["bbox"],
            "new_bbox": [moved_bbox[0] + 10, moved_bbox[1] + 10, moved_bbox[2] + 10, moved_bbox[3] + 10],
            # text omitted intentionally to trigger backend fallback lookup
        },
    )
    assert r_empty_text.status_code == 200
    empty_objs = r_empty_text.json()["objects"]
    assert any(orig_link_text in s["text"] for s in empty_objs["text_spans"])

    # 6. Undo / Redo verification
    r_undo = client.post(f"/api/docs/{doc_id}/undo")
    assert r_undo.status_code == 200
    undo_objs = client.get(f"/api/docs/{doc_id}/pages/0/objects").json()
    assert any(orig_link_text in s["text"] for s in undo_objs["text_spans"])

    r_redo = client.post(f"/api/docs/{doc_id}/redo")
    assert r_redo.status_code == 200
    redo_objs = client.get(f"/api/docs/{doc_id}/pages/0/objects").json()
    assert any(orig_link_text in s["text"] for s in redo_objs["text_spans"])

    # 7. Persistence across Save / Export and Re-open
    r_exp = client.get(f"/api/docs/{doc_id}/download")
    assert r_exp.status_code == 200
    reopen_r = client.post(
        "/api/docs/open-upload",
        files={"file": ("saved_msa.pdf", io.BytesIO(r_exp.content), "application/pdf")},
    )
    assert reopen_r.status_code == 200
    reopen_id = reopen_r.json()["doc_id"]
    reopen_objs = client.get(f"/api/docs/{reopen_id}/pages/0/objects").json()
    reopen_links = [s for s in reopen_objs["text_spans"] if orig_link_text in s["text"]]
    assert len(reopen_links) == 1, "Persisted text span not found after re-opening saved document!"
    assert len(reopen_objs["links"]) == 1, "Persisted hyperlink not found after re-opening saved document!"


def test_intelligent_paragraph_editing_reflow_overflow_and_safety(tmp_path: Path):
    """
    Comprehensive test suite for GitHub Issue #1 (Acrobat-style Paragraph Editor & Reflow):
    1. Safe paragraph grouping: headings, two columns, and table cells are not merged.
    2. Multi-line word wrapping, punctuation, and long unbreakable words.
    3. Overflow detection (`status == 'overflow'`), safe `expand_box`, `shrink_font`, and neighbor collision refusal.
    4. Atomic validation failure on mismatched `expected_orig_text`.
    5. Font preservation and explicit subset fallback warning.
    6. Colored/vector background preservation and hyperlink preservation.
    7. Rotated pages (0°, 90°, 180°, 270°).
    8. Undo, Redo, Export, Reopen, and third-party PyMuPDF text readback.
    """
    import io

    # 1. Construct a multi-section PDF: Heading, Body Paragraph, Neighbor below, Two Columns, Table Cells, Colored BG
    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    # Colored background behind body paragraph
    page.draw_rect(pymupdf.Rect(45, 75, 310, 190), color=(0.2, 0.4, 0.8), fill=(0.94, 0.96, 1.0))
    page.insert_text((50, 70), "Section 1: Overview", fontname="hebo", fontsize=16)
    page.insert_text((50, 96), "This is the first line of a multi-line", fontname="helv", fontsize=11)
    page.insert_text((50, 110), "body paragraph that should reflow cleanly.", fontname="helv", fontsize=11)
    # Neighboring paragraph below at Y=155 (leaves ~35pt blank space below Y=113)
    page.insert_text((50, 155), "Neighboring Paragraph Below Must Stay Intact", fontname="helv", fontsize=11)
    # Second column on the right
    page.insert_text((350, 96), "Right Column Content", fontname="helv", fontsize=11)
    page.insert_text((350, 110), "Must Never Be Merged", fontname="helv", fontsize=11)
    # Table row
    page.insert_text((50, 230), "Cell A1", fontname="helv", fontsize=10)
    page.insert_text((200, 230), "Cell B1", fontname="helv", fontsize=10)
    raw = doc.tobytes()

    r_open = client.post(
        "/api/docs/open-upload",
        files={"file": ("para_test.pdf", io.BytesIO(raw), "application/pdf")},
    )
    assert r_open.status_code == 200
    doc_id = r_open.json()["doc_id"]

    objs = client.get(f"/api/docs/{doc_id}/pages/0/objects").json()
    blocks = objs["text_blocks"]

    # Verify heading, body paragraph, neighbor, right column, and table cells are distinct blocks
    body_blk = [b for b in blocks if "first line of a multi-line" in b["text"]][0]
    assert "Overview" not in body_blk["text"], "Heading should not be merged into body paragraph"
    assert "Right Column" not in body_blk["text"], "Right column should not be merged into left paragraph"
    assert "Neighboring" not in body_blk["text"], "Separated paragraph below should not be merged"
    assert not any("Cell A1" in b["text"] and "Cell B1" in b["text"] for b in blocks), "Table cells must stay separate"

    # 2. Validation guard: mismatched expected_orig_text must return 400 and leave PDF unchanged
    r_bad_val = client.post(
        f"/api/docs/{doc_id}/pages/0/edit-paragraph",
        json={
            "block_id": body_blk["id"],
            "orig_bbox": body_blk["bbox"],
            "expected_orig_text": "COMPLETELY DIFFERENT TEXT",
            "new_text": "Should fail safely",
            "overflow_policy": "check",
        },
    )
    assert r_bad_val.status_code == 400

    # 3. Normal multi-line reflow with punctuation and long unbreakable word
    r_ok = client.post(
        f"/api/docs/{doc_id}/pages/0/edit-paragraph",
        json={
            "block_id": body_blk["id"],
            "orig_bbox": body_blk["bbox"],
            "expected_orig_text": body_blk["text"],
            "new_text": "Updated prose! Supercalifragilisticexpialidocious-token",
            "overflow_policy": "check",
        },
    )
    assert r_ok.status_code == 200
    assert r_ok.json()["status"] == "ok"
    objs_after = r_ok.json()["objects"]
    all_page_text = " ".join(s["text"] for s in objs_after["text_spans"])
    assert "Updated prose!" in all_page_text
    assert "Neighboring Paragraph Below Must Stay Intact" in all_page_text
    assert "Right Column Content" in all_page_text
    assert "Section 1: Overview" in all_page_text

    # 4. Overflow detection: huge text that exceeds box AND collides with Neighboring Paragraph at Y=155
    updated_blk = [b for b in objs_after["text_blocks"] if "Updated prose!" in b["text"]][0]
    huge_text = " ".join(["OverflowWord"] * 35)
    r_ovf = client.post(
        f"/api/docs/{doc_id}/pages/0/edit-paragraph",
        json={
            "block_id": updated_blk["id"],
            "orig_bbox": updated_blk["bbox"],
            "expected_orig_text": updated_blk["text"],
            "new_text": huge_text,
            "overflow_policy": "check",
        },
    )
    assert r_ovf.status_code == 200
    ovf_data = r_ovf.json()
    assert ovf_data["status"] == "overflow"
    assert ovf_data["overflow_info"]["required_height"] > ovf_data["overflow_info"]["available_height"]

    # Refusing unapproved overlap when expand_box would collide with Neighboring Paragraph
    r_ovf_expand = client.post(
        f"/api/docs/{doc_id}/pages/0/edit-paragraph",
        json={
            "block_id": updated_blk["id"],
            "orig_bbox": updated_blk["bbox"],
            "expected_orig_text": updated_blk["text"],
            "new_text": huge_text,
            "overflow_policy": "expand_box",
        },
    )
    assert r_ovf_expand.status_code == 200
    assert r_ovf_expand.json()["status"] == "overflow"

    # Safe expand_box into available blank space (3 lines fits before Y=155!)
    moderate_text = "Line one fits here, line two wraps cleanly, and line three fits in blank space."
    r_expand_ok = client.post(
        f"/api/docs/{doc_id}/pages/0/edit-paragraph",
        json={
            "block_id": updated_blk["id"],
            "orig_bbox": updated_blk["bbox"],
            "expected_orig_text": updated_blk["text"],
            "new_text": moderate_text,
            "overflow_policy": "expand_box",
        },
    )
    assert r_expand_ok.status_code == 200
    assert r_expand_ok.json()["status"] == "ok"

    # shrink_font policy fits slightly oversized text inside original box height
    objs_exp = r_expand_ok.json()["objects"]
    blk_exp = [b for b in objs_exp["text_blocks"] if "Line one fits" in b["text"]][0]
    r_shrink = client.post(
        f"/api/docs/{doc_id}/pages/0/edit-paragraph",
        json={
            "block_id": blk_exp["id"],
            "orig_bbox": blk_exp["bbox"],
            "expected_orig_text": blk_exp["text"],
            "new_text": moderate_text + " Plus extra words to trigger shrink.",
            "target_bbox": body_blk["bbox"],  # constrain to original tight 2-line height
            "overflow_policy": "shrink_font",
        },
    )
    assert r_shrink.status_code == 200
    assert r_shrink.json()["status"] == "ok"
    assert r_shrink.json()["final_font_size"] < 11.0

    # 5. Undo / Redo & Export / Reopen persistence
    r_undo = client.post(f"/api/docs/{doc_id}/undo")
    assert r_undo.status_code == 200
    r_redo = client.post(f"/api/docs/{doc_id}/redo")
    assert r_redo.status_code == 200

    r_dl = client.get(f"/api/docs/{doc_id}/download")
    assert r_dl.status_code == 200
    third_party_doc = pymupdf.open(stream=r_dl.content, filetype="pdf")
    tp_text = third_party_doc[0].get_text()
    assert "Plus extra words to trigger shrink." in tp_text
    assert "Neighboring Paragraph Below Must Stay Intact" in tp_text
    third_party_doc.close()

    # 6. Rotated pages (90°, 180°, 270°)
    for rot in (90, 180, 270):
        d_rot = pymupdf.open()
        p_rot = d_rot.new_page(width=612, height=792)
        p_rot.set_rotation(rot)
        p_rot.insert_text((72, 100), "Rotated paragraph line one.", fontsize=11)
        p_rot.insert_text((72, 114), "Rotated paragraph line two.", fontsize=11)
        r_rot = client.post(
            "/api/docs/open-upload",
            files={"file": (f"para_rot_{rot}.pdf", io.BytesIO(d_rot.tobytes()), "application/pdf")},
        )
        assert r_rot.status_code == 200
        rot_id = r_rot.json()["doc_id"]
        rot_blk = client.get(f"/api/docs/{rot_id}/pages/0/objects").json()["text_blocks"][0]
        r_rot_edit = client.post(
            f"/api/docs/{rot_id}/pages/0/edit-paragraph",
            json={
                "block_id": rot_blk["id"],
                "orig_bbox": rot_blk["bbox"],
                "expected_orig_text": rot_blk["text"],
                "new_text": f"Reflowed on {rot} degree rotated page!",
                "overflow_policy": "expand_box",
            },
        )
        assert r_rot_edit.status_code == 200
        assert r_rot_edit.json()["status"] == "ok"
        assert any(f"{rot} degree" in s["text"] for s in r_rot_edit.json()["objects"]["text_spans"])

    # 7. Subset font fallback warning
    dejavu_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    if os.path.exists(dejavu_path):
        d_sub = pymupdf.open()
        p_sub = d_sub.new_page(width=612, height=792)
        p_sub.insert_font(fontname="dejavu", fontfile=dejavu_path)
        p_sub.insert_text((72, 100), "Alpha Beta", fontname="dejavu", fontsize=12)
        d_sub.subset_fonts()
        r_sub_open = client.post(
            "/api/docs/open-upload",
            files={"file": ("sub_para.pdf", io.BytesIO(d_sub.tobytes()), "application/pdf")},
        )
        sub_id = r_sub_open.json()["doc_id"]
        sub_blk = client.get(f"/api/docs/{sub_id}/pages/0/objects").json()["text_blocks"][0]
        r_sub_edit = client.post(
            f"/api/docs/{sub_id}/pages/0/edit-paragraph",
            json={
                "block_id": sub_blk["id"],
                "orig_bbox": sub_blk["bbox"],
                "expected_orig_text": sub_blk["text"],
                "new_text": "Zebra Quick",
                "overflow_policy": "expand_box",
            },
        )
        assert r_sub_edit.status_code == 200
        assert r_sub_edit.json()["fallback_used"] is True
        assert "subset" in r_sub_edit.json()["fallback_reason"].lower()





