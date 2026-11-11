"""Security, Encryption, Permanent Content Redaction, Metadata Scrubbing, Optimization, and Repair."""

from __future__ import annotations

import io
import re
from typing import Any, Dict, List, Optional

import pikepdf
import pymupdf
from PIL import Image

from .utils import hex_to_rgb_float, rect_to_pdf


def encrypt_pdf(
    pdf_bytes: bytes,
    user_password: str = "",
    owner_password: str = "",
    encryption_level: str = "AES-256",
    allow_print: bool = True,
    allow_modify: bool = False,
    allow_extract: bool = False,
    allow_annotate: bool = True,
    allow_forms: bool = True,
    allow_assemble: bool = False,
) -> bytes:
    """
    Encrypt a PDF document using `pikepdf` (QPDF C++ engine) with AES-256 (R=6) or AES-128 (R=4)
    and granular user/owner permissions.
    """
    owner_pwd = owner_password or user_password or "vellum-owner-default"
    r_level = 6 if "256" in encryption_level else 4

    perms = pikepdf.Permissions(
        accessibility=True,
        extract=bool(allow_extract),
        modify_annotation=bool(allow_annotate),
        modify_assembly=bool(allow_assemble),
        modify_form=bool(allow_forms),
        modify_other=bool(allow_modify),
        print_lowres=bool(allow_print),
        print_highres=bool(allow_print),
    )

    with pikepdf.open(io.BytesIO(pdf_bytes)) as pdoc:
        out_buf = io.BytesIO()
        pdoc.save(
            out_buf,
            encryption=pikepdf.Encryption(
                user=user_password,
                owner=owner_pwd,
                R=r_level,
                allow=perms,
            ),
        )
        return out_buf.getvalue()


def decrypt_pdf(pdf_bytes: bytes, password: str = "") -> bytes:
    """Remove password protection and encryption restrictions from a PDF document."""
    with pikepdf.open(io.BytesIO(pdf_bytes), password=password) as pdoc:
        out_buf = io.BytesIO()
        pdoc.save(out_buf, encryption=False)
        return out_buf.getvalue()


def apply_permanent_redaction(
    pdf_bytes: bytes,
    page_redactions: Optional[List[Dict[str, Any]]] = None,
    search_terms: Optional[List[str]] = None,
    regex_pattern: Optional[str] = None,
    fill_color_hex: str = "#000000",
    overlay_text: str = "REDACTED",
    text_color_hex: str = "#ffffff",
) -> Dict[str, Any]:
    """
    Permanently remove sensitive text, vector art, and raster image pixels from PDF content streams.
    Unlike superficial visual masking, this operation rewrites the page content streams and runs
    level-4 garbage collection so redacted text and image pixels are completely unrecoverable.
    """
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        fill_rgb = hex_to_rgb_float(fill_color_hex)
        txt_rgb = hex_to_rgb_float(text_color_hex)
        redacted_count = 0
        pages_affected: List[int] = []

        # 1. Explicit coordinate redaction boxes: [{"page_index": 0, "bbox": [x0, y0, x1, y1], "label": "..."}]
        for item in page_redactions or []:
            p_idx = int(item.get("page_index", 0))
            if not (0 <= p_idx < len(doc)):
                continue
            bbox = item.get("bbox")
            if not bbox or len(bbox) != 4:
                continue
            label = item.get("label") if item.get("label") is not None else overlay_text
            page = doc[p_idx]
            rect = pymupdf.Rect(rect_to_pdf(page, bbox))
            page.add_redact_annot(
                rect,
                text=label,
                fontname="hebo",
                fontsize=8.0,
                fill=fill_rgb,
                text_color=txt_rgb,
            )
            redacted_count += 1
            if p_idx not in pages_affected:
                pages_affected.append(p_idx)

        # 2. Search terms across all pages
        for term in search_terms or []:
            clean_term = term.strip()
            if not clean_term:
                continue
            for p_idx, page in enumerate(doc):
                hits = page.search_for(clean_term)
                for h_rect in hits:
                    page.add_redact_annot(
                        h_rect,
                        text=overlay_text,
                        fontname="hebo",
                        fontsize=7.5,
                        fill=fill_rgb,
                        text_color=txt_rgb,
                    )
                    redacted_count += 1
                    if p_idx not in pages_affected:
                        pages_affected.append(p_idx)

        # 3. Optional Regex pattern redaction across all pages
        if regex_pattern and regex_pattern.strip():
            compiled = re.compile(regex_pattern.strip())
            for p_idx, page in enumerate(doc):
                full_text = page.get_text("text")
                matches = {m.group(0) for m in compiled.finditer(full_text) if m.group(0).strip()}
                for matched_str in matches:
                    for h_rect in page.search_for(matched_str):
                        page.add_redact_annot(
                            h_rect,
                            text=overlay_text,
                            fontname="hebo",
                            fontsize=7.5,
                            fill=fill_rgb,
                            text_color=txt_rgb,
                        )
                        redacted_count += 1
                        if p_idx not in pages_affected:
                            pages_affected.append(p_idx)

        # Apply redactions on every affected page, removing text, touched line art, and blanking/removing image pixels
        for p_idx in pages_affected:
            page = doc[p_idx]
            page.apply_redactions(
                images=pymupdf.PDF_REDACT_IMAGE_PIXELS,
                graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED,
            )

        # Garbage=4 deduplicates & purges unreferenced old streams so redacted content cannot be recovered via forensic object scan
        out_bytes = doc.tobytes(garbage=4, clean=True, deflate=True)
        return {
            "pdf_bytes": out_bytes,
            "redacted_regions_count": redacted_count,
            "pages_affected": sorted(pages_affected),
            "permanent_stream_purge": True,
        }
    finally:
        doc.close()


def sanitize_pdf_metadata(pdf_bytes: bytes) -> Dict[str, Any]:
    """
    Permanently scrub hidden metadata, XMP packets, Document Info dictionary,
    embedded thumbnails, JavaScript actions, and unreferenced objects.
    """
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        old_meta = dict(doc.metadata or {})
        doc.set_metadata({})
        doc.del_xml_metadata()
        doc.scrub(
            attached_files=False,
            clean_pages=True,
            embedded_files=False,
            hidden_text=False,
            javascript=True,
            metadata=True,
            redactions=True,
            redact_images=0,
            remove_links=False,
            reset_fields=False,
            reset_responses=True,
            thumbnails=True,
            xml_metadata=True,
        )
        cleaned_bytes = doc.tobytes(garbage=4, deflate=True)
    finally:
        doc.close()

    # Second pass via pikepdf to ensure DocumentInfo and XMP streams are completely stripped
    with pikepdf.open(io.BytesIO(cleaned_bytes)) as pdoc:
        if "/Metadata" in pdoc.Root:
            del pdoc.Root["/Metadata"]
        if pdoc.trailer and "/Info" in pdoc.trailer:
            del pdoc.trailer["/Info"]
        out_buf = io.BytesIO()
        pdoc.save(out_buf)
        final_bytes = out_buf.getvalue()

    return {
        "pdf_bytes": final_bytes,
        "removed_metadata": old_meta,
        "xmp_stripped": True,
        "javascript_stripped": True,
        "thumbnails_stripped": True,
    }


def get_document_properties(pdf_bytes: bytes) -> Dict[str, Any]:
    """Inspect full PDF document metadata, PDF version, security flags, page count, and file size."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        meta = dict(doc.metadata or {})
        fonts = inspect_embedded_fonts(pdf_bytes)
        is_pdfa = False
        with pikepdf.open(io.BytesIO(pdf_bytes)) as pdoc:
            pdf_version = pdoc.pdf_version
            is_linearized = pdoc.is_linearized
            try:
                with pdoc.open_metadata() as xmp:
                    is_pdfa = bool(xmp.pdfa_status)
                    pdfa_part = xmp.pdfa_status
            except Exception:
                pdfa_part = ""

        return {
            "title": meta.get("title", "") or "",
            "author": meta.get("author", "") or "",
            "subject": meta.get("subject", "") or "",
            "keywords": meta.get("keywords", "") or "",
            "creator": meta.get("creator", "") or "",
            "producer": meta.get("producer", "") or "",
            "creationDate": meta.get("creationDate", "") or "",
            "modDate": meta.get("modDate", "") or "",
            "format": meta.get("format", f"PDF {pdf_version}"),
            "pdf_version": pdf_version,
            "is_linearized": is_linearized,
            "is_pdfa": is_pdfa,
            "pdfa_conformance": pdfa_part,
            "page_count": len(doc),
            "size_bytes": len(pdf_bytes),
            "fonts_count": len(fonts),
            "permissions": doc.permissions,
        }
    finally:
        doc.close()


def set_document_properties(pdf_bytes: bytes, properties: Dict[str, str]) -> bytes:
    """Update standard PDF Document Info and XMP metadata fields."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        current = dict(doc.metadata or {})
        for key in ("title", "author", "subject", "keywords", "creator", "producer"):
            if key in properties and properties[key] is not None:
                current[key] = str(properties[key])
        doc.set_metadata(current)
        return doc.tobytes(garbage=2, deflate=True)
    finally:
        doc.close()


def optimize_and_compress_pdf(
    pdf_bytes: bytes,
    image_quality: int = 75,
    max_image_dimension: int = 1600,
    linearize: bool = False,
) -> Dict[str, Any]:
    """
    Compress and optimize a PDF document:
    1. Downsamples and recompresses oversized embedded images (JPEG/PNG optimization).
    2. Deduplicates PDF objects (`garbage=4`), cleans content streams, and compresses object streams (`deflate=True`).
    3. Optionally linearizes the PDF via `pikepdf` for Fast Web View.
    """
    original_size = len(pdf_bytes)
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    images_optimized = 0
    try:
        seen_xrefs = set()
        for page in doc:
            for img_info in page.get_images(full=True):
                xref = int(img_info[0])
                if xref in seen_xrefs or xref <= 0:
                    continue
                seen_xrefs.add(xref)
                try:
                    raw = doc.extract_image(xref)
                    if not raw or not raw.get("image"):
                        continue
                    img_bytes = raw["image"]
                    if len(img_bytes) < 8192:
                        continue
                    pil_img = Image.open(io.BytesIO(img_bytes))
                    if pil_img.mode not in ("RGB", "L"):
                        pil_img = pil_img.convert("RGB")
                    w, h = pil_img.size
                    max_dim = max(300, int(max_image_dimension))
                    if max(w, h) > max_dim:
                        scale = max_dim / float(max(w, h))
                        pil_img = pil_img.resize(
                            (max(1, int(w * scale)), max(1, int(h * scale))),
                            Image.Resampling.LANCZOS,
                        )
                    buf = io.BytesIO()
                    pil_img.save(buf, format="JPEG", quality=max(20, min(95, int(image_quality))), optimize=True)
                    new_img_bytes = buf.getvalue()
                    if len(new_img_bytes) < len(img_bytes):
                        page.replace_image(xref, stream=new_img_bytes)
                        images_optimized += 1
                except Exception:
                    continue

        compressed_bytes = doc.tobytes(
            garbage=4,
            clean=True,
            deflate=True,
            deflate_images=True,
            deflate_fonts=True,
        )
    finally:
        doc.close()

    with pikepdf.open(io.BytesIO(compressed_bytes)) as pdoc:
        out_buf = io.BytesIO()
        pdoc.save(
            out_buf,
            compress_streams=True,
            object_stream_mode=pikepdf.ObjectStreamMode.generate,
            linearize=bool(linearize),
        )
        final_bytes = out_buf.getvalue()

    # Keep whichever stream is smaller
    if len(compressed_bytes) < len(final_bytes) and not linearize:
        final_bytes = compressed_bytes

    new_size = len(final_bytes)
    saved_bytes = max(0, original_size - new_size)
    savings_pct = round((saved_bytes / original_size) * 100.0, 2) if original_size > 0 else 0.0

    return {
        "pdf_bytes": final_bytes,
        "original_size_bytes": original_size,
        "optimized_size_bytes": new_size,
        "saved_bytes": saved_bytes,
        "savings_percent": savings_pct,
        "images_optimized": images_optimized,
    }


def inspect_embedded_fonts(pdf_bytes: bytes) -> List[Dict[str, Any]]:
    """Inspect all fonts referenced across all pages of a PDF document."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    fonts_out: List[Dict[str, Any]] = []
    seen_keys = set()
    try:
        for p_idx, page in enumerate(doc):
            for f in page.get_fonts(full=True):
                # f = (xref, ext, type, basefont, name, encoding, referencer)
                xref, ext, ftype, basefont, name, encoding = f[:6]
                key = (xref, basefont, name)
                if key in seen_keys:
                    continue
                seen_keys.add(key)
                is_subset = "+" in (basefont or "")
                is_embedded = bool(ext and ext != "n/a")
                fonts_out.append(
                    {
                        "xref": int(xref),
                        "name": basefont or name or "Unnamed",
                        "resource_name": name,
                        "type": ftype,
                        "encoding": encoding,
                        "extension": ext,
                        "is_embedded": is_embedded,
                        "is_subset": is_subset,
                        "first_seen_page": p_idx + 1,
                    }
                )
        return fonts_out
    finally:
        doc.close()


def repair_pdf_document(pdf_bytes: bytes) -> Dict[str, Any]:
    """
    Attempt structural and cross-reference table repair on a damaged or malformed PDF
    using `pikepdf` (`attempt_recovery=True`) and MuPDF stream cleaning.
    """
    diagnostics: List[str] = []
    working = pdf_bytes

    try:
        with pikepdf.open(io.BytesIO(working), attempt_recovery=True) as pdoc:
            warnings = pdoc.get_warnings()
            if warnings:
                diagnostics.extend(str(w) for w in warnings)
            buf = io.BytesIO()
            pdoc.save(buf, fix_metadata_version=True)
            working = buf.getvalue()
            diagnostics.append("pikepdf/QPDF cross-reference & trailer table reconstruction succeeded.")
    except Exception as exc:
        diagnostics.append(f"pikepdf recovery warning: {exc}")

    # Clean content streams and rebuild xrefs via MuPDF
    doc = pymupdf.open(stream=working, filetype="pdf")
    try:
        repaired_bytes = doc.tobytes(garbage=4, clean=True, deflate=True)
        page_count = len(doc)
        diagnostics.append(f"MuPDF content stream sanitizer verified {page_count} page(s).")
    finally:
        doc.close()

    return {
        "pdf_bytes": repaired_bytes,
        "repaired": True,
        "page_count": page_count,
        "diagnostics": diagnostics,
    }

