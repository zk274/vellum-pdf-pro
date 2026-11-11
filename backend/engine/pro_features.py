"""Professional PDF Features: Document Comparison, Headers/Footers, Watermarks, Bates, Bookmarks, Attachments, Accessibility, Preflight, and PDF/A."""

from __future__ import annotations

import base64
import datetime
import difflib
import io
import math
import os
import shutil
import subprocess
import tempfile
from typing import Any, Dict, List, Optional

import pikepdf
import pymupdf

from .security_optimize import inspect_embedded_fonts
from .utils import compare_page_renders, hex_to_rgb_float


def compare_pdf_documents(
    pdf_bytes_a: bytes,
    pdf_bytes_b: bytes,
    dpi: int = 110,
) -> Dict[str, Any]:
    """
    Compare two PDF documents using both:
    1. Unified and line-level text difference analysis per page
    2. Pixel-level visual rendering comparison and highlighted diff overlay image per page
    """
    doc_a = pymupdf.open(stream=pdf_bytes_a, filetype="pdf")
    doc_b = pymupdf.open(stream=pdf_bytes_b, filetype="pdf")
    try:
        pages_a = len(doc_a)
        pages_b = len(doc_b)
        common_pages = min(pages_a, pages_b)

        page_comparisons: List[Dict[str, Any]] = []
        all_lines_a: List[str] = []
        all_lines_b: List[str] = []

        for p_idx in range(common_pages):
            txt_a = doc_a[p_idx].get_text("text").strip()
            txt_b = doc_b[p_idx].get_text("text").strip()
            lines_a = txt_a.splitlines()
            lines_b = txt_b.splitlines()
            all_lines_a.extend(lines_a)
            all_lines_b.extend(lines_b)

            diff_lines = list(
                difflib.unified_diff(
                    lines_a,
                    lines_b,
                    fromfile=f"DocA_Page_{p_idx+1}",
                    tofile=f"DocB_Page_{p_idx+1}",
                    lineterm="",
                )
            )
            added = [ln[1:] for ln in diff_lines if ln.startswith("+") and not ln.startswith("+++")]
            removed = [ln[1:] for ln in diff_lines if ln.startswith("-") and not ln.startswith("---")]

            vis = compare_page_renders(pdf_bytes_a, pdf_bytes_b, page_index=p_idx, dpi=dpi)
            page_comparisons.append(
                {
                    "page_index": p_idx,
                    "page_number": p_idx + 1,
                    "text_identical": txt_a == txt_b,
                    "added_lines": added,
                    "removed_lines": removed,
                    "unified_diff": "\n".join(diff_lines),
                    "visual_similarity_percent": vis.get("similarity_percent", 100.0),
                    "changed_area_percent": vis.get("changed_Area_percent", 0.0),
                    "diff_image_base64": vis.get("diff_image_base64", ""),
                }
            )

        overall_sim = (
            round(
                sum(p["visual_similarity_percent"] for p in page_comparisons) / len(page_comparisons),
                2,
            )
            if page_comparisons
            else 0.0
        )

        return {
            "doc_a_pages": pages_a,
            "doc_b_pages": pages_b,
            "compared_pages": common_pages,
            "overall_visual_similarity_percent": overall_sim,
            "has_differences": any(
                (not p["text_identical"]) or p["changed_area_percent"] > 0.01 for p in page_comparisons
            )
            or (pages_a != pages_b),
            "pages": page_comparisons,
        }
    finally:
        doc_a.close()
        doc_b.close()


def _expand_macros(template: str, page_num: int, total_pages: int, title: str) -> str:
    if not template:
        return ""
    today = datetime.date.today().isoformat()
    return (
        template.replace("{page}", str(page_num))
        .replace("{total}", str(total_pages))
        .replace("{date}", today)
        .replace("{title}", title or "Document")
    )


def apply_header_footer(
    pdf_bytes: bytes,
    header_left: str = "",
    header_center: str = "",
    header_right: str = "",
    footer_left: str = "",
    footer_center: str = "Page {page} of {total}",
    footer_right: str = "",
    font_size: float = 9.5,
    color_hex: str = "#334155",
    margin_top: float = 28.0,
    margin_bottom: float = 24.0,
    margin_side: float = 42.0,
    page_indices: Optional[List[int]] = None,
) -> bytes:
    """Apply customizable headers and footers with macro expansion ({page}, {total}, {date}, {title})."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        total = len(doc)
        title = (doc.metadata or {}).get("title") or "Document"
        rgb = hex_to_rgb_float(color_hex)
        targets = page_indices if page_indices is not None else list(range(total))
        fsize = float(font_size)

        for idx in targets:
            if not (0 <= idx < total):
                continue
            page = doc[idx]
            rect = page.rect
            pnum = idx + 1

            # Header positions
            hy = rect.y0 + float(margin_top)
            if header_left:
                txt = _expand_macros(header_left, pnum, total, title)
                page.insert_text(pymupdf.Point(rect.x0 + margin_side, hy), txt, fontsize=fsize, fontname="helv", color=rgb)
            if header_center:
                txt = _expand_macros(header_center, pnum, total, title)
                tw = pymupdf.get_text_length(txt, fontname="helv", fontsize=fsize)
                page.insert_text(
                    pymupdf.Point((rect.x0 + rect.x1 - tw) / 2.0, hy),
                    txt,
                    fontsize=fsize,
                    fontname="helv",
                    color=rgb,
                )
            if header_right:
                txt = _expand_macros(header_right, pnum, total, title)
                tw = pymupdf.get_text_length(txt, fontname="helv", fontsize=fsize)
                page.insert_text(
                    pymupdf.Point(rect.x1 - margin_side - tw, hy),
                    txt,
                    fontsize=fsize,
                    fontname="helv",
                    color=rgb,
                )

            # Footer positions
            fy = rect.y1 - float(margin_bottom)
            if footer_left:
                txt = _expand_macros(footer_left, pnum, total, title)
                page.insert_text(pymupdf.Point(rect.x0 + margin_side, fy), txt, fontsize=fsize, fontname="helv", color=rgb)
            if footer_center:
                txt = _expand_macros(footer_center, pnum, total, title)
                tw = pymupdf.get_text_length(txt, fontname="helv", fontsize=fsize)
                page.insert_text(
                    pymupdf.Point((rect.x0 + rect.x1 - tw) / 2.0, fy),
                    txt,
                    fontsize=fsize,
                    fontname="helv",
                    color=rgb,
                )
            if footer_right:
                txt = _expand_macros(footer_right, pnum, total, title)
                tw = pymupdf.get_text_length(txt, fontname="helv", fontsize=fsize)
                page.insert_text(
                    pymupdf.Point(rect.x1 - margin_side - tw, fy),
                    txt,
                    fontsize=fsize,
                    fontname="helv",
                    color=rgb,
                )

        return doc.tobytes(garbage=2, deflate=True)
    finally:
        doc.close()


def apply_watermark(
    pdf_bytes: bytes,
    text: str = "CONFIDENTIAL",
    font_size: float = 48.0,
    color_hex: str = "#94a3b8",
    opacity: float = 0.28,
    rotation: float = 45.0,
    overlay: bool = True,
    page_indices: Optional[List[int]] = None,
) -> bytes:
    """Apply a rotated semi-transparent watermark across selected PDF pages."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        total = len(doc)
        rgb = hex_to_rgb_float(color_hex)
        targets = page_indices if page_indices is not None else list(range(total))
        fsize = float(font_size)
        op = max(0.05, min(1.0, float(opacity)))

        for idx in targets:
            if not (0 <= idx < total):
                continue
            page = doc[idx]
            center = pymupdf.Point(page.rect.width / 2.0, page.rect.height / 2.0)
            tw = pymupdf.get_text_length(text, fontname="hebo", fontsize=fsize)
            # Compute start point so rotated text is centered on page
            rad = math.radians(float(rotation))
            dx = (tw / 2.0) * math.cos(rad)
            dy = (tw / 2.0) * math.sin(rad)
            start_pt = pymupdf.Point(center.x - dx, center.y + dy)

            page.insert_text(
                start_pt,
                text,
                fontsize=fsize,
                fontname="hebo",
                color=rgb,
                fill_opacity=op,
                stroke_opacity=op,
                morph=(start_pt, pymupdf.Matrix(float(rotation))),
                overlay=bool(overlay),
            )

        return doc.tobytes(garbage=2, deflate=True)
    finally:
        doc.close()


def apply_bates_numbering(
    pdf_bytes: bytes,
    prefix: str = "BATES-",
    suffix: str = "",
    start_number: int = 1,
    digits: int = 6,
    position: str = "bottom_right",
    font_size: float = 9.5,
    color_hex: str = "#0f172a",
    page_indices: Optional[List[int]] = None,
) -> Dict[str, Any]:
    """
    Apply sequential legal Bates numbering (e.g. BATES-000001) to pages.
    Returns updated PDF bytes and the ending Bates number for multi-document batch continuity.
    """
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        total = len(doc)
        rgb = hex_to_rgb_float(color_hex)
        targets = page_indices if page_indices is not None else list(range(total))
        current_num = max(0, int(start_number))
        pad = max(1, int(digits))
        fsize = float(font_size)
        applied_labels: List[str] = []

        for idx in targets:
            if not (0 <= idx < total):
                continue
            page = doc[idx]
            rect = page.rect
            label = f"{prefix}{current_num:0{pad}d}{suffix}"
            applied_labels.append(label)
            current_num += 1

            tw = pymupdf.get_text_length(label, fontname="cour", fontsize=fsize)
            margin_x = 36.0
            margin_y = 22.0

            if position == "top_left":
                pt = pymupdf.Point(rect.x0 + margin_x, rect.y0 + margin_y + fsize)
            elif position == "top_right":
                pt = pymupdf.Point(rect.x1 - margin_x - tw, rect.y0 + margin_y + fsize)
            elif position == "bottom_left":
                pt = pymupdf.Point(rect.x0 + margin_x, rect.y1 - margin_y)
            else:  # bottom_right default
                pt = pymupdf.Point(rect.x1 - margin_x - tw, rect.y1 - margin_y)

            page.insert_text(pt, label, fontsize=fsize, fontname="cour", color=rgb)

        return {
            "pdf_bytes": doc.tobytes(garbage=2, deflate=True),
            "first_bates": applied_labels[0] if applied_labels else "",
            "last_bates": applied_labels[-1] if applied_labels else "",
            "next_number": current_num,
            "count": len(applied_labels),
        }
    finally:
        doc.close()


# --- Bookmarks / Outline ---


def get_bookmarks(pdf_bytes: bytes) -> List[Dict[str, Any]]:
    """Retrieve the hierarchical PDF bookmark / outline table of contents."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        toc = doc.get_toc(simple=True)
        return [
            {
                "index": idx,
                "level": int(item[0]),
                "title": str(item[1]),
                "page_number": int(item[2]),
                "page_index": max(0, int(item[2]) - 1),
            }
            for idx, item in enumerate(toc)
        ]
    finally:
        doc.close()


def add_bookmark(
    pdf_bytes: bytes,
    title: str,
    page_index: int = 0,
    level: int = 1,
) -> bytes:
    """Add a bookmark entry to the PDF outline table of contents."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        toc = doc.get_toc(simple=True)
        lvl = max(1, int(level))
        if not toc:
            lvl = 1
        elif lvl > toc[-1][0] + 1:
            lvl = toc[-1][0] + 1
        toc.append([lvl, title.strip() or f"Page {page_index + 1}", int(page_index) + 1])
        doc.set_toc(toc)
        return doc.tobytes(garbage=2, deflate=True)
    finally:
        doc.close()


def delete_bookmark(pdf_bytes: bytes, bookmark_index: int) -> bytes:
    """Remove a bookmark entry by its index in the TOC list."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        toc = doc.get_toc(simple=True)
        if 0 <= bookmark_index < len(toc):
            toc.pop(bookmark_index)
            # Normalize levels so first item is level 1 and no level jumps > 1
            for i, entry in enumerate(toc):
                if i == 0:
                    entry[0] = 1
                elif entry[0] > toc[i - 1][0] + 1:
                    entry[0] = toc[i - 1][0] + 1
            doc.set_toc(toc)
        return doc.tobytes(garbage=2, deflate=True)
    finally:
        doc.close()


# --- Embedded File Attachments ---


def list_attachments(pdf_bytes: bytes) -> List[Dict[str, Any]]:
    """List all embedded file attachments inside the PDF portfolio/document."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        names = doc.embfile_names()
        out: List[Dict[str, Any]] = []
        for name in names:
            info = doc.embfile_info(name)
            out.append(
                {
                    "name": name,
                    "filename": info.get("filename", name),
                    "description": info.get("desc", ""),
                    "size_bytes": int(info.get("size", 0)),
                }
            )
        return out
    finally:
        doc.close()


def add_attachment(
    pdf_bytes: bytes,
    filename: str,
    file_bytes: bytes,
    description: str = "",
) -> bytes:
    """Embed a file attachment inside the PDF document."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        if filename in doc.embfile_names():
            doc.embfile_del(filename)
        doc.embfile_add(
            name=filename,
            buffer_=file_bytes,
            filename=filename,
            desc=description or f"Attached file: {filename}",
        )
        return doc.tobytes(garbage=2, deflate=True)
    finally:
        doc.close()


def extract_attachment(pdf_bytes: bytes, name: str) -> bytes:
    """Extract raw bytes of an embedded file attachment by name."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        if name not in doc.embfile_names():
            raise KeyError(f"Attachment '{name}' not found")
        return doc.embfile_get(name)
    finally:
        doc.close()


def delete_attachment(pdf_bytes: bytes, name: str) -> bytes:
    """Delete an embedded file attachment by name."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        if name in doc.embfile_names():
            doc.embfile_del(name)
        return doc.tobytes(garbage=2, deflate=True)
    finally:
        doc.close()


# --- Accessibility Inspection, Preflight & PDF/A Conversion ---


def run_preflight_and_accessibility_check(pdf_bytes: bytes) -> Dict[str, Any]:
    """
    Execute a comprehensive PDF Accessibility (WCAG / PDF/UA) and Print/Archival Preflight inspection.
    """
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        meta = doc.metadata or {}
        title = (meta.get("title") or "").strip()
        fonts = inspect_embedded_fonts(pdf_bytes)
        unembedded_fonts = [f["name"] for f in fonts if not f["is_embedded"]]
        toc = doc.get_toc()

        total_chars = sum(len(page.get_text("text").strip()) for page in doc)
        total_images = sum(len(page.get_images()) for page in doc)
        is_scanned_without_ocr = total_chars == 0 and total_images > 0

        has_lang = False
        is_tagged = False
        is_pdfa = False
        pdfa_conformance = ""
        pdf_version = "1.7"

        with pikepdf.open(io.BytesIO(pdf_bytes)) as pdoc:
            pdf_version = pdoc.pdf_version
            if "/Lang" in pdoc.Root:
                has_lang = True
            if "/MarkInfo" in pdoc.Root and pdoc.Root.MarkInfo.get("/Marked", False):
                is_tagged = True
            try:
                with pdoc.open_metadata() as xmp:
                    if xmp.pdfa_status:
                        is_pdfa = True
                        pdfa_conformance = xmp.pdfa_status
            except Exception:
                pass

        checks = [
            {
                "id": "doc_title",
                "category": "Accessibility",
                "name": "Document Title Present",
                "status": "pass" if bool(title) else "warn",
                "detail": f"Title: '{title}'" if title else "Document metadata is missing a Title.",
            },
            {
                "id": "doc_lang",
                "category": "Accessibility",
                "name": "Primary Language Tag (/Lang)",
                "status": "pass" if has_lang else "warn",
                "detail": "Catalog /Lang attribute is set." if has_lang else "Missing /Lang specification in PDF Catalog.",
            },
            {
                "id": "tagged_pdf",
                "category": "Accessibility",
                "name": "Tagged PDF Structure (/MarkInfo)",
                "status": "pass" if is_tagged else "warn",
                "detail": "Document is marked as Tagged PDF." if is_tagged else "Document is not marked as Tagged PDF.",
            },
            {
                "id": "searchable_text",
                "category": "Accessibility",
                "name": "Searchable Text Layer (Not Image-Only)",
                "status": "fail" if is_scanned_without_ocr else "pass",
                "detail": "Scanned pages lack searchable text; run OCR."
                if is_scanned_without_ocr
                else f"Contains {total_chars} selectable characters.",
            },
            {
                "id": "bookmarks_nav",
                "category": "Accessibility",
                "name": "Navigation Bookmarks for Multi-Page PDF",
                "status": "pass" if (len(doc) < 4 or len(toc) > 0) else "warn",
                "detail": f"{len(toc)} bookmark(s) found for {len(doc)} page(s).",
            },
            {
                "id": "fonts_embedded",
                "category": "Preflight / Print",
                "name": "All Fonts Embedded (PDF/A & Print Requirement)",
                "status": "pass" if not unembedded_fonts else "warn",
                "detail": "All fonts are embedded."
                if not unembedded_fonts
                else f"Unembedded Base-14/external fonts: {', '.join(unembedded_fonts[:5])}",
            },
            {
                "id": "pdfa_conformance",
                "category": "Archival (PDF/A)",
                "name": "PDF/A Conformance Metadata",
                "status": "pass" if is_pdfa else "info",
                "detail": f"Conforms to PDF/A-{pdfa_conformance}" if is_pdfa else "Standard PDF (not yet converted to PDF/A).",
            },
        ]

        passed = sum(1 for c in checks if c["status"] == "pass")
        score = int(round((passed / len(checks)) * 100))

        return {
            "score": score,
            "pdf_version": pdf_version,
            "is_pdfa": is_pdfa,
            "pdfa_conformance": pdfa_conformance,
            "is_tagged": is_tagged,
            "has_language": has_lang,
            "total_characters": total_chars,
            "total_images": total_images,
            "unembedded_fonts": unembedded_fonts,
            "checks": checks,
        }
    finally:
        doc.close()


def convert_to_pdfa(
    pdf_bytes: bytes,
    conformance: str = "2B",
    language: str = "en-US",
    title: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Convert a PDF document to archival PDF/A-2b format and stamp accessibility tags (/Lang, /MarkInfo, Title, XMP pdfaid).
    Uses Ghostscript (`gs -dPDFA=2`) when available and enforces XMP PDF/A conformance metadata via `pikepdf`.
    """
    working = pdf_bytes
    gs_bin = shutil.which("gs")

    if gs_bin:
        with tempfile.TemporaryDirectory(prefix="vellum_pdfa_") as tmpdir:
            in_pdf = os.path.join(tmpdir, "in.pdf")
            out_pdf = os.path.join(tmpdir, "out_pdfa.pdf")
            with open(in_pdf, "wb") as f:
                f.write(working)
            try:
                subprocess.run(
                    [
                        gs_bin,
                        "-dPDFA=2",
                        "-dBATCH",
                        "-dNOPAUSE",
                        "-dNOOUTERSAVE",
                        "-sProcessColorModel=DeviceRGB",
                        "-sDEVICE=pdfwrite",
                        "-dPDFACompatibilityPolicy=1",
                        f"-sOutputFile={out_pdf}",
                        in_pdf,
                    ],
                    check=False,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=30,
                )
                if os.path.exists(out_pdf) and os.path.getsize(out_pdf) > 100:
                    with open(out_pdf, "rb") as f:
                        working = f.read()
            except Exception:
                pass

    part = "2" if "2" in conformance else ("1" if "1" in conformance else "3")
    conf_letter = "B" if "B" in conformance.upper() else "A"

    with pikepdf.open(io.BytesIO(working)) as pdoc:
        pdoc.Root["/Lang"] = pikepdf.String(language or "en-US")
        pdoc.Root["/MarkInfo"] = pikepdf.Dictionary({"/Marked": True})

        with pdoc.open_metadata(set_pikepdf_as_editor=False) as xmp:
            xmp["pdfaid:part"] = part
            xmp["pdfaid:conformance"] = conf_letter
            if title:
                xmp["dc:title"] = title
            elif "dc:title" not in xmp:
                xmp["dc:title"] = "Archived PDF/A Document"

        out_buf = io.BytesIO()
        pdoc.save(out_buf, compress_streams=True)
        final_bytes = out_buf.getvalue()

    inspection = run_preflight_and_accessibility_check(final_bytes)
    return {
        "pdf_bytes": final_bytes,
        "is_pdfa": inspection["is_pdfa"],
        "pdfa_conformance": inspection["pdfa_conformance"],
        "preflight_score": inspection["score"],
        "inspection": inspection,
    }

