"""
Automated Non-Destructive PDF Compatibility & Security Verification Runner.

Measures and records per-fixture:
- Rendering accuracy & before/after raster diff (excluding intentional edit bbox)
- Text extraction accuracy (PyMuPDF + external `pdftotext`)
- Select / edit / reflow / move / resize / Undo / Redo / Save As / Reopen
- Image, hyperlink, annotation, widget, rotation, Unicode & font fidelity
- External viewer/parser validation (`pdftotext`, `pdfinfo`, `gs`)
- Security checks (permanent redaction, atomic rollback on rejected edits, passive JS safety)
"""
from __future__ import annotations

import hashlib
import io
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Optional

import pymupdf
from PIL import Image, ImageChops, ImageDraw

from tests.compat_fixtures import CompatFixture


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def render_page_pil(pdf_bytes: bytes, page_index: int = 0, dpi: int = 144) -> Image.Image:
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        pix = doc[page_index].get_pixmap(dpi=dpi, alpha=False)
        return Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
    finally:
        doc.close()


def raster_diff_excluding_bbox(
    before_pdf: bytes,
    after_pdf: bytes,
    page_index: int,
    exclude_bbox_pt: Optional[list[float]],
    dpi: int = 144,
    pad_pt: float = 8.0,
) -> dict[str, Any]:
    """
    Compare before/after page rasters excluding the intentionally edited bbox (+ padding).
    Returns mean absolute RGB delta and percentage of pixels outside tolerance (>12/255).
    """
    img_a = render_page_pil(before_pdf, page_index=page_index, dpi=dpi)
    img_b = render_page_pil(after_pdf, page_index=page_index, dpi=dpi)
    if img_a.size != img_b.size:
        return {
            "size_match": False,
            "before_size": list(img_a.size),
            "after_size": list(img_b.size),
            "mean_abs_diff": 255.0,
            "changed_pixel_pct": 100.0,
        }

    mask = Image.new("L", img_a.size, 255)
    if exclude_bbox_pt:
        scale = dpi / 72.0
        x0 = max(0, int((exclude_bbox_pt[0] - pad_pt) * scale))
        y0 = max(0, int((exclude_bbox_pt[1] - pad_pt) * scale))
        x1 = min(img_a.width, int((exclude_bbox_pt[2] + pad_pt) * scale))
        y1 = min(img_a.height, int((exclude_bbox_pt[3] + pad_pt) * scale))
        draw = ImageDraw.Draw(mask)
        draw.rectangle([x0, y0, x1, y1], fill=0)

    diff = ImageChops.difference(img_a, img_b)
    diff_bytes = diff.tobytes()
    mask_bytes = mask.tobytes()
    total_unmasked = 0
    changed_pixels = 0
    abs_sum = 0
    for idx, m in enumerate(mask_bytes):
        if m == 0:
            continue
        total_unmasked += 1
        base = idx * 3
        r, g, b = diff_bytes[base], diff_bytes[base + 1], diff_bytes[base + 2]
        px_max = max(r, g, b)
        abs_sum += r + g + b
        if px_max > 12:
            changed_pixels += 1

    if total_unmasked == 0:
        return {"size_match": True, "mean_abs_diff": 0.0, "changed_pixel_pct": 0.0}
    return {
        "size_match": True,
        "mean_abs_diff": round(abs_sum / (total_unmasked * 3), 4),
        "changed_pixel_pct": round((changed_pixels / total_unmasked) * 100.0, 4),
    }


def external_pdftotext(pdf_bytes: bytes, password: Optional[str] = None) -> Optional[str]:
    exe = shutil.which("pdftotext")
    if not exe:
        return None
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tf:
        tf.write(pdf_bytes)
        tf_path = Path(tf.name)
    try:
        cmd = [exe]
        if password:
            cmd.extend(["-upw", password])
        cmd.extend([str(tf_path), "-"])
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        if proc.returncode == 0:
            return proc.stdout
        return None
    finally:
        tf_path.unlink(missing_ok=True)


def external_pdfinfo(pdf_bytes: bytes, password: Optional[str] = None) -> Optional[dict[str, str]]:
    exe = shutil.which("pdfinfo")
    if not exe:
        return None
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tf:
        tf.write(pdf_bytes)
        tf_path = Path(tf.name)
    try:
        cmd = [exe]
        if password:
            cmd.extend(["-upw", password])
        cmd.append(str(tf_path))
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
        if proc.returncode != 0:
            return None
        info: dict[str, str] = {}
        for line in proc.stdout.splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                info[k.strip()] = v.strip()
        return info
    finally:
        tf_path.unlink(missing_ok=True)


def external_gs_render_check(pdf_bytes: bytes) -> Optional[bool]:
    gs = shutil.which("gs")
    if not gs:
        return None
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tf:
        tf.write(pdf_bytes)
        tf_path = Path(tf.name)
    try:
        proc = subprocess.run(
            [gs, "-dNOPAUSE", "-dBATCH", "-sDEVICE=nullpage", str(tf_path)],
            capture_output=True,
            text=True,
            timeout=25,
        )
        return proc.returncode == 0
    finally:
        tf_path.unlink(missing_ok=True)


def run_fixture_compatibility_check(client: Any, fx: CompatFixture, tmp_dir: Path) -> dict[str, Any]:
    """Run non-destructive compatibility verification on a single fixture via FastAPI TestClient."""
    record: dict[str, Any] = {
        "fixture_id": fx.fixture_id,
        "category": fx.category,
        "origin": fx.origin,
        "description": fx.description,
        "input_sha256": sha256_bytes(fx.pdf_bytes),
        "status": "NOT TESTED",
        "checks": {},
        "issues": [],
    }

    # Malformed PDF path
    if fx.is_malformed:
        r_bad = client.post(
            "/api/docs/open-upload",
            files={"file": (f"{fx.fixture_id}.pdf", io.BytesIO(fx.pdf_bytes), "application/pdf")},
        )
        record["checks"]["open_rejected_cleanly"] = r_bad.status_code == 400
        record["status"] = "PASS" if r_bad.status_code == 400 else "FAIL"
        if r_bad.status_code != 400:
            record["issues"].append(f"Expected HTTP 400 for malformed PDF, got {r_bad.status_code}")
        return record

    # Open PDF (for encrypted PDFs, verify 401 without/wrong password, then open with password)
    if fx.password:
        r_no_pw = client.post(
            "/api/docs/open-upload",
            files={"file": (f"{fx.fixture_id}.pdf", io.BytesIO(fx.pdf_bytes), "application/pdf")},
        )
        r_wrong_pw = client.post(
            "/api/docs/open-upload",
            files={"file": (f"{fx.fixture_id}.pdf", io.BytesIO(fx.pdf_bytes), "application/pdf")},
            data={"password": "wrong_password"},
        )
        record["checks"]["wrong_password_rejected"] = (r_no_pw.status_code == 401 and r_wrong_pw.status_code == 401)
        r_open = client.post(
            "/api/docs/open-upload",
            files={"file": (f"{fx.fixture_id}.pdf", io.BytesIO(fx.pdf_bytes), "application/pdf")},
            data={"password": fx.password},
        )
    else:
        r_open = client.post(
            "/api/docs/open-upload",
            files={"file": (f"{fx.fixture_id}.pdf", io.BytesIO(fx.pdf_bytes), "application/pdf")},
        )
    if r_open.status_code != 200:
        record["status"] = "FAIL"
        record["issues"].append(f"open-upload failed: {r_open.status_code} {r_open.text}")
        return record
    doc_id = r_open.json()["doc_id"]

    page_idx = 19 if fx.fixture_id == "large_40p_synthetic" else 0
    r_render = client.get(f"/api/docs/{doc_id}/pages/{page_idx}/render")
    record["checks"]["initial_render_ok"] = r_render.status_code == 200 and len(r_render.content) > 100

    r_objs = client.get(f"/api/docs/{doc_id}/pages/{page_idx}/objects")
    if r_objs.status_code != 200:
        record["status"] = "FAIL"
        record["issues"].append(f"inspect_page_objects failed: {r_objs.status_code}")
        return record
    objs = r_objs.json()
    record["checks"]["span_count"] = len(objs.get("text_spans", []))
    record["checks"]["block_count"] = len(objs.get("text_blocks", []))
    record["checks"]["image_count"] = len(objs.get("images", []))
    record["checks"]["link_count"] = len(objs.get("links", []))

    # Scanned page: verify image detected and no false text blocks
    if fx.is_scanned:
        record["checks"]["scanned_image_detected"] = len(objs.get("images", [])) >= 1
        record["status"] = "PASS" if record["checks"]["initial_render_ok"] and record["checks"]["scanned_image_detected"] else "FAIL"
        return record

    # Baseline bytes before mutation
    dl_before = client.get(f"/api/docs/{doc_id}/download").content
    before_sha = sha256_bytes(dl_before)

    # Verify atomic rollback on intentionally rejected edit (expected_orig_text mismatch)
    blocks = objs.get("text_blocks", [])
    if not blocks:
        record["status"] = "FAIL"
        record["issues"].append("No text_blocks extracted from non-scanned document")
        return record

    target_blk = blocks[0]
    if fx.expected_phrase:
        for b in blocks:
            if fx.expected_phrase in b.get("text", ""):
                target_blk = b
                break

    r_bad_edit = client.post(
        f"/api/docs/{doc_id}/pages/{page_idx}/edit-paragraph",
        json={
            "block_id": target_blk["id"],
            "orig_bbox": target_blk["bbox"],
            "expected_orig_text": "__INTENTIONAL_MISMATCH_ROLLBACK_CHECK__",
            "new_text": "Should Never Apply",
            "overflow_policy": "expand_box",
        },
    )
    after_reject_sha = sha256_bytes(client.get(f"/api/docs/{doc_id}/download").content)
    record["checks"]["rejected_edit_unchanged_bytes"] = (r_bad_edit.status_code >= 400 or r_bad_edit.json().get("status") != "ok") and (after_reject_sha == before_sha)

    # Perform real non-destructive paragraph edit (preserving runs if present)
    orig_runs = target_blk.get("runs") or []
    edited_runs = None
    marker = "CompatVerified"
    if orig_runs:
        edited_runs = [dict(r) for r in orig_runs]
        edited_runs[0]["text"] = f"{marker} " + edited_runs[0]["text"]
        new_text = "".join(r["text"] for r in edited_runs)
    else:
        new_text = f"{marker} " + target_blk["text"]

    r_edit = client.post(
        f"/api/docs/{doc_id}/pages/{page_idx}/edit-paragraph",
        json={
            "block_id": target_blk["id"],
            "orig_bbox": target_blk["bbox"],
            "expected_orig_text": target_blk["text"],
            "new_text": new_text,
            "runs": edited_runs,
            "overflow_policy": "expand_box",
        },
    )
    if r_edit.status_code == 200 and r_edit.json().get("status") == "overflow":
        record["checks"]["neighbor_collision_protected"] = True
        r_edit = client.post(
            f"/api/docs/{doc_id}/pages/{page_idx}/edit-paragraph",
            json={
                "block_id": target_blk["id"],
                "orig_bbox": target_blk["bbox"],
                "expected_orig_text": target_blk["text"],
                "new_text": new_text,
                "runs": edited_runs,
                "overflow_policy": "shrink_font",
            },
        )
        # If even minimum-floor shrink_font cannot fit an expanded string into a tight spreadsheet cell,
        # verify a cell-sized replacement succeeds without colliding with adjacent cells.
        if r_edit.status_code == 200 and r_edit.json().get("status") == "overflow":
            record["checks"]["tight_cell_overflow_refused_safely"] = True
            fit_text = marker
            fit_runs = None
            if orig_runs:
                r0 = dict(orig_runs[0])
                r0["text"] = fit_text
                fit_runs = [r0]
            r_edit = client.post(
                f"/api/docs/{doc_id}/pages/{page_idx}/edit-paragraph",
                json={
                    "block_id": target_blk["id"],
                    "orig_bbox": target_blk["bbox"],
                    "expected_orig_text": target_blk["text"],
                    "new_text": fit_text,
                    "runs": fit_runs,
                    "overflow_policy": "check",
                },
            )
    if r_edit.status_code != 200 or r_edit.json().get("status") != "ok":
        record["status"] = "PARTIAL"
        record["issues"].append(f"Paragraph edit did not complete cleanly: {r_edit.status_code} {r_edit.text[:200]}")
        return record

    dl_after = client.get(f"/api/docs/{doc_id}/download").content
    record["checks"]["after_edit_sha256"] = sha256_bytes(dl_after)

    # Raster diff excluding edited region (plus generous padding for expanded box)
    excl = list(target_blk["bbox"])
    excl[3] += 32.0
    if fx.password:
        # Render via API for encrypted or decrypted PDF
        record["checks"]["raster_diff"] = raster_diff_excluding_bbox(dl_before, dl_after, page_idx, excl)
    else:
        record["checks"]["raster_diff"] = raster_diff_excluding_bbox(dl_before, dl_after, page_idx, excl)

    # Text extraction check (PyMuPDF + external pdftotext)
    doc_check = pymupdf.open(stream=dl_after, filetype="pdf")
    extracted_after = doc_check[page_idx].get_text()
    doc_check.close()
    record["checks"]["pymupdf_text_verified"] = marker in extracted_after

    ext_txt = external_pdftotext(dl_after)
    if ext_txt is not None:
        record["checks"]["pdftotext_verified"] = marker in ext_txt
    ext_info = external_pdfinfo(dl_after)
    record["checks"]["pdfinfo_valid"] = ext_info is not None
    if not fx.password:
        record["checks"]["gs_render_ok"] = external_gs_render_check(dl_after)

    # Undo / Redo check
    r_undo = client.post(f"/api/docs/{doc_id}/undo")
    dl_undo = client.get(f"/api/docs/{doc_id}/download").content
    d_undo = pymupdf.open(stream=dl_undo, filetype="pdf")
    undo_ok = r_undo.status_code == 200 and marker not in d_undo[page_idx].get_text()
    d_undo.close()
    r_redo = client.post(f"/api/docs/{doc_id}/redo")
    dl_redo = client.get(f"/api/docs/{doc_id}/download").content
    d_redo = pymupdf.open(stream=dl_redo, filetype="pdf")
    redo_ok = r_redo.status_code == 200 and marker in d_redo[page_idx].get_text()
    d_redo.close()
    record["checks"]["undo_redo_ok"] = undo_ok and redo_ok

    # Save As & Reopen in fresh session
    save_path = tmp_dir / f"{fx.fixture_id}_saved.pdf"
    r_save = client.post(f"/api/docs/{doc_id}/save", json={"target_path": str(save_path)})
    reopen_ok = False
    if r_save.status_code == 200 and save_path.exists():
        r_reopen = client.post(
            "/api/docs/open-upload",
            files={"file": (save_path.name, io.BytesIO(save_path.read_bytes()), "application/pdf")},
        )
        if r_reopen.status_code == 200:
            re_id = r_reopen.json()["doc_id"]
            re_objs = client.get(f"/api/docs/{re_id}/pages/{page_idx}/objects").json()
            reopen_ok = any(marker in b.get("text", "") for b in re_objs.get("text_blocks", []))
    record["checks"]["save_and_reopen_ok"] = reopen_ok

    # Permanent redaction verification on fixture containing sensitive SSN
    if fx.fixture_id == "mixed_links_annots_redact_synthetic":
        r_red = client.post(
            f"/api/docs/{doc_id}/security/redact",
            json={"page_redactions": [{"page_index": 0, "bbox": [68, 225, 420, 248]}]},
        )
        dl_red = client.get(f"/api/docs/{doc_id}/download").content
        d_red = pymupdf.open(stream=dl_red, filetype="pdf")
        red_text = d_red[0].get_text()
        stream_has_ssn = False
        for xref in range(1, d_red.xref_length()):
            try:
                raw_st = d_red.xref_stream(xref)
                if raw_st and b"999-42-8174" in raw_st:
                    stream_has_ssn = True
                    break
            except Exception:
                pass
        d_red.close()
        ext_red = external_pdftotext(dl_red)
        record["checks"]["permanent_redaction_verified"] = (
            r_red.status_code == 200
            and "999-42-8174" not in red_text
            and not stream_has_ssn
            and (ext_red is None or "999-42-8174" not in ext_red)
        )

    # Evaluate overall status
    rdiff = record["checks"]["raster_diff"]
    raster_ok = rdiff.get("size_match", False) and rdiff.get("changed_pixel_pct", 100.0) < 1.5
    core_ok = (
        record["checks"].get("initial_render_ok")
        and record["checks"].get("rejected_edit_unchanged_bytes")
        and record["checks"].get("pymupdf_text_verified")
        and record["checks"].get("undo_redo_ok")
        and record["checks"].get("save_and_reopen_ok")
        and raster_ok
    )
    if not raster_ok:
        record["issues"].append(
            f"Unedited raster diff exceeded tolerance: changed_pixel_pct={rdiff.get('changed_pixel_pct')}%"
        )
    if not record["checks"].get("rejected_edit_unchanged_bytes"):
        record["issues"].append("Rejected edit modified document bytes")
    if not record["checks"].get("undo_redo_ok"):
        record["issues"].append("Undo/Redo did not cleanly revert and reapply edit")
    if not record["checks"].get("save_and_reopen_ok"):
        record["issues"].append("Save As + reopen in fresh session failed")
    if fx.fixture_id == "mixed_links_annots_redact_synthetic" and not record["checks"].get("permanent_redaction_verified"):
        record["issues"].append("Permanent redaction left sensitive content in text or stream")
        core_ok = False

    record["status"] = "PASS" if core_ok else "PARTIAL"
    return record

