"""OCR (Searchable Text Layer) and Multi-Format Document Conversion Engine."""

from __future__ import annotations

import base64
import csv
import io
import os
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import openpyxl
from openpyxl.styles import Alignment, Font, PatternFill
import pdfplumber
import pymupdf
from PIL import Image

from .utils import resolve_pdf_font

_RAPID_OCR_INSTANCE = None


def _get_rapid_ocr():
    global _RAPID_OCR_INSTANCE
    if _RAPID_OCR_INSTANCE is None:
        from rapidocr_onnxruntime import RapidOCR

        _RAPID_OCR_INSTANCE = RapidOCR()
    return _RAPID_OCR_INSTANCE


SUPPORTED_OCR_LANGUAGES: List[Dict[str, str]] = [
    {"code": "eng", "name": "English (Latin / PP-OCRv4)"},
    {"code": "deu", "name": "German (Deutsch)"},
    {"code": "fra", "name": "French (Français)"},
    {"code": "spa", "name": "Spanish (Español)"},
    {"code": "ita", "name": "Italian (Italiano)"},
    {"code": "por", "name": "Portuguese (Português)"},
    {"code": "chi_sim", "name": "Chinese Simplified (简体中文)"},
    {"code": "multi", "name": "Multilingual Auto-Detect"},
]


def ocr_pdf_pages(
    pdf_bytes: bytes,
    page_indices: Optional[List[int]] = None,
    language: str = "eng",
    dpi: int = 180,
    force_ocr_on_existing_text: bool = False,
) -> Dict[str, Any]:
    """
    Run offline OCR on scanned or image-based PDF pages and inject an aligned,
    invisible searchable text layer (`render_mode=3`) over the page raster.
    Supports RapidOCR (ONNX Runtime offline neural OCR) and Tesseract if installed.
    """
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        targets = page_indices if page_indices is not None else list(range(len(doc)))
        ocr_engine = _get_rapid_ocr()
        has_tesseract = shutil.which("tesseract") is not None

        page_reports: List[Dict[str, Any]] = []
        total_lines_added = 0

        for idx in targets:
            if not (0 <= idx < len(doc)):
                continue
            page = doc[idx]
            existing_text = page.get_text("text").strip()
            if existing_text and not force_ocr_on_existing_text:
                # If page already has substantial selectable text and force is False, still OCR embedded images or skip
                if len(existing_text) > 80:
                    page_reports.append(
                        {
                            "page_index": idx,
                            "status": "skipped_has_text",
                            "recognized_lines": 0,
                            "text_preview": existing_text[:200],
                        }
                    )
                    continue

            # Render page to high-DPI bitmap for OCR
            pix = page.get_pixmap(dpi=int(dpi), alpha=False)
            png_bytes = pix.tobytes("png")
            scale_x = page.rect.width / float(pix.width)
            scale_y = page.rect.height / float(pix.height)

            recognized_items: List[Dict[str, Any]] = []

            if has_tesseract and language not in ("multi",):
                try:
                    import pytesseract

                    pil_img = Image.open(io.BytesIO(png_bytes))
                    data = pytesseract.image_to_data(
                        pil_img,
                        lang=language if language != "multi" else "eng",
                        output_type=pytesseract.Output.DICT,
                    )
                    n_boxes = len(data.get("text", []))
                    for b_i in range(n_boxes):
                        word = (data["text"][b_i] or "").strip()
                        conf = float(data["conf"][b_i]) if str(data["conf"][b_i]) != "-1" else 0.0
                        if word and conf > 25:
                            x = data["left"][b_i] * scale_x
                            y = data["top"][b_i] * scale_y
                            w = data["width"][b_i] * scale_x
                            h = data["height"][b_i] * scale_y
                            recognized_items.append(
                                {
                                    "text": word,
                                    "bbox": [x, y, x + w, y + h],
                                    "confidence": round(conf / 100.0, 3),
                                }
                            )
                except Exception:
                    recognized_items = []

            if not recognized_items:
                ocr_res, _ = ocr_engine(png_bytes)
                for box, txt, score in ocr_res or []:
                    clean_txt = str(txt).strip()
                    if not clean_txt:
                        continue
                    x0 = min(pt[0] for pt in box) * scale_x
                    y0 = min(pt[1] for pt in box) * scale_y
                    x1 = max(pt[0] for pt in box) * scale_x
                    y1 = max(pt[1] for pt in box) * scale_y
                    recognized_items.append(
                        {
                            "text": clean_txt,
                            "bbox": [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)],
                            "confidence": round(float(score), 3),
                        }
                    )

            # Remove any previous invisible OCR text if forcing re-OCR
            if force_ocr_on_existing_text and existing_text:
                page.add_redact_annot(page.rect, fill=False)
                page.apply_redactions(
                    images=pymupdf.PDF_REDACT_IMAGE_NONE,
                    graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                )

            # Inject invisible searchable text layer (render_mode=3) aligned to each recognized bounding box
            for item in recognized_items:
                bx0, by0, bx1, by1 = item["bbox"]
                txt = item["text"]
                box_h = max(6.0, (by1 - by0) * 0.85)
                baseline_y = by1 - (by1 - by0) * 0.15
                f_info = resolve_pdf_font("helv", text_content=txt)
                page.insert_text(
                    pymupdf.Point(bx0, baseline_y),
                    txt,
                    fontsize=box_h,
                    fontname=f_info["fontname"],
                    fontfile=f_info["fontfile"],
                    render_mode=3,  # PDF Tr=3: Neither fill nor stroke text (invisible searchable text layer)
                )

            total_lines_added += len(recognized_items)
            joined_text = "\n".join(it["text"] for it in recognized_items)
            page_reports.append(
                {
                    "page_index": idx,
                    "status": "ocr_completed",
                    "recognized_lines": len(recognized_items),
                    "average_confidence": round(
                        sum(it["confidence"] for it in recognized_items) / len(recognized_items), 3
                    )
                    if recognized_items
                    else 0.0,
                    "text_preview": joined_text[:300],
                    "items": recognized_items,
                }
            )

        out_bytes = doc.tobytes(garbage=2, deflate=True)
        return {
            "pdf_bytes": out_bytes,
            "language": language,
            "engine": "tesseract+rapidocr" if has_tesseract else "rapidocr-onnxruntime (PP-OCRv4)",
            "total_lines_added": total_lines_added,
            "pages": page_reports,
        }
    finally:
        doc.close()


# --- Document Conversions ---


def convert_pdf_to_docx(pdf_bytes: bytes, start_page: int = 0, end_page: Optional[int] = None) -> bytes:
    """
    Convert a PDF document into an editable Microsoft Word (.docx) file using `pdf2docx`,
    with automatic fallback to structured `python-docx` export for scanned/complex pages.
    """
    with tempfile.TemporaryDirectory(prefix="vellum_pdf2docx_") as tmpdir:
        pdf_path = os.path.join(tmpdir, "input.pdf")
        docx_path = os.path.join(tmpdir, "output.docx")
        with open(pdf_path, "wb") as f:
            f.write(pdf_bytes)

        try:
            from pdf2docx import Converter

            cv = Converter(pdf_path)
            try:
                cv.convert(docx_path, start=int(start_page), end=end_page)
            finally:
                cv.close()
        except Exception:
            pass

        # Verify output or supplement with python-docx if pdf2docx failed on unusual streams
        if not os.path.exists(docx_path) or os.path.getsize(docx_path) == 0:
            import docx

            word_doc = docx.Document()
            src = pymupdf.open(stream=pdf_bytes, filetype="pdf")
            try:
                for idx, page in enumerate(src):
                    if idx > 0:
                        word_doc.add_page_break()
                    text = page.get_text("text").strip()
                    for para in text.split("\n\n"):
                        if para.strip():
                            word_doc.add_paragraph(para.strip())
            finally:
                src.close()
            word_doc.save(docx_path)

        with open(docx_path, "rb") as f:
            return f.read()


def convert_docx_to_pdf(docx_bytes: bytes) -> bytes:
    """
    Convert a Microsoft Word (.docx) document to PDF using headless LibreOffice
    (with native Python `python-docx` + PyMuPDF layout fallback).
    """
    with tempfile.TemporaryDirectory(prefix="vellum_docx2pdf_") as tmpdir:
        docx_path = os.path.join(tmpdir, "input.docx")
        pdf_path = os.path.join(tmpdir, "input.pdf")
        with open(docx_path, "wb") as f:
            f.write(docx_bytes)

        lo_bin = shutil.which("libreoffice") or shutil.which("soffice")
        if lo_bin:
            profile_dir = os.path.join(tmpdir, "lo_profile")
            try:
                subprocess.run(
                    [
                        lo_bin,
                        f"-env:UserInstallation=file://{profile_dir}",
                        "--headless",
                        "--convert-to",
                        "pdf",
                        "--outdir",
                        tmpdir,
                        docx_path,
                    ],
                    check=False,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=35,
                )
            except Exception:
                pass

        if os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 100:
            with open(pdf_path, "rb") as f:
                return f.read()

        # Deterministic native Python fallback using python-docx + PyMuPDF Story/Page layout
        import docx

        word_doc = docx.Document(io.BytesIO(docx_bytes))
        pdf_out = pymupdf.open()
        try:
            page = pdf_out.new_page(width=595, height=842)
            cursor_y = 64.0
            for para in word_doc.paragraphs:
                txt = para.text.strip()
                if not txt:
                    cursor_y += 8.0
                    continue
                is_heading = para.style and "heading" in para.style.name.lower()
                fsize = 16.0 if is_heading else 11.5
                fname = "hebo" if is_heading else "helv"
                est_lines = max(1, (len(txt) // 70) + 1)
                box_h = est_lines * fsize * 1.45 + 8.0
                if cursor_y + box_h > 780:
                    page = pdf_out.new_page(width=595, height=842)
                    cursor_y = 64.0
                f_info = resolve_pdf_font(fname, bold=is_heading, text_content=txt)
                page.insert_textbox(
                    pymupdf.Rect(56, cursor_y, 539, cursor_y + box_h),
                    txt,
                    fontsize=fsize,
                    fontname=f_info["fontname"],
                    fontfile=f_info["fontfile"],
                )
                cursor_y += box_h

            # Render tables if present
            for table in word_doc.tables:
                for row in table.rows:
                    cells_txt = " | ".join(c.text.strip() for c in row.cells)
                    if cursor_y + 24 > 780:
                        page = pdf_out.new_page(width=595, height=842)
                        cursor_y = 64.0
                    page.insert_text(pymupdf.Point(56, cursor_y + 12), cells_txt, fontsize=10.0, fontname="helv")
                    cursor_y += 18.0

            return pdf_out.tobytes(garbage=2, deflate=True)
        finally:
            pdf_out.close()


def convert_pdf_to_images(
    pdf_bytes: bytes,
    image_format: str = "png",
    dpi: int = 150,
    page_indices: Optional[List[int]] = None,
) -> Dict[str, Any]:
    """
    Convert PDF pages to PNG or JPEG images, returning both individual base64 images
    and a combined ZIP archive byte stream.
    """
    fmt = "jpeg" if image_format.lower() in ("jpg", "jpeg") else "png"
    ext = "jpg" if fmt == "jpeg" else "png"
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        targets = page_indices if page_indices is not None else list(range(len(doc)))
        zip_buf = io.BytesIO()
        images_meta: List[Dict[str, Any]] = []

        with zipfile.ZipFile(zip_buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
            for idx in targets:
                if not (0 <= idx < len(doc)):
                    continue
                pix = doc[idx].get_pixmap(dpi=int(dpi), alpha=False)
                img_bytes = pix.tobytes(fmt)
                fname = f"page_{idx+1:03d}.{ext}"
                zf.writestr(fname, img_bytes)
                images_meta.append(
                    {
                        "page_index": idx,
                        "filename": fname,
                        "width": pix.width,
                        "height": pix.height,
                        "size_bytes": len(img_bytes),
                        "base64": base64.b64encode(img_bytes).decode("ascii"),
                    }
                )

        return {
            "zip_bytes": zip_buf.getvalue(),
            "format": ext,
            "dpi": dpi,
            "images": images_meta,
        }
    finally:
        doc.close()


def convert_images_to_pdf(
    images_bytes_list: List[bytes],
    page_size: str = "fit_image",
) -> bytes:
    """Convert one or more raster images (PNG, JPEG, WebP, TIFF) into a multi-page PDF."""
    if not images_bytes_list:
        raise ValueError("No images provided for PDF conversion")
    out = pymupdf.open()
    try:
        for img_data in images_bytes_list:
            pil_img = Image.open(io.BytesIO(img_data))
            if pil_img.mode not in ("RGB", "L"):
                pil_img = pil_img.convert("RGB")
            img_w, img_h = pil_img.size
            norm_buf = io.BytesIO()
            pil_img.save(norm_buf, format="PNG")
            png_bytes = norm_buf.getvalue()

            if page_size == "a4":
                pw, ph = 595.0, 842.0
                page = out.new_page(width=pw, height=ph)
                margin = 24.0
                target = pymupdf.Rect(margin, margin, pw - margin, ph - margin)
                page.insert_image(target, stream=png_bytes, keep_proportion=True)
            elif page_size == "letter":
                pw, ph = 612.0, 792.0
                page = out.new_page(width=pw, height=ph)
                margin = 24.0
                target = pymupdf.Rect(margin, margin, pw - margin, ph - margin)
                page.insert_image(target, stream=png_bytes, keep_proportion=True)
            else:
                # Fit page to image dimensions at 72 DPI
                pw = max(72.0, float(img_w))
                ph = max(72.0, float(img_h))
                page = out.new_page(width=pw, height=ph)
                page.insert_image(pymupdf.Rect(0, 0, pw, ph), stream=png_bytes)

        return out.tobytes(garbage=2, deflate=True)
    finally:
        out.close()


def convert_pdf_to_text(pdf_bytes: bytes) -> str:
    """Extract clean plain text from all pages of a PDF document."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        parts: List[str] = []
        for idx, page in enumerate(doc):
            txt = page.get_text("text").strip()
            parts.append(f"--- Page {idx + 1} ---\n{txt}")
        return "\n\n".join(parts)
    finally:
        doc.close()


def convert_pdf_to_html(pdf_bytes: bytes) -> str:
    """Convert a PDF document into a self-contained, layout-preserving HTML5 document."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        body_pages: List[str] = []
        for idx, page in enumerate(doc):
            page_html = page.get_text("html")
            body_pages.append(
                f'<section class="pdf-page" data-page="{idx + 1}" '
                f'style="position:relative;width:{page.rect.width}pt;min-height:{page.rect.height}pt;'
                f'margin:20px auto;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,0.15);overflow:hidden;">'
                f"{page_html}</section>"
            )
        title = (doc.metadata or {}).get("title") or "Converted PDF Document"
        return (
            "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n"
            "<meta charset=\"utf-8\" />\n"
            f"<title>{title}</title>\n"
            "<style>body{background:#f1f5f9;font-family:sans-serif;margin:0;padding:16px;}</style>\n"
            "</head>\n<body>\n"
            + "\n".join(body_pages)
            + "\n</body>\n</html>"
        )
    finally:
        doc.close()


def extract_tables_to_xlsx(pdf_bytes: bytes) -> Dict[str, Any]:
    """
    Detect and extract tables from a PDF document using `pdfplumber` geometric analysis
    (with fallback to aligned text-column detection) and export to both `.xlsx` (Excel) and `.csv`.
    """
    extracted_tables: List[Dict[str, Any]] = []

    # 1. Try pdfplumber geometric cell boundary table extraction first
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdoc:
        for p_idx, page in enumerate(pdoc.pages):
            tables = page.extract_tables()
            for t_idx, tbl in enumerate(tables or []):
                cleaned_rows = [
                    [(cell or "").strip() for cell in row]
                    for row in tbl
                    if row and any((c or "").strip() for c in row)
                ]
                if len(cleaned_rows) >= 2 and max(len(r) for r in cleaned_rows) >= 2:
                    extracted_tables.append(
                        {
                            "page_index": p_idx,
                            "page_number": p_idx + 1,
                            "table_index": t_idx + 1,
                            "rows": cleaned_rows,
                            "row_count": len(cleaned_rows),
                            "col_count": max(len(r) for r in cleaned_rows),
                        }
                    )

    # 2. Supplement with PyMuPDF native table finder if pdfplumber found no tables
    if not extracted_tables:
        doc_fitz = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        try:
            for p_idx, page in enumerate(doc_fitz):
                try:
                    finder = page.find_tables()
                    for t_idx, tbl in enumerate(finder.tables):
                        raw_rows = tbl.extract()
                        cleaned_rows = [
                            [(cell or "").strip().replace("\n", " ") for cell in row]
                            for row in raw_rows
                            if row and any((c or "").strip() for c in row)
                        ]
                        if len(cleaned_rows) >= 2 and max(len(r) for r in cleaned_rows) >= 2:
                            extracted_tables.append(
                                {
                                    "page_index": p_idx,
                                    "page_number": p_idx + 1,
                                    "table_index": t_idx + 1,
                                    "rows": cleaned_rows,
                                    "row_count": len(cleaned_rows),
                                    "col_count": max(len(r) for r in cleaned_rows),
                                }
                            )
                except Exception:
                    continue
        finally:
            doc_fitz.close()

    # Build Excel workbook via openpyxl
    wb = openpyxl.Workbook()
    default_sheet = wb.active
    csv_buf = io.StringIO()
    csv_writer = csv.writer(csv_buf)

    if not extracted_tables:
        default_sheet.title = "Extracted_Data"
        default_sheet.append(["Page", "Line", "Content"])
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
        try:
            for p_idx, page in enumerate(doc):
                for l_idx, line in enumerate(page.get_text("text").splitlines()):
                    if line.strip():
                        row_vals = [p_idx + 1, l_idx + 1, line.strip()]
                        default_sheet.append(row_vals)
                        csv_writer.writerow(row_vals)
        finally:
            doc.close()
    else:
        for idx, tbl_info in enumerate(extracted_tables):
            sheet_title = f"P{tbl_info['page_number']}_Table{tbl_info['table_index']}"
            ws = default_sheet if idx == 0 else wb.create_sheet(title=sheet_title[:31])
            if idx == 0:
                ws.title = sheet_title[:31]

            for r_idx, row in enumerate(tbl_info["rows"]):
                ws.append(row)
                csv_writer.writerow(row)
                if r_idx == 0:
                    for cell in ws[1]:
                        cell.font = Font(bold=True, color="FFFFFF")
                        cell.fill = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
                        cell.alignment = Alignment(horizontal="left", vertical="center")
            csv_writer.writerow([])

    xlsx_buf = io.BytesIO()
    wb.save(xlsx_buf)

    return {
        "xlsx_bytes": xlsx_buf.getvalue(),
        "csv_text": csv_buf.getvalue(),
        "tables_count": len(extracted_tables),
        "tables": extracted_tables,
    }


def batch_convert_documents(
    files: List[Tuple[str, bytes]],
    target_format: str = "txt",
) -> bytes:
    """
    Batch-convert multiple PDFs or images into the requested format (`txt`, `html`, `docx`, `xlsx`, `png`, `pdf`)
    and return a ZIP archive of all converted outputs.
    """
    fmt = target_format.lower().strip()
    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        if fmt == "pdf":
            # Combine or convert each file to PDF
            for fname, data in files:
                stem = Path(fname).stem
                if fname.lower().endswith(".docx"):
                    out_data = convert_docx_to_pdf(data)
                elif fname.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                    out_data = convert_images_to_pdf([data])
                else:
                    out_data = data
                zf.writestr(f"{stem}.pdf", out_data)
        else:
            for fname, data in files:
                stem = Path(fname).stem
                if fmt == "txt":
                    zf.writestr(f"{stem}.txt", convert_pdf_to_text(data).encode("utf-8"))
                elif fmt == "html":
                    zf.writestr(f"{stem}.html", convert_pdf_to_html(data).encode("utf-8"))
                elif fmt == "docx":
                    zf.writestr(f"{stem}.docx", convert_pdf_to_docx(data))
                elif fmt in ("xlsx", "csv"):
                    tbl = extract_tables_to_xlsx(data)
                    if fmt == "xlsx":
                        zf.writestr(f"{stem}.xlsx", tbl["xlsx_bytes"])
                    else:
                        zf.writestr(f"{stem}.csv", tbl["csv_text"].encode("utf-8"))
                elif fmt in ("png", "jpg", "jpeg"):
                    imgs = convert_pdf_to_images(data, image_format=fmt)
                    for im in imgs["images"]:
                        zf.writestr(f"{stem}_{im['filename']}", base64.b64decode(im["base64"]))
                else:
                    raise ValueError(f"Unsupported batch target format: {target_format}")
    return zip_buf.getvalue()
