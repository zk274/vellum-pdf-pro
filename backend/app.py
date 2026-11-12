"""FastAPI Sidecar Server for Vellum PDF Pro Linux Desktop Application."""

from __future__ import annotations

import base64
import io
import os
import shutil
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import pymupdf

from .engine.annotations import add_annotation, delete_annotation, list_annotations, update_annotation
from .engine.direct_edit import (
    add_shape_object,
    add_text_object,
    edit_image_object,
    edit_text_span,
    insert_image_object,
    inspect_page_objects,
    manage_hyperlink,
    transform_object,
)
from .engine.forms_signatures import (
    apply_visual_signature,
    create_form_field,
    delete_form_field,
    fill_form_fields,
    generate_pkcs12_certificate,
    list_form_fields,
    sign_pdf_cryptographic,
    update_form_field,
    verify_pdf_signatures,
)
from .engine.ocr_convert import (
    SUPPORTED_OCR_LANGUAGES,
    batch_convert_documents,
    convert_docx_to_pdf,
    convert_images_to_pdf,
    convert_pdf_to_docx,
    convert_pdf_to_html,
    convert_pdf_to_images,
    convert_pdf_to_text,
    extract_tables_to_xlsx,
    ocr_pdf_pages,
)
from .engine.page_ops import (
    crop_page,
    delete_pages,
    duplicate_page,
    extract_pages,
    insert_blank_page,
    insert_pages_from_pdf,
    merge_pdfs,
    parse_page_range_spec,
    reorder_pages,
    resize_pages,
    rotate_pages,
    split_pdf,
)
from .engine.pro_features import (
    add_attachment,
    add_bookmark,
    apply_bates_numbering,
    apply_header_footer,
    apply_watermark,
    compare_pdf_documents,
    convert_to_pdfa,
    delete_attachment,
    delete_bookmark,
    extract_attachment,
    get_bookmarks,
    list_attachments,
    run_preflight_and_accessibility_check,
)
from .engine.sample_builder import create_showcase_pdf
from .engine.security_optimize import (
    apply_permanent_redaction,
    decrypt_pdf,
    encrypt_pdf,
    get_document_properties,
    inspect_embedded_fonts,
    optimize_and_compress_pdf,
    repair_pdf_document,
    sanitize_pdf_metadata,
    set_document_properties,
)
from .engine.session import SessionManager

app = FastAPI(
    title="Vellum PDF Pro Engine",
    version="1.0.0",
    description="Hybrid Multi-Library Native PDF Processing Engine for Linux Desktop",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

session_manager = SessionManager()


# --- Request Models ---


class NewDocRequest(BaseModel):
    filename: str = "Untitled.pdf"
    width: float = 595.0
    height: float = 842.0
    page_count: int = 1


class OpenPathRequest(BaseModel):
    file_path: str
    password: Optional[str] = None


class SaveDocRequest(BaseModel):
    target_path: Optional[str] = None
    create_backup: bool = True


class SearchRequest(BaseModel):
    query: str
    case_sensitive: bool = False


class EditTextSpanRequest(BaseModel):
    orig_bbox: List[float]
    new_text: str
    orig_origin: Optional[List[float]] = None
    new_bbox: Optional[List[float]] = None
    font_name: Optional[str] = "helv"
    original_font: Optional[str] = None
    font_size: float = 12.0
    color_hex: str = "#000000"
    bold: bool = False
    italic: bool = False
    align: str = "left"
    line_height: float = 1.2
    keep_original_font: bool = True


class AddTextRequest(BaseModel):
    text: str
    bbox: List[float]
    font_name: str = "helv"
    font_size: float = 12.0
    color_hex: str = "#000000"
    bold: bool = False
    italic: bool = False
    align: str = "left"
    background_hex: Optional[str] = None
    border_hex: Optional[str] = None
    border_width: float = 0.0


class EditImageRequest(BaseModel):
    xref: int
    action: str  # "delete" | "replace" | "transform"
    orig_bbox: Optional[List[float]] = None
    new_bbox: Optional[List[float]] = None
    rotation: int = 0
    crop_ratios: Optional[List[float]] = None
    replacement_image_base64: Optional[str] = None


class AddShapeRequest(BaseModel):
    shape_type: str  # "rect" | "ellipse" | "line" | "arrow"
    bbox: List[float]
    stroke_hex: str = "#1d4ed8"
    fill_hex: Optional[str] = None
    stroke_width: float = 2.0
    opacity: float = 1.0


class TransformObjectRequest(BaseModel):
    object_id: str
    object_type: str  # "textbox" | "shape" | "image" | "text_span"
    action: str  # "transform" | "delete" | "duplicate" | "update_style"
    orig_bbox: List[float]
    new_bbox: Optional[List[float]] = None
    text: Optional[str] = None
    font_name: Optional[str] = None
    font_size: Optional[float] = None
    color_hex: Optional[str] = None
    bold: Optional[bool] = None
    italic: Optional[bool] = None
    align: Optional[str] = None
    shape_type: Optional[str] = None
    stroke_hex: Optional[str] = None
    fill_hex: Optional[str] = None
    stroke_width: Optional[float] = None
    opacity: Optional[float] = None
    rotation: Optional[int] = 0
    image_xref: Optional[int] = None


class HyperlinkRequest(BaseModel):
    action: str  # "add" | "update" | "delete"
    bbox: List[float]
    uri: Optional[str] = None
    target_page: Optional[int] = None


class InsertBlankPageRequest(BaseModel):
    index: int = -1
    width: Optional[float] = None
    height: Optional[float] = None


class PageIndicesRequest(BaseModel):
    page_indices: List[int] = Field(default_factory=list)
    range_spec: Optional[str] = None


class DuplicatePageRequest(BaseModel):
    page_index: int


class ReorderPagesRequest(BaseModel):
    new_order: List[int]


class RotatePagesRequest(BaseModel):
    page_indices: List[int]
    delta_degrees: int = 90


class CropPageRequest(BaseModel):
    page_index: int = 0
    crop_box: Optional[List[float]] = None
    margins: Optional[Dict[str, float]] = None
    apply_to_all: bool = False


class ResizePagesRequest(BaseModel):
    new_width: float = 595.0
    new_height: float = 842.0
    page_indices: Optional[List[int]] = None
    scale_content: bool = True


class SplitPdfRequest(BaseModel):
    mode: str = "ranges"
    ranges_spec: str = "1"
    every_n_pages: int = 1


class MergeOpenDocsRequest(BaseModel):
    doc_ids: List[str]
    output_filename: str = "Merged_Document.pdf"


class AddAnnotationRequest(BaseModel):
    page_index: int = 0
    annot_type: str
    bbox: List[float]
    content: str = ""
    author: str = "Linux Reviewer"
    color_hex: str = "#facc15"
    fill_hex: Optional[str] = None
    opacity: float = 0.85
    stroke_width: float = 2.0
    ink_strokes: Optional[List[List[List[float]]]] = None
    stamp_name: str = "APPROVED"
    font_size: float = 11.0


class UpdateAnnotationRequest(BaseModel):
    page_index: int = 0
    content: Optional[str] = None
    author: Optional[str] = None
    color_hex: Optional[str] = None
    opacity: Optional[float] = None
    new_bbox: Optional[List[float]] = None


class CreateFormFieldRequest(BaseModel):
    page_index: int = 0
    field_type: str
    field_name: str
    bbox: List[float]
    default_value: str = ""
    checked: bool = False
    choices: Optional[List[str]] = None
    font_size: float = 11.0
    text_color_hex: str = "#000000"
    fill_color_hex: str = "#f8fafc"
    border_color_hex: str = "#475569"
    read_only: bool = False
    tooltip: str = ""


class FillFormFieldsRequest(BaseModel):
    values: Dict[str, Any]
    page_index: Optional[int] = None


class UpdateFormFieldRequest(BaseModel):
    page_index: int = 0
    field_name: Optional[str] = None
    value: Optional[Any] = None
    bbox: Optional[List[float]] = None
    choices: Optional[List[str]] = None
    read_only: Optional[bool] = None
    text_color_hex: Optional[str] = None
    fill_color_hex: Optional[str] = None
    font_size: Optional[float] = None


class VisualSignatureRequest(BaseModel):
    page_index: int = 0
    bbox: List[float]
    mode: str = "typed"  # "typed" | "drawn" | "image"
    signer_name: str = "Authorized Signer"
    typed_text: Optional[str] = None
    ink_strokes: Optional[List[List[List[float]]]] = None
    signature_image_base64: Optional[str] = None
    color_hex: str = "#0f172a"
    include_date: bool = True


class GenerateCertRequest(BaseModel):
    common_name: str = "Alice Vance"
    organization: str = "Vellum PDF Enterprise"
    email: str = "alice@example.org"
    country: str = "US"
    passphrase: str = "vellum-secret"
    valid_days: int = 365


class CryptographicSignRequest(BaseModel):
    page_index: int = 0
    bbox: Optional[List[float]] = None
    field_name: str = "DigitalSignature1"
    reason: str = "I approve and certify this PDF document"
    location: str = "Linux Desktop Workstation"
    contact_info: str = ""
    p12_base64: Optional[str] = None
    passphrase: str = "vellum-secret"
    signer_name: str = "Alice Vance"
    organization: str = "Vellum PDF Enterprise"


class OcrRequest(BaseModel):
    page_indices: Optional[List[int]] = None
    language: str = "eng"
    dpi: int = 180
    force_ocr_on_existing_text: bool = False


class EncryptRequest(BaseModel):
    user_password: str = ""
    owner_password: str = ""
    encryption_level: str = "AES-256"
    allow_print: bool = True
    allow_modify: bool = False
    allow_extract: bool = False
    allow_annotate: bool = True
    allow_forms: bool = True
    allow_assemble: bool = False


class DecryptRequest(BaseModel):
    password: str = ""


class RedactRequest(BaseModel):
    page_redactions: Optional[List[Dict[str, Any]]] = None
    search_terms: Optional[List[str]] = None
    regex_pattern: Optional[str] = None
    fill_color_hex: str = "#000000"
    overlay_text: str = "REDACTED"
    text_color_hex: str = "#ffffff"


class DocumentPropertiesRequest(BaseModel):
    title: Optional[str] = None
    author: Optional[str] = None
    subject: Optional[str] = None
    keywords: Optional[str] = None
    creator: Optional[str] = None
    producer: Optional[str] = None


class OptimizeRequest(BaseModel):
    image_quality: int = 75
    max_image_dimension: int = 1600
    linearize: bool = False


class CompareDocsRequest(BaseModel):
    doc_id_a: str
    doc_id_b: str
    dpi: int = 110


class HeaderFooterRequest(BaseModel):
    header_left: str = ""
    header_center: str = ""
    header_right: str = ""
    footer_left: str = ""
    footer_center: str = "Page {page} of {total}"
    footer_right: str = ""
    font_size: float = 9.5
    color_hex: str = "#334155"
    margin_top: float = 28.0
    margin_bottom: float = 24.0
    margin_side: float = 42.0
    page_indices: Optional[List[int]] = None


class WatermarkRequest(BaseModel):
    text: str = "CONFIDENTIAL"
    font_size: float = 48.0
    color_hex: str = "#94a3b8"
    opacity: float = 0.28
    rotation: float = 45.0
    overlay: bool = True
    page_indices: Optional[List[int]] = None


class BatesRequest(BaseModel):
    prefix: str = "BATES-"
    suffix: str = ""
    start_number: int = 1
    digits: int = 6
    position: str = "bottom_right"
    font_size: float = 9.5
    color_hex: str = "#0f172a"
    page_indices: Optional[List[int]] = None


class AddBookmarkRequest(BaseModel):
    title: str
    page_index: int = 0
    level: int = 1


class PdfARequest(BaseModel):
    conformance: str = "2B"
    language: str = "en-US"
    title: Optional[str] = None


# --- Endpoints ---


_CACHED_LIBRARIES: Optional[Dict[str, Any]] = None


def _get_library_metadata() -> Dict[str, Any]:
    global _CACHED_LIBRARIES
    if _CACHED_LIBRARIES is None:
        import importlib.metadata as _meta

        def _safe_version(pkg: str) -> str:
            try:
                return _meta.version(pkg)
            except Exception:
                return "installed"

        _CACHED_LIBRARIES = {
            "pymupdf": _safe_version("pymupdf"),
            "pikepdf": _safe_version("pikepdf"),
            "pyhanko": _safe_version("pyhanko"),
            "pdfplumber": _safe_version("pdfplumber"),
            "libreoffice": shutil.which("libreoffice") is not None,
            "ghostscript": shutil.which("gs") is not None,
            "rapidocr_offline": True,
        }
    return _CACHED_LIBRARIES


@app.get("/api/health")
@app.get("/health")
def get_health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "engine": "Vellum PDF Pro Hybrid Engine",
        "libraries": _get_library_metadata(),
        "open_sessions": len(session_manager.sessions),
    }


@app.post("/api/docs/new")
def create_new_doc(req: NewDocRequest) -> Dict[str, Any]:
    session = session_manager.create_blank_document(
        filename=req.filename,
        width=req.width,
        height=req.height,
        page_count=req.page_count,
    )
    return session_manager.get_document_summary(session.doc_id)


@app.post("/api/docs/sample")
def open_sample_showcase_doc() -> Dict[str, Any]:
    pdf_bytes = create_showcase_pdf()
    session = session_manager.open_document(
        pdf_bytes=pdf_bytes,
        filename="Vellum_Enterprise_MSA_Showcase.pdf",
    )
    return session_manager.get_document_summary(session.doc_id)


@app.post("/api/docs/open-upload")
async def open_uploaded_doc(
    file: UploadFile = File(...),
    password: Optional[str] = Form(None),
    file_path: Optional[str] = Form(None),
) -> Dict[str, Any]:
    raw_bytes = await file.read()
    try:
        session = session_manager.open_document(
            pdf_bytes=raw_bytes,
            filename=file.filename or "Document.pdf",
            file_path=file_path,
            password=password,
        )
        return session_manager.get_document_summary(session.doc_id)
    except PermissionError as p_err:
        raise HTTPException(status_code=401, detail=str(p_err)) from p_err
    except ValueError as v_err:
        raise HTTPException(status_code=400, detail=str(v_err)) from v_err


@app.post("/api/docs/open-path")
def open_doc_by_path(req: OpenPathRequest) -> Dict[str, Any]:
    p = Path(req.file_path).expanduser().resolve()
    if not p.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {p}")
    try:
        session = session_manager.open_document(
            pdf_bytes=p.read_bytes(),
            filename=p.name,
            file_path=str(p),
            password=req.password,
        )
        return session_manager.get_document_summary(session.doc_id)
    except PermissionError as p_err:
        raise HTTPException(status_code=401, detail=str(p_err)) from p_err
    except ValueError as v_err:
        raise HTTPException(status_code=400, detail=str(v_err)) from v_err


@app.get("/api/docs")
def list_open_docs() -> List[Dict[str, Any]]:
    return [session_manager.get_document_summary(doc_id) for doc_id in list(session_manager.sessions.keys())]


@app.get("/api/docs/{doc_id}")
def get_doc_info(doc_id: str) -> Dict[str, Any]:
    try:
        return session_manager.get_document_summary(doc_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/docs/{doc_id}/download")
def download_doc_bytes(doc_id: str) -> Response:
    try:
        session = session_manager.get_session(doc_id)
        data = session_manager.get_export_bytes(doc_id)
        return Response(
            content=data,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{session.filename}"'},
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/docs/{doc_id}/save")
def save_doc(doc_id: str, req: SaveDocRequest) -> Dict[str, Any]:
    try:
        res = session_manager.safe_save(
            doc_id=doc_id,
            target_path=req.target_path,
            create_backup=req.create_backup,
        )
        return {**res, "summary": session_manager.get_document_summary(doc_id)}
    except (KeyError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/docs/{doc_id}")
def close_doc(doc_id: str) -> Dict[str, Any]:
    session_manager.close_session(doc_id)
    return {"closed": doc_id}


@app.post("/api/docs/{doc_id}/undo")
def undo_doc(doc_id: str) -> Dict[str, Any]:
    try:
        state = session_manager.undo(doc_id)
        return {**state, "summary": session_manager.get_document_summary(doc_id)}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/docs/{doc_id}/redo")
def redo_doc(doc_id: str) -> Dict[str, Any]:
    try:
        state = session_manager.redo(doc_id)
        return {**state, "summary": session_manager.get_document_summary(doc_id)}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/recovery")
def get_recoverable_sessions() -> List[Dict[str, Any]]:
    return session_manager.list_recoverable_sessions()


@app.post("/api/recovery/{doc_id}/restore")
def restore_recovered_session(doc_id: str) -> Dict[str, Any]:
    try:
        session = session_manager.recover_session(doc_id)
        return session_manager.get_document_summary(session.doc_id)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.delete("/api/recovery/{doc_id}")
def discard_recovered_session(doc_id: str) -> Dict[str, Any]:
    session_manager._remove_recovery_snapshot(doc_id)
    return {"discarded": doc_id}


# --- Rendering & Search ---


@app.get("/api/docs/{doc_id}/pages/{page_index}/render")
def render_page(
    doc_id: str,
    page_index: int,
    dpi: int = Query(144, ge=36, le=400),
    format: str = Query("json"),
) -> Any:
    try:
        session = session_manager.get_session(doc_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    doc = pymupdf.open(stream=session.pdf_bytes, filetype="pdf")
    try:
        if not (0 <= page_index < len(doc)):
            raise HTTPException(status_code=400, detail=f"Page {page_index} out of range")
        page = doc[page_index]
        pix = page.get_pixmap(dpi=int(dpi), alpha=False)
        png_bytes = pix.tobytes("png")
        if format == "png":
            return Response(content=png_bytes, media_type="image/png")
        return {
            "page_index": page_index,
            "width_pt": round(page.rect.width, 2),
            "height_pt": round(page.rect.height, 2),
            "pixel_width": pix.width,
            "pixel_height": pix.height,
            "dpi": dpi,
            "rotation": page.rotation,
            "image_base64": base64.b64encode(png_bytes).decode("ascii"),
        }
    finally:
        doc.close()


@app.get("/api/docs/{doc_id}/thumbnails")
def render_thumbnails(doc_id: str, dpi: int = Query(54, ge=24, le=120)) -> List[Dict[str, Any]]:
    try:
        session = session_manager.get_session(doc_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    doc = pymupdf.open(stream=session.pdf_bytes, filetype="pdf")
    thumbs: List[Dict[str, Any]] = []
    try:
        for idx, page in enumerate(doc):
            pix = page.get_pixmap(dpi=int(dpi), alpha=False)
            png_bytes = pix.tobytes("png")
            thumbs.append(
                {
                    "page_index": idx,
                    "page_number": idx + 1,
                    "width_pt": round(page.rect.width, 1),
                    "height_pt": round(page.rect.height, 1),
                    "rotation": page.rotation,
                    "image_base64": base64.b64encode(png_bytes).decode("ascii"),
                }
            )
        return thumbs
    finally:
        doc.close()


@app.post("/api/docs/{doc_id}/search")
def search_document(doc_id: str, req: SearchRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    q = req.query.strip()
    if not q:
        return {"query": "", "total_matches": 0, "matches": []}
    doc = pymupdf.open(stream=session.pdf_bytes, filetype="pdf")
    matches: List[Dict[str, Any]] = []
    try:
        for p_idx, page in enumerate(doc):
            rects = page.search_for(q)
            for r in rects:
                disp_r = rect_to_display(page, [r.x0, r.y0, r.x1, r.y1])
                matches.append(
                    {
                        "page_index": p_idx,
                        "page_number": p_idx + 1,
                        "bbox": [round(disp_r[0], 2), round(disp_r[1], 2), round(disp_r[2], 2), round(disp_r[3], 2)],
                    }
                )
        return {"query": q, "total_matches": len(matches), "matches": matches}
    finally:
        doc.close()


# --- Direct PDF Content Editing ---


@app.get("/api/docs/{doc_id}/pages/{page_index}/objects")
def get_page_editable_objects(doc_id: str, page_index: int) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    return inspect_page_objects(session.pdf_bytes, page_index=page_index)


@app.post("/api/docs/{doc_id}/pages/{page_index}/edit-text")
def api_edit_text_span(doc_id: str, page_index: int, req: EditTextSpanRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    res = edit_text_span(
        pdf_bytes=session.pdf_bytes,
        page_index=page_index,
        orig_bbox=req.orig_bbox,
        new_text=req.new_text,
        orig_origin=req.orig_origin,
        new_bbox=req.new_bbox,
        font_name=req.font_name,
        original_font=req.original_font,
        font_size=req.font_size,
        color_hex=req.color_hex,
        bold=req.bold,
        italic=req.italic,
        align=req.align,
        line_height=req.line_height,
        keep_original_font=req.keep_original_font,
    )
    action_label = "Delete Text Span" if req.new_text == "" else f"Edit Text ('{req.new_text[:24]}')"
    session_manager.update_session(doc_id, res["pdf_bytes"], action=action_label)
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "objects": inspect_page_objects(session.pdf_bytes, page_index=page_index),
        "edit_method": res["edit_method"],
        "font_strategy": res.get("font_strategy", ""),
        "moved": res.get("moved", False),
        "whiteout_used": res["whiteout_used"],
        "fallback_used": res["fallback_used"],
        "fallback_reason": res["fallback_reason"],
        "applied_font": res["applied_font"],
    }


@app.post("/api/docs/{doc_id}/pages/{page_index}/add-text")
def api_add_text_object(doc_id: str, page_index: int, req: AddTextRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    new_bytes = add_text_object(
        pdf_bytes=session.pdf_bytes,
        page_index=page_index,
        text=req.text,
        bbox=req.bbox,
        font_name=req.font_name,
        font_size=req.font_size,
        color_hex=req.color_hex,
        bold=req.bold,
        italic=req.italic,
        align=req.align,
        background_hex=req.background_hex,
        border_hex=req.border_hex,
        border_width=req.border_width,
    )
    session_manager.update_session(doc_id, new_bytes, action=f"Add Text ('{req.text[:20]}')")
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "objects": inspect_page_objects(session.pdf_bytes, page_index=page_index),
    }


@app.post("/api/docs/{doc_id}/pages/{page_index}/insert-image")
async def api_insert_image(
    doc_id: str,
    page_index: int,
    file: UploadFile = File(...),
    x0: float = Form(72.0),
    y0: float = Form(72.0),
    x1: float = Form(272.0),
    y1: float = Form(222.0),
    rotation: int = Form(0),
) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    img_bytes = await file.read()
    new_bytes = insert_image_object(
        pdf_bytes=session.pdf_bytes,
        page_index=page_index,
        image_bytes=img_bytes,
        bbox=[x0, y0, x1, y1],
        rotation=rotation,
    )
    session_manager.update_session(doc_id, new_bytes, action=f"Insert Image ({file.filename})")
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "objects": inspect_page_objects(session.pdf_bytes, page_index=page_index),
    }


@app.post("/api/docs/{doc_id}/pages/{page_index}/edit-image")
def api_edit_image(doc_id: str, page_index: int, req: EditImageRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    rep_bytes = base64.b64decode(req.replacement_image_base64) if req.replacement_image_base64 else None
    new_bytes = edit_image_object(
        pdf_bytes=session.pdf_bytes,
        page_index=page_index,
        xref=req.xref,
        action=req.action,
        orig_bbox=req.orig_bbox,
        new_bbox=req.new_bbox,
        rotation=req.rotation,
        crop_ratios=req.crop_ratios,
        replacement_image_bytes=rep_bytes,
    )
    session_manager.update_session(doc_id, new_bytes, action=f"Edit Image ({req.action} xref={req.xref})")
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "objects": inspect_page_objects(session.pdf_bytes, page_index=page_index),
    }


@app.post("/api/docs/{doc_id}/pages/{page_index}/add-shape")
def api_add_shape(doc_id: str, page_index: int, req: AddShapeRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    new_bytes = add_shape_object(
        pdf_bytes=session.pdf_bytes,
        page_index=page_index,
        shape_type=req.shape_type,
        bbox=req.bbox,
        stroke_hex=req.stroke_hex,
        fill_hex=req.fill_hex,
        stroke_width=req.stroke_width,
        opacity=req.opacity,
    )
    session_manager.update_session(doc_id, new_bytes, action=f"Add Shape ({req.shape_type})")
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "objects": inspect_page_objects(session.pdf_bytes, page_index=page_index),
    }


@app.post("/api/docs/{doc_id}/pages/{page_index}/transform-object")
def api_transform_object(doc_id: str, page_index: int, req: TransformObjectRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    new_bytes = transform_object(
        pdf_bytes=session.pdf_bytes,
        page_index=page_index,
        object_id=req.object_id,
        object_type=req.object_type,
        action=req.action,
        orig_bbox=req.orig_bbox,
        new_bbox=req.new_bbox,
        text=req.text,
        font_name=req.font_name,
        font_size=req.font_size,
        color_hex=req.color_hex,
        bold=req.bold,
        italic=req.italic,
        align=req.align,
        shape_type=req.shape_type,
        stroke_hex=req.stroke_hex,
        fill_hex=req.fill_hex,
        stroke_width=req.stroke_width,
        opacity=req.opacity,
        rotation=req.rotation or 0,
        image_xref=req.image_xref,
    )
    action_label = {
        "delete": f"Delete {req.object_type.title()}",
        "duplicate": f"Duplicate {req.object_type.title()}",
        "update_style": f"Format {req.object_type.title()}",
    }.get(req.action, f"Move/Resize {req.object_type.title()}")
    session_manager.update_session(doc_id, new_bytes, action=action_label)
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "objects": inspect_page_objects(session.pdf_bytes, page_index=page_index),
    }


@app.post("/api/docs/{doc_id}/pages/{page_index}/hyperlink")
def api_manage_hyperlink(doc_id: str, page_index: int, req: HyperlinkRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    new_bytes = manage_hyperlink(
        pdf_bytes=session.pdf_bytes,
        page_index=page_index,
        action=req.action,
        bbox=req.bbox,
        uri=req.uri,
        target_page=req.target_page,
    )
    session_manager.update_session(doc_id, new_bytes, action=f"Hyperlink ({req.action})")
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "objects": inspect_page_objects(session.pdf_bytes, page_index=page_index),
    }


# --- Page Management ---


@app.post("/api/docs/{doc_id}/pages/insert-blank")
def api_insert_blank_page(doc_id: str, req: InsertBlankPageRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    new_bytes = insert_blank_page(session.pdf_bytes, index=req.index, width=req.width, height=req.height)
    session_manager.update_session(doc_id, new_bytes, action="Insert Blank Page")
    return session_manager.get_document_summary(doc_id)


@app.post("/api/docs/{doc_id}/pages/delete")
def api_delete_pages(doc_id: str, req: PageIndicesRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    doc = pymupdf.open(stream=session.pdf_bytes, filetype="pdf")
    total = len(doc)
    doc.close()
    indices = req.page_indices or parse_page_range_spec(req.range_spec or "", total)
    try:
        new_bytes = delete_pages(session.pdf_bytes, indices)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    session_manager.update_session(doc_id, new_bytes, action=f"Delete Pages ({len(indices)})")
    return session_manager.get_document_summary(doc_id)


@app.post("/api/docs/{doc_id}/pages/duplicate")
def api_duplicate_page(doc_id: str, req: DuplicatePageRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    new_bytes = duplicate_page(session.pdf_bytes, req.page_index)
    session_manager.update_session(doc_id, new_bytes, action=f"Duplicate Page {req.page_index + 1}")
    return session_manager.get_document_summary(doc_id)


@app.post("/api/docs/{doc_id}/pages/extract")
def api_extract_pages(doc_id: str, req: PageIndicesRequest, open_as_tab: bool = Query(True)) -> Any:
    session = session_manager.get_session(doc_id)
    doc = pymupdf.open(stream=session.pdf_bytes, filetype="pdf")
    total = len(doc)
    doc.close()
    indices = req.page_indices or parse_page_range_spec(req.range_spec or "", total)
    extracted_bytes = extract_pages(session.pdf_bytes, indices)
    if open_as_tab:
        new_session = session_manager.open_document(
            pdf_bytes=extracted_bytes,
            filename=f"Extracted_{session.filename}",
        )
        return session_manager.get_document_summary(new_session.doc_id)
    return Response(content=extracted_bytes, media_type="application/pdf")


@app.post("/api/docs/{doc_id}/pages/reorder")
def api_reorder_pages(doc_id: str, req: ReorderPagesRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    new_bytes = reorder_pages(session.pdf_bytes, req.new_order)
    session_manager.update_session(doc_id, new_bytes, action="Reorder Pages")
    return session_manager.get_document_summary(doc_id)


@app.post("/api/docs/{doc_id}/pages/rotate")
def api_rotate_pages(doc_id: str, req: RotatePagesRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    new_bytes = rotate_pages(session.pdf_bytes, req.page_indices, req.delta_degrees)
    session_manager.update_session(doc_id, new_bytes, action=f"Rotate Pages ({req.delta_degrees}°)")
    return session_manager.get_document_summary(doc_id)


@app.post("/api/docs/{doc_id}/pages/crop")
def api_crop_page(doc_id: str, req: CropPageRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    new_bytes = crop_page(
        session.pdf_bytes,
        page_index=req.page_index,
        crop_box=req.crop_box,
        margins=req.margins,
        apply_to_all=req.apply_to_all,
    )
    session_manager.update_session(doc_id, new_bytes, action="Crop Page(s)")
    return session_manager.get_document_summary(doc_id)


@app.post("/api/docs/{doc_id}/pages/resize")
def api_resize_pages(doc_id: str, req: ResizePagesRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    new_bytes = resize_pages(
        session.pdf_bytes,
        new_width=req.new_width,
        new_height=req.new_height,
        page_indices=req.page_indices,
        scale_content=req.scale_content,
    )
    session_manager.update_session(doc_id, new_bytes, action=f"Resize Pages ({req.new_width}x{req.new_height})")
    return session_manager.get_document_summary(doc_id)


@app.post("/api/docs/{doc_id}/pages/insert-from-pdf")
async def api_insert_pages_from_pdf(
    doc_id: str,
    file: UploadFile = File(...),
    insert_at_index: int = Form(-1),
    source_range: Optional[str] = Form(None),
) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    src_bytes = await file.read()
    new_bytes = insert_pages_from_pdf(
        base_pdf_bytes=session.pdf_bytes,
        source_pdf_bytes=src_bytes,
        insert_at_index=insert_at_index,
        source_range=source_range,
    )
    session_manager.update_session(doc_id, new_bytes, action=f"Insert Pages from {file.filename}")
    return session_manager.get_document_summary(doc_id)


@app.post("/api/docs/merge")
def api_merge_open_docs(req: MergeOpenDocsRequest) -> Dict[str, Any]:
    streams = [session_manager.get_session(did).pdf_bytes for did in req.doc_ids]
    merged_bytes = merge_pdfs(streams)
    new_session = session_manager.open_document(
        pdf_bytes=merged_bytes,
        filename=req.output_filename,
    )
    return session_manager.get_document_summary(new_session.doc_id)


@app.post("/api/docs/{doc_id}/pages/split")
def api_split_pdf(doc_id: str, req: SplitPdfRequest, open_tabs: bool = Query(True)) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    parts = split_pdf(
        session.pdf_bytes,
        mode=req.mode,
        ranges_spec=req.ranges_spec,
        every_n_pages=req.every_n_pages,
    )
    created_tabs = []
    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for fname, data in parts:
            zf.writestr(fname, data)
            if open_tabs:
                tab_sess = session_manager.open_document(pdf_bytes=data, filename=fname)
                created_tabs.append(session_manager.get_document_summary(tab_sess.doc_id))

    return {
        "split_count": len(parts),
        "created_tabs": created_tabs,
        "zip_base64": base64.b64encode(zip_buf.getvalue()).decode("ascii"),
    }


# --- Annotations & Review ---


@app.get("/api/docs/{doc_id}/annotations")
def api_list_annotations(doc_id: str, page_index: Optional[int] = Query(None)) -> List[Dict[str, Any]]:
    session = session_manager.get_session(doc_id)
    return list_annotations(session.pdf_bytes, page_index=page_index)


@app.post("/api/docs/{doc_id}/annotations")
def api_add_annotation(doc_id: str, req: AddAnnotationRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    new_bytes = add_annotation(
        pdf_bytes=session.pdf_bytes,
        page_index=req.page_index,
        annot_type=req.annot_type,
        bbox=req.bbox,
        content=req.content,
        author=req.author,
        color_hex=req.color_hex,
        fill_hex=req.fill_hex,
        opacity=req.opacity,
        stroke_width=req.stroke_width,
        ink_strokes=req.ink_strokes,
        stamp_name=req.stamp_name,
        font_size=req.font_size,
    )
    session_manager.update_session(doc_id, new_bytes, action=f"Add Annotation ({req.annot_type})")
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "annotations": list_annotations(session.pdf_bytes),
    }


@app.put("/api/docs/{doc_id}/annotations/{xref}")
def api_update_annotation(doc_id: str, xref: int, req: UpdateAnnotationRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    new_bytes = update_annotation(
        pdf_bytes=session.pdf_bytes,
        page_index=req.page_index,
        xref=xref,
        content=req.content,
        author=req.author,
        color_hex=req.color_hex,
        opacity=req.opacity,
        new_bbox=req.new_bbox,
    )
    session_manager.update_session(doc_id, new_bytes, action=f"Update Annotation ({xref})")
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "annotations": list_annotations(session.pdf_bytes),
    }


@app.delete("/api/docs/{doc_id}/annotations/{xref}")
def api_delete_annotation(doc_id: str, xref: int, page_index: int = Query(0)) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    new_bytes = delete_annotation(session.pdf_bytes, page_index=page_index, xref=xref)
    session_manager.update_session(doc_id, new_bytes, action=f"Delete Annotation ({xref})")
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "annotations": list_annotations(session.pdf_bytes),
    }


# --- Forms & Signatures ---


@app.get("/api/docs/{doc_id}/forms")
def api_list_forms(doc_id: str, page_index: Optional[int] = Query(None)) -> List[Dict[str, Any]]:
    session = session_manager.get_session(doc_id)
    return list_form_fields(session.pdf_bytes, page_index=page_index)


@app.post("/api/docs/{doc_id}/forms/create")
def api_create_form_field(doc_id: str, req: CreateFormFieldRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    new_bytes = create_form_field(
        pdf_bytes=session.pdf_bytes,
        page_index=req.page_index,
        field_type=req.field_type,
        field_name=req.field_name,
        bbox=req.bbox,
        default_value=req.default_value,
        checked=req.checked,
        choices=req.choices,
        font_size=req.font_size,
        text_color_hex=req.text_color_hex,
        fill_color_hex=req.fill_color_hex,
        border_color_hex=req.border_color_hex,
        read_only=req.read_only,
        tooltip=req.tooltip,
    )
    session_manager.update_session(doc_id, new_bytes, action=f"Create Form Field ({req.field_name})")
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "fields": list_form_fields(session.pdf_bytes),
    }


@app.post("/api/docs/{doc_id}/forms/fill")
def api_fill_forms(doc_id: str, req: FillFormFieldsRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    new_bytes = fill_form_fields(session.pdf_bytes, values=req.values, page_index=req.page_index)
    session_manager.update_session(doc_id, new_bytes, action="Fill Form Fields")
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "fields": list_form_fields(session.pdf_bytes),
    }


@app.put("/api/docs/{doc_id}/forms/{xref}")
def api_update_form_field(doc_id: str, xref: int, req: UpdateFormFieldRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    new_bytes = update_form_field(
        pdf_bytes=session.pdf_bytes,
        page_index=req.page_index,
        xref=xref,
        field_name=req.field_name,
        value=req.value,
        bbox=req.bbox,
        choices=req.choices,
        read_only=req.read_only,
        text_color_hex=req.text_color_hex,
        fill_color_hex=req.fill_color_hex,
        font_size=req.font_size,
    )
    session_manager.update_session(doc_id, new_bytes, action=f"Update Form Field ({xref})")
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "fields": list_form_fields(session.pdf_bytes),
    }


@app.delete("/api/docs/{doc_id}/forms/{xref}")
def api_delete_form_field(doc_id: str, xref: int, page_index: int = Query(0)) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    new_bytes = delete_form_field(session.pdf_bytes, page_index=page_index, xref=xref)
    session_manager.update_session(doc_id, new_bytes, action=f"Delete Form Field ({xref})")
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "fields": list_form_fields(session.pdf_bytes),
    }


@app.post("/api/docs/{doc_id}/signatures/visual")
def api_apply_visual_signature(doc_id: str, req: VisualSignatureRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    img_bytes = base64.b64decode(req.signature_image_base64) if req.signature_image_base64 else None
    res = apply_visual_signature(
        pdf_bytes=session.pdf_bytes,
        page_index=req.page_index,
        bbox=req.bbox,
        mode=req.mode,
        signer_name=req.signer_name,
        typed_text=req.typed_text,
        ink_strokes=req.ink_strokes,
        signature_image_bytes=img_bytes,
        color_hex=req.color_hex,
        include_date=req.include_date,
    )
    session_manager.update_session(doc_id, res["pdf_bytes"], action=f"Visual Signature ({req.signer_name})")
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "signature_kind": res["signature_kind"],
        "cryptographic": res["cryptographic"],
        "notice": res["notice"],
    }


@app.post("/api/signatures/generate-cert")
def api_generate_cert(req: GenerateCertRequest) -> Dict[str, Any]:
    res = generate_pkcs12_certificate(
        common_name=req.common_name,
        organization=req.organization,
        email=req.email,
        country=req.country,
        passphrase=req.passphrase,
        valid_days=req.valid_days,
    )
    p12_b64 = base64.b64encode(res.pop("p12_bytes")).decode("ascii")
    return {**res, "p12_base64": p12_b64}


@app.post("/api/docs/{doc_id}/signatures/cryptographic")
def api_sign_cryptographic(doc_id: str, req: CryptographicSignRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    p12_bytes = base64.b64decode(req.p12_base64) if req.p12_base64 else None
    res = sign_pdf_cryptographic(
        pdf_bytes=session.pdf_bytes,
        page_index=req.page_index,
        bbox=req.bbox,
        field_name=req.field_name,
        reason=req.reason,
        location=req.location,
        contact_info=req.contact_info,
        p12_bytes=p12_bytes,
        passphrase=req.passphrase,
        signer_name=req.signer_name,
        organization=req.organization,
    )
    session_manager.update_session(
        doc_id,
        res["pdf_bytes"],
        action=f"Cryptographic X.509 Signature ({res['signer_cn']})",
    )
    verification = verify_pdf_signatures(session.pdf_bytes)
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "signature_kind": res["signature_kind"],
        "cryptographic": res["cryptographic"],
        "field_name": res["field_name"],
        "signer_cn": res["signer_cn"],
        "signer_org": res["signer_org"],
        "signed_at": res["signed_at"],
        "certificate_sha256": res["certificate_sha256"],
        "verification": verification,
    }


@app.get("/api/docs/{doc_id}/signatures/verify")
def api_verify_signatures(doc_id: str) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    return verify_pdf_signatures(session.pdf_bytes)


# --- OCR & Conversions ---


@app.get("/api/ocr/languages")
def api_ocr_languages() -> List[Dict[str, str]]:
    return SUPPORTED_OCR_LANGUAGES


@app.post("/api/docs/{doc_id}/ocr")
def api_run_ocr(doc_id: str, req: OcrRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    res = ocr_pdf_pages(
        pdf_bytes=session.pdf_bytes,
        page_indices=req.page_indices,
        language=req.language,
        dpi=req.dpi,
        force_ocr_on_existing_text=req.force_ocr_on_existing_text,
    )
    session_manager.update_session(doc_id, res["pdf_bytes"], action=f"OCR Searchable Layer ({req.language})")
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "language": res["language"],
        "engine": res["engine"],
        "total_lines_added": res["total_lines_added"],
        "pages": res["pages"],
    }


@app.get("/api/docs/{doc_id}/export/{fmt}")
@app.post("/api/docs/{doc_id}/export/{fmt}")
def api_export_document(doc_id: str, fmt: str) -> Any:
    session = session_manager.get_session(doc_id)
    stem = Path(session.filename).stem
    kind = fmt.lower().strip()

    if kind == "docx":
        docx_bytes = convert_pdf_to_docx(session.pdf_bytes)
        return Response(
            content=docx_bytes,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{stem}.docx"'},
        )
    if kind == "txt":
        txt = convert_pdf_to_text(session.pdf_bytes)
        return Response(
            content=txt.encode("utf-8"),
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{stem}.txt"'},
        )
    if kind == "html":
        html = convert_pdf_to_html(session.pdf_bytes)
        return Response(
            content=html.encode("utf-8"),
            media_type="text/html; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{stem}.html"'},
        )
    if kind == "xlsx":
        tbl = extract_tables_to_xlsx(session.pdf_bytes)
        return Response(
            content=tbl["xlsx_bytes"],
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{stem}_tables.xlsx"'},
        )
    if kind == "csv":
        tbl = extract_tables_to_xlsx(session.pdf_bytes)
        return Response(
            content=tbl["csv_text"].encode("utf-8"),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{stem}_tables.csv"'},
        )
    if kind == "tables-json":
        tbl = extract_tables_to_xlsx(session.pdf_bytes)
        return {
            "tables_count": tbl["tables_count"],
            "tables": tbl["tables"],
            "csv_text": tbl["csv_text"],
            "xlsx_base64": base64.b64encode(tbl["xlsx_bytes"]).decode("ascii"),
        }
    if kind in ("images", "png", "jpg"):
        img_fmt = "jpg" if kind == "jpg" else "png"
        imgs = convert_pdf_to_images(session.pdf_bytes, image_format=img_fmt)
        return Response(
            content=imgs["zip_bytes"],
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{stem}_images.zip"'},
        )

    raise HTTPException(status_code=400, detail=f"Unsupported export format: {fmt}")


@app.post("/api/convert/docx-to-pdf")
async def api_convert_docx_to_pdf(
    file: UploadFile = File(...),
    open_as_tab: bool = Form(True),
) -> Any:
    docx_bytes = await file.read()
    pdf_bytes = convert_docx_to_pdf(docx_bytes)
    fname = f"{Path(file.filename or 'Document').stem}.pdf"
    if open_as_tab:
        sess = session_manager.open_document(pdf_bytes=pdf_bytes, filename=fname)
        return session_manager.get_document_summary(sess.doc_id)
    return Response(content=pdf_bytes, media_type="application/pdf")


@app.post("/api/convert/images-to-pdf")
async def api_convert_images_to_pdf(
    files: List[UploadFile] = File(...),
    page_size: str = Form("fit_image"),
    open_as_tab: bool = Form(True),
) -> Any:
    imgs = [await f.read() for f in files]
    pdf_bytes = convert_images_to_pdf(imgs, page_size=page_size)
    if open_as_tab:
        sess = session_manager.open_document(pdf_bytes=pdf_bytes, filename="Converted_Images.pdf")
        return session_manager.get_document_summary(sess.doc_id)
    return Response(content=pdf_bytes, media_type="application/pdf")


@app.post("/api/convert/batch")
async def api_batch_convert(
    files: List[UploadFile] = File(...),
    target_format: str = Form("txt"),
) -> Response:
    items = [(f.filename or f"file_{i}.pdf", await f.read()) for i, f in enumerate(files)]
    zip_bytes = batch_convert_documents(items, target_format=target_format)
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="batch_converted_{target_format}.zip"'},
    )


# --- Security & Optimization ---


@app.post("/api/docs/{doc_id}/security/encrypt")
def api_encrypt_pdf(doc_id: str, req: EncryptRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    cfg = {
        "user_password": req.user_password,
        "owner_password": req.owner_password,
        "encryption_level": req.encryption_level,
        "allow_print": req.allow_print,
        "allow_modify": req.allow_modify,
        "allow_extract": req.allow_extract,
        "allow_annotate": req.allow_annotate,
        "allow_forms": req.allow_forms,
        "allow_assemble": req.allow_assemble,
    }
    enc_bytes = encrypt_pdf(
        pdf_bytes=session.pdf_bytes,
        user_password=req.user_password,
        owner_password=req.owner_password,
        encryption_level=req.encryption_level,
        allow_print=req.allow_print,
        allow_modify=req.allow_modify,
        allow_extract=req.allow_extract,
        allow_annotate=req.allow_annotate,
        allow_forms=req.allow_forms,
        allow_assemble=req.allow_assemble,
    )
    session.is_encrypted = True
    session.password = req.user_password or req.owner_password
    session.encryption_config = cfg
    session.dirty = True
    session.push_mutation(session.pdf_bytes, action=f"Encrypt PDF ({req.encryption_level})")
    return {
        "encrypted": True,
        "encryption_level": req.encryption_level,
        "encrypted_size_bytes": len(enc_bytes),
        "encrypted_base64": base64.b64encode(enc_bytes).decode("ascii"),
    }


@app.post("/api/docs/{doc_id}/security/decrypt")
def api_decrypt_pdf(doc_id: str, req: DecryptRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    session.is_encrypted = False
    session.password = None
    session.encryption_config = None
    session.push_mutation(session.pdf_bytes, action="Remove PDF Password Encryption")
    return session_manager.get_document_summary(doc_id)


@app.post("/api/docs/{doc_id}/security/redact")
def api_redact_pdf(doc_id: str, req: RedactRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    res = apply_permanent_redaction(
        pdf_bytes=session.pdf_bytes,
        page_redactions=req.page_redactions,
        search_terms=req.search_terms,
        regex_pattern=req.regex_pattern,
        fill_color_hex=req.fill_color_hex,
        overlay_text=req.overlay_text,
        text_color_hex=req.text_color_hex,
    )
    session_manager.update_session(
        doc_id,
        res["pdf_bytes"],
        action=f"Permanent Redaction ({res['redacted_regions_count']} region(s))",
    )
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "redacted_regions_count": res["redacted_regions_count"],
        "pages_affected": res["pages_affected"],
        "permanent_stream_purge": res["permanent_stream_purge"],
    }


@app.post("/api/docs/{doc_id}/security/sanitize")
def api_sanitize_pdf(doc_id: str) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    res = sanitize_pdf_metadata(session.pdf_bytes)
    session_manager.update_session(doc_id, res["pdf_bytes"], action="Sanitize Hidden Metadata")
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "removed_metadata": res["removed_metadata"],
        "xmp_stripped": res["xmp_stripped"],
        "javascript_stripped": res["javascript_stripped"],
    }


@app.get("/api/docs/{doc_id}/properties")
def api_get_properties(doc_id: str) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    return get_document_properties(session.pdf_bytes)


@app.put("/api/docs/{doc_id}/properties")
def api_set_properties(doc_id: str, req: DocumentPropertiesRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    props = {k: v for k, v in req.model_dump().items() if v is not None}
    new_bytes = set_document_properties(session.pdf_bytes, props)
    session_manager.update_session(doc_id, new_bytes, action="Update Document Properties")
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "properties": get_document_properties(session.pdf_bytes),
    }


@app.post("/api/docs/{doc_id}/optimize")
def api_optimize_pdf(doc_id: str, req: OptimizeRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    res = optimize_and_compress_pdf(
        pdf_bytes=session.pdf_bytes,
        image_quality=req.image_quality,
        max_image_dimension=req.max_image_dimension,
        linearize=req.linearize,
    )
    session_manager.update_session(doc_id, res["pdf_bytes"], action="Compress & Optimize PDF")
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "original_size_bytes": res["original_size_bytes"],
        "optimized_size_bytes": res["optimized_size_bytes"],
        "saved_bytes": res["saved_bytes"],
        "savings_percent": res["savings_percent"],
        "images_optimized": res["images_optimized"],
    }


@app.get("/api/docs/{doc_id}/fonts")
def api_inspect_fonts(doc_id: str) -> List[Dict[str, Any]]:
    session = session_manager.get_session(doc_id)
    return inspect_embedded_fonts(session.pdf_bytes)


@app.post("/api/docs/{doc_id}/repair")
def api_repair_pdf(doc_id: str) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    res = repair_pdf_document(session.pdf_bytes)
    session_manager.update_session(doc_id, res["pdf_bytes"], action="Repair PDF Structure")
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "repaired": res["repaired"],
        "diagnostics": res["diagnostics"],
    }


# --- Professional Features ---


@app.post("/api/docs/compare")
def api_compare_docs(req: CompareDocsRequest) -> Dict[str, Any]:
    sess_a = session_manager.get_session(req.doc_id_a)
    sess_b = session_manager.get_session(req.doc_id_b)
    return compare_pdf_documents(sess_a.pdf_bytes, sess_b.pdf_bytes, dpi=req.dpi)


@app.post("/api/docs/{doc_id}/pro/header-footer")
def api_header_footer(doc_id: str, req: HeaderFooterRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    new_bytes = apply_header_footer(
        pdf_bytes=session.pdf_bytes,
        header_left=req.header_left,
        header_center=req.header_center,
        header_right=req.header_right,
        footer_left=req.footer_left,
        footer_center=req.footer_center,
        footer_right=req.footer_right,
        font_size=req.font_size,
        color_hex=req.color_hex,
        margin_top=req.margin_top,
        margin_bottom=req.margin_bottom,
        margin_side=req.margin_side,
        page_indices=req.page_indices,
    )
    session_manager.update_session(doc_id, new_bytes, action="Apply Header & Footer")
    return session_manager.get_document_summary(doc_id)


@app.post("/api/docs/{doc_id}/pro/watermark")
def api_watermark(doc_id: str, req: WatermarkRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    new_bytes = apply_watermark(
        pdf_bytes=session.pdf_bytes,
        text=req.text,
        font_size=req.font_size,
        color_hex=req.color_hex,
        opacity=req.opacity,
        rotation=req.rotation,
        overlay=req.overlay,
        page_indices=req.page_indices,
    )
    session_manager.update_session(doc_id, new_bytes, action=f"Apply Watermark ('{req.text}')")
    return session_manager.get_document_summary(doc_id)


@app.post("/api/docs/{doc_id}/pro/bates")
def api_bates(doc_id: str, req: BatesRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    res = apply_bates_numbering(
        pdf_bytes=session.pdf_bytes,
        prefix=req.prefix,
        suffix=req.suffix,
        start_number=req.start_number,
        digits=req.digits,
        position=req.position,
        font_size=req.font_size,
        color_hex=req.color_hex,
        page_indices=req.page_indices,
    )
    session_manager.update_session(doc_id, res["pdf_bytes"], action=f"Bates Numbering ({res['first_bates']})")
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "first_bates": res["first_bates"],
        "last_bates": res["last_bates"],
        "next_number": res["next_number"],
        "count": res["count"],
    }


@app.get("/api/docs/{doc_id}/bookmarks")
def api_get_bookmarks(doc_id: str) -> List[Dict[str, Any]]:
    session = session_manager.get_session(doc_id)
    return get_bookmarks(session.pdf_bytes)


@app.post("/api/docs/{doc_id}/bookmarks")
def api_add_bookmark(doc_id: str, req: AddBookmarkRequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    new_bytes = add_bookmark(session.pdf_bytes, title=req.title, page_index=req.page_index, level=req.level)
    session_manager.update_session(doc_id, new_bytes, action=f"Add Bookmark ('{req.title}')")
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "bookmarks": get_bookmarks(session.pdf_bytes),
    }


@app.delete("/api/docs/{doc_id}/bookmarks/{index}")
def api_delete_bookmark(doc_id: str, index: int) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    new_bytes = delete_bookmark(session.pdf_bytes, bookmark_index=index)
    session_manager.update_session(doc_id, new_bytes, action="Delete Bookmark")
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "bookmarks": get_bookmarks(session.pdf_bytes),
    }


@app.get("/api/docs/{doc_id}/attachments")
def api_list_attachments(doc_id: str) -> List[Dict[str, Any]]:
    session = session_manager.get_session(doc_id)
    return list_attachments(session.pdf_bytes)


@app.post("/api/docs/{doc_id}/attachments")
async def api_add_attachment(
    doc_id: str,
    file: UploadFile = File(...),
    description: str = Form(""),
) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    fbytes = await file.read()
    fname = file.filename or "attachment.bin"
    new_bytes = add_attachment(session.pdf_bytes, filename=fname, file_bytes=fbytes, description=description)
    session_manager.update_session(doc_id, new_bytes, action=f"Attach File ({fname})")
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "attachments": list_attachments(session.pdf_bytes),
    }


@app.get("/api/docs/{doc_id}/attachments/{name}")
def api_extract_attachment(doc_id: str, name: str) -> Response:
    session = session_manager.get_session(doc_id)
    data = extract_attachment(session.pdf_bytes, name=name)
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@app.delete("/api/docs/{doc_id}/attachments/{name}")
def api_delete_attachment(doc_id: str, name: str) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    new_bytes = delete_attachment(session.pdf_bytes, name=name)
    session_manager.update_session(doc_id, new_bytes, action=f"Delete Attachment ({name})")
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "attachments": list_attachments(session.pdf_bytes),
    }


@app.get("/api/docs/{doc_id}/pro/preflight")
def api_preflight(doc_id: str) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    return run_preflight_and_accessibility_check(session.pdf_bytes)


@app.post("/api/docs/{doc_id}/pro/pdfa")
def api_convert_pdfa(doc_id: str, req: PdfARequest) -> Dict[str, Any]:
    session = session_manager.get_session(doc_id)
    res = convert_to_pdfa(
        session.pdf_bytes,
        conformance=req.conformance,
        language=req.language,
        title=req.title,
    )
    session_manager.update_session(doc_id, res["pdf_bytes"], action=f"Convert to PDF/A-{req.conformance}")
    return {
        "summary": session_manager.get_document_summary(doc_id),
        "is_pdfa": res["is_pdfa"],
        "pdfa_conformance": res["pdfa_conformance"],
        "preflight_score": res["preflight_score"],
        "inspection": res["inspection"],
    }


if __name__ == "__main__":
    import argparse
    import signal
    import uvicorn

    # Ensure backend terminates if parent process (Electron) exits on Linux
    try:
        import ctypes
        libc = ctypes.CDLL("libc.so.6")
        PR_SET_PDEATHSIG = 1
        libc.prctl(PR_SET_PDEATHSIG, signal.SIGTERM)
    except Exception:
        pass

    parser = argparse.ArgumentParser(description="Vellum PDF Pro Backend Engine")
    parser.add_argument("--port", type=int, default=int(os.environ.get("VELLUM_PORT", "18420")))
    parser.add_argument("--host", type=str, default="127.0.0.1")
    args, _ = parser.parse_known_args()

    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
