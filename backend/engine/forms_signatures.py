"""Interactive AcroForms, Visual Signatures, and Cryptographic X.509/PKCS#12 Digital Signatures."""

from __future__ import annotations

import datetime
import hashlib
import io
from typing import Any, Dict, List, Optional, Tuple

import pikepdf
import pymupdf
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign import fields as pyhanko_fields
from pyhanko.sign import signers as pyhanko_signers
from pyhanko.sign.validation import validate_pdf_signature
from pyhanko_certvalidator import ValidationContext

from .utils import hex_to_rgb_float, rect_to_display, rect_to_pdf, rgb_float_to_hex

WIDGET_TYPE_NAMES: Dict[int, str] = {
    pymupdf.PDF_WIDGET_TYPE_TEXT: "text",
    pymupdf.PDF_WIDGET_TYPE_CHECKBOX: "checkbox",
    pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON: "radiobutton",
    pymupdf.PDF_WIDGET_TYPE_COMBOBOX: "dropdown",
    pymupdf.PDF_WIDGET_TYPE_LISTBOX: "listbox",
    pymupdf.PDF_WIDGET_TYPE_SIGNATURE: "signature",
    pymupdf.PDF_WIDGET_TYPE_BUTTON: "button",
}

ALIGN_TO_Q = {"left": 0, "center": 1, "right": 2}
Q_TO_ALIGN = {0: "left", 1: "center", 2: "right"}


def _detect_xfa_and_acroform(pdf_bytes: bytes) -> Dict[str, Any]:
    """Inspect PDF catalog for /AcroForm and /XFA without modifying the document."""
    acroform_present = False
    is_xfa = False
    try:
        with pikepdf.open(io.BytesIO(pdf_bytes)) as pdf:
            root = pdf.Root
            if "/AcroForm" in root:
                acroform_present = True
                acro = root["/AcroForm"]
                if hasattr(acro, "get") and "/XFA" in acro:
                    is_xfa = True
    except Exception:
        pass
    notice = (
        "This PDF contains an Adobe XFA (XML Forms Architecture) form. "
        "Dynamic XFA scripts and layouts are proprietary and unsupported; "
        "any AcroForm fallback fields remain inspectable without altering the XFA stream."
        if is_xfa
        else None
    )
    return {
        "acroform_present": acroform_present,
        "is_xfa": is_xfa,
        "xfa_notice": notice,
    }


def _read_widget_align(doc: pymupdf.Document, xref: int) -> str:
    """Read /Q text alignment from widget xref or its parent field."""
    try:
        q_type, q_val = doc.xref_get_key(xref, "Q")
        if q_type == "int":
            return Q_TO_ALIGN.get(int(q_val), "left")
        p_type, p_val = doc.xref_get_key(xref, "Parent")
        if p_type == "xref":
            p_xref = int(p_val.split()[0])
            pq_type, pq_val = doc.xref_get_key(p_xref, "Q")
            if pq_type == "int":
                return Q_TO_ALIGN.get(int(pq_val), "left")
    except Exception:
        pass
    return "left"


def _write_widget_align(doc: pymupdf.Document, xref: int, align: str) -> None:
    """Write /Q alignment integer (0=left, 1=center, 2=right) to widget xref."""
    q = ALIGN_TO_Q.get(align.lower().strip(), 0)
    try:
        doc.xref_set_key(xref, "Q", str(q))
    except Exception:
        pass


def _widget_has_appearance(doc: pymupdf.Document, xref: int) -> bool:
    try:
        ap_type, _ = doc.xref_get_key(xref, "AP")
        return ap_type != "null"
    except Exception:
        return False


def _estimate_text_fit(
    rect: pymupdf.Rect,
    text: str,
    fontsize: float,
    multiline: bool,
    fontname: str = "helv",
    min_fontsize: float = 6.0,
) -> Dict[str, Any]:
    """Check whether `text` fits inside `rect` and compute a fitted font size if needed."""
    avail_w = max(8.0, float(rect.width) - 6.0)
    avail_h = max(8.0, float(rect.height) - 4.0)
    try:
        font_obj = pymupdf.Font(fontname or "helv")
    except Exception:
        font_obj = pymupdf.Font("helv")

    def fits_at(sz: float) -> bool:
        if not text:
            return True
        if not multiline:
            w_pt = font_obj.text_length(text.replace("\n", " "), fontsize=sz)
            return w_pt <= avail_w and (sz * 1.2) <= avail_h + 4.0
        words = text.replace("\r\n", "\n").split(" ")
        lines = 1
        cur_w = 0.0
        space_w = font_obj.text_length(" ", fontsize=sz)
        for idx, tok in enumerate(words):
            parts = tok.split("\n")
            for p_i, part in enumerate(parts):
                if p_i > 0:
                    lines += 1
                    cur_w = 0.0
                pw = font_obj.text_length(part, fontsize=sz)
                if cur_w > 0 and cur_w + space_w + pw > avail_w:
                    lines += 1
                    cur_w = pw
                else:
                    cur_w = pw if cur_w == 0 else cur_w + space_w + pw
        total_h = lines * (sz * 1.25)
        return total_h <= avail_h + 2.0

    start_sz = float(fontsize) if fontsize and fontsize > 0 else min(12.0, max(min_fontsize, avail_h * 0.65))
    if fits_at(start_sz):
        return {"fits": True, "fitted_fontsize": round(start_sz, 1), "overflow": False}

    # Try stepping down to min_fontsize
    cand = start_sz - 0.5
    while cand >= min_fontsize:
        if fits_at(cand):
            return {"fits": True, "fitted_fontsize": round(cand, 1), "overflow": True}
        cand -= 0.5
    return {"fits": False, "fitted_fontsize": min_fontsize, "overflow": True}


def list_form_fields(pdf_bytes: bytes, page_index: Optional[int] = None) -> List[Dict[str, Any]]:
    """List all interactive AcroForm fields in the PDF document."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    fields_out: List[Dict[str, Any]] = []
    try:
        pages = [page_index] if (page_index is not None and 0 <= page_index < len(doc)) else range(len(doc))
        for p_idx in pages:
            page = doc[p_idx]
            widgets = list(page.widgets() or [])
            for tab_idx, w in enumerate(widgets):
                disp_bbox = rect_to_display(page, w.rect)
                w_type = WIDGET_TYPE_NAMES.get(w.field_type, w.field_type_string.lower())
                val = w.field_value
                if w_type in ("checkbox", "radiobutton"):
                    is_checked = bool(val and str(val).lower() not in ("off", "false", "0", "no", ""))
                else:
                    is_checked = False
                try:
                    export_val = w.on_state()
                except Exception:
                    export_val = None
                flags = int(w.field_flags or 0)
                fields_out.append(
                    {
                        "xref": int(w.xref),
                        "page_index": p_idx,
                        "page_number": p_idx + 1,
                        "field_name": w.field_name or f"field_{w.xref}",
                        "field_label": w.field_label or "",
                        "field_type": w_type,
                        "value": val if val is not None else "",
                        "checked": is_checked,
                        "export_value": str(export_val) if export_val else "Yes",
                        "choices": list(w.choice_values or []),
                        "bbox": disp_bbox,
                        "text_fontsize": round(float(w.text_fontsize or 0.0), 1),
                        "text_font": w.text_font or "helv",
                        "text_color": rgb_float_to_hex(tuple(w.text_color or (0, 0, 0))),
                        "fill_color": rgb_float_to_hex(tuple(w.fill_color)) if w.fill_color else None,
                        "border_color": rgb_float_to_hex(tuple(w.border_color)) if w.border_color else None,
                        "is_signed": bool(getattr(w, "is_signed", False)),
                        "read_only": bool(flags & pymupdf.PDF_FIELD_IS_READ_ONLY),
                        "required": bool(flags & pymupdf.PDF_FIELD_IS_REQUIRED),
                        "multiline": bool(flags & pymupdf.PDF_TX_FIELD_IS_MULTILINE),
                        "password_field": bool(flags & pymupdf.PDF_TX_FIELD_IS_PASSWORD),
                        "text_maxlen": int(getattr(w, "text_maxlen", 0) or 0),
                        "align": _read_widget_align(doc, int(w.xref)),
                        "tab_order": tab_idx,
                        "has_appearance": _widget_has_appearance(doc, int(w.xref)),
                    }
                )
        return fields_out
    finally:
        doc.close()


def inspect_form_fields(pdf_bytes: bytes, page_index: Optional[int] = None) -> Dict[str, Any]:
    """Return full AcroForm/XFA inspection report and typed field definitions."""
    meta = _detect_xfa_and_acroform(pdf_bytes)
    fields = list_form_fields(pdf_bytes, page_index=page_index)
    return {
        "acroform_present": meta["acroform_present"] or len(fields) > 0,
        "is_xfa": meta["is_xfa"],
        "xfa_notice": meta["xfa_notice"],
        "field_count": len(fields),
        "fields": fields,
    }


def create_form_field(
    pdf_bytes: bytes,
    page_index: int,
    field_type: str,
    field_name: str,
    bbox: List[float],
    default_value: str = "",
    checked: bool = False,
    choices: Optional[List[str]] = None,
    font_size: float = 11.0,
    text_color_hex: str = "#000000",
    fill_color_hex: str = "#f8fafc",
    border_color_hex: str = "#475569",
    read_only: bool = False,
    required: bool = False,
    multiline: bool = False,
    max_length: int = 0,
    align: str = "left",
    font_name: str = "helv",
    tooltip: str = "",
) -> bytes:
    """Create a new interactive AcroForm field (text, multiline, checkbox, radiobutton, dropdown, listbox, signature)."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = doc[page_index]
        rect = pymupdf.Rect(rect_to_pdf(page, bbox))
        if rect.width < 12:
            rect.x1 = rect.x0 + 140
        if rect.height < 12:
            rect.y1 = rect.y0 + 24

        widget = pymupdf.Widget()
        widget.rect = rect
        widget.field_name = field_name.strip() or f"Field_{page_index}_{int(rect.x0)}_{int(rect.y0)}"
        widget.field_label = tooltip or widget.field_name
        widget.text_fontsize = float(font_size)
        widget.text_font = font_name or "helv"
        widget.text_color = list(hex_to_rgb_float(text_color_hex))
        if fill_color_hex and fill_color_hex.lower() != "transparent":
            widget.fill_color = list(hex_to_rgb_float(fill_color_hex))
        if border_color_hex and border_color_hex.lower() != "transparent":
            widget.border_color = list(hex_to_rgb_float(border_color_hex))
            widget.border_width = 1.0
        else:
            widget.border_width = 0.0

        kind = field_type.lower().strip()
        if kind in ("text", "multiline"):
            widget.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
            widget.field_value = default_value
            if kind == "multiline" or multiline:
                widget.field_flags |= pymupdf.PDF_TX_FIELD_IS_MULTILINE
            if max_length and int(max_length) > 0:
                widget.text_maxlen = int(max_length)
        elif kind == "checkbox":
            widget.field_type = pymupdf.PDF_WIDGET_TYPE_CHECKBOX
            widget.field_value = True if checked or str(default_value).lower() in ("true", "yes", "1", "on") else False
        elif kind in ("radiobutton", "radio"):
            widget.field_type = pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON
            widget.field_value = True if checked or str(default_value).lower() in ("true", "yes", "1", "on") else False
        elif kind in ("dropdown", "combobox", "select"):
            widget.field_type = pymupdf.PDF_WIDGET_TYPE_COMBOBOX
            opts = [c.strip() for c in (choices or ["Option 1", "Option 2", "Option 3"]) if c.strip()]
            widget.choice_values = opts
            widget.field_value = default_value if default_value in opts else (opts[0] if opts else "")
            widget.field_flags = pymupdf.PDF_CH_FIELD_IS_COMBO | pymupdf.PDF_CH_FIELD_IS_EDIT
        elif kind == "listbox":
            widget.field_type = pymupdf.PDF_WIDGET_TYPE_LISTBOX
            opts = [c.strip() for c in (choices or ["Option 1", "Option 2", "Option 3"]) if c.strip()]
            widget.choice_values = opts
            widget.field_value = default_value if default_value in opts else (opts[0] if opts else "")
        elif kind == "signature":
            widget.field_type = pymupdf.PDF_WIDGET_TYPE_SIGNATURE
        else:
            raise ValueError(f"Unsupported form field type: {field_type}")

        if read_only:
            widget.field_flags |= pymupdf.PDF_FIELD_IS_READ_ONLY
        if required:
            widget.field_flags |= pymupdf.PDF_FIELD_IS_REQUIRED

        annot = page.add_widget(widget)
        if kind in ("text", "multiline") and annot is not None:
            _write_widget_align(doc, int(annot.xref), align)
        return doc.tobytes(garbage=2, deflate=True)
    finally:
        doc.close()


def fill_form_fields_with_report(
    pdf_bytes: bytes,
    values: Dict[str, Any],
    page_index: Optional[int] = None,
    auto_fit: bool = True,
) -> Dict[str, Any]:
    """Fill AcroForm fields, enforce max length / text fitting, and return updated bytes + warnings."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    warnings: List[Dict[str, Any]] = []
    try:
        pages = [page_index] if (page_index is not None and 0 <= page_index < len(doc)) else range(len(doc))
        for p_idx in pages:
            page = doc[p_idx]
            for w in page.widgets() or []:
                key_name = w.field_name
                key_xref = str(w.xref)
                if key_name not in values and key_xref not in values:
                    continue
                if bool(w.field_flags & pymupdf.PDF_FIELD_IS_READ_ONLY):
                    warnings.append({
                        "field_name": key_name,
                        "xref": int(w.xref),
                        "code": "read_only",
                        "message": f"Field '{key_name}' is read-only and was not modified.",
                    })
                    continue

                new_val = values[key_xref] if key_xref in values else values[key_name]
                if w.field_type == pymupdf.PDF_WIDGET_TYPE_CHECKBOX:
                    if isinstance(new_val, bool):
                        w.field_value = new_val
                    else:
                        w.field_value = str(new_val).lower() in ("true", "1", "yes", "on")
                elif w.field_type == pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON:
                    try:
                        on_val = str(w.on_state() or "Yes")
                    except Exception:
                        on_val = "Yes"
                    if isinstance(new_val, bool):
                        w.field_value = new_val
                    elif str(new_val).lower() in ("true", "1", "yes", "on") or str(new_val) == on_val:
                        w.field_value = True
                    else:
                        w.field_value = False
                elif w.field_type == pymupdf.PDF_WIDGET_TYPE_TEXT:
                    txt = str(new_val if new_val is not None else "")
                    maxlen = int(getattr(w, "text_maxlen", 0) or 0)
                    if maxlen > 0 and len(txt) > maxlen:
                        warnings.append({
                            "field_name": key_name,
                            "xref": int(w.xref),
                            "code": "max_length_exceeded",
                            "message": f"Field '{key_name}' truncated from {len(txt)} to {maxlen} characters (MaxLen={maxlen}).",
                        })
                        txt = txt[:maxlen]
                    is_ml = bool(w.field_flags & pymupdf.PDF_TX_FIELD_IS_MULTILINE)
                    orig_sz = float(w.text_fontsize or 0.0)
                    fit = _estimate_text_fit(
                        w.rect,
                        txt,
                        orig_sz,
                        multiline=is_ml,
                        fontname=w.text_font or "helv",
                    )
                    if fit["overflow"]:
                        if (orig_sz == 0.0 or auto_fit) and fit["fits"]:
                            w.text_fontsize = fit["fitted_fontsize"]
                            warnings.append({
                                "field_name": key_name,
                                "xref": int(w.xref),
                                "code": "auto_fitted",
                                "message": f"Field '{key_name}' font size auto-fitted to {fit['fitted_fontsize']} pt to prevent clipping.",
                            })
                        elif not fit["fits"]:
                            if orig_sz == 0.0 or auto_fit:
                                w.text_fontsize = fit["fitted_fontsize"]
                            warnings.append({
                                "field_name": key_name,
                                "xref": int(w.xref),
                                "code": "text_overflow",
                                "message": f"Text in field '{key_name}' exceeds field bounds even at {fit['fitted_fontsize']} pt.",
                            })
                    w.field_value = txt
                else:
                    w.field_value = str(new_val if new_val is not None else "")
                w.update()
        return {"pdf_bytes": doc.tobytes(garbage=2, deflate=True), "warnings": warnings}
    finally:
        doc.close()


def fill_form_fields(
    pdf_bytes: bytes,
    values: Dict[str, Any],
    page_index: Optional[int] = None,
) -> bytes:
    """Fill one or more AcroForm fields by `field_name` (or `xref` string) and update appearances."""
    return fill_form_fields_with_report(pdf_bytes, values=values, page_index=page_index)["pdf_bytes"]


def update_form_field(
    pdf_bytes: bytes,
    page_index: int,
    xref: int,
    field_name: Optional[str] = None,
    value: Optional[Any] = None,
    bbox: Optional[List[float]] = None,
    choices: Optional[List[str]] = None,
    read_only: Optional[bool] = None,
    required: Optional[bool] = None,
    multiline: Optional[bool] = None,
    max_length: Optional[int] = None,
    align: Optional[str] = None,
    font_name: Optional[str] = None,
    text_color_hex: Optional[str] = None,
    fill_color_hex: Optional[str] = None,
    border_color_hex: Optional[str] = None,
    font_size: Optional[float] = None,
    tooltip: Optional[str] = None,
) -> bytes:
    """Update properties or value of an existing AcroForm field widget."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = doc[page_index]
        for w in page.widgets() or []:
            if int(w.xref) == int(xref):
                if field_name is not None:
                    w.field_name = field_name
                if tooltip is not None:
                    w.field_label = tooltip
                if bbox and len(bbox) == 4:
                    w.rect = pymupdf.Rect(rect_to_pdf(page, bbox))
                if choices is not None and w.field_type in (
                    pymupdf.PDF_WIDGET_TYPE_COMBOBOX,
                    pymupdf.PDF_WIDGET_TYPE_LISTBOX,
                ):
                    w.choice_values = choices
                if font_name:
                    w.text_font = font_name
                if text_color_hex:
                    w.text_color = list(hex_to_rgb_float(text_color_hex))
                if fill_color_hex:
                    w.fill_color = list(hex_to_rgb_float(fill_color_hex))
                if border_color_hex:
                    w.border_color = list(hex_to_rgb_float(border_color_hex))
                if font_size is not None:
                    w.text_fontsize = float(font_size)
                if max_length is not None and w.field_type == pymupdf.PDF_WIDGET_TYPE_TEXT:
                    w.text_maxlen = max(0, int(max_length))
                target_flags = int(w.field_flags or 0)
                if read_only is not None:
                    if read_only:
                        target_flags |= pymupdf.PDF_FIELD_IS_READ_ONLY
                    else:
                        target_flags &= ~pymupdf.PDF_FIELD_IS_READ_ONLY
                if required is not None:
                    if required:
                        target_flags |= pymupdf.PDF_FIELD_IS_REQUIRED
                    else:
                        target_flags &= ~pymupdf.PDF_FIELD_IS_REQUIRED
                if multiline is not None and w.field_type == pymupdf.PDF_WIDGET_TYPE_TEXT:
                    if multiline:
                        target_flags |= pymupdf.PDF_TX_FIELD_IS_MULTILINE
                    else:
                        target_flags &= ~pymupdf.PDF_TX_FIELD_IS_MULTILINE
                w.field_flags = target_flags
                if value is not None:
                    if w.field_type in (pymupdf.PDF_WIDGET_TYPE_CHECKBOX, pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON):
                        w.field_value = (
                            value if isinstance(value, bool) else str(value).lower() in ("true", "1", "yes", "on")
                        )
                    else:
                        w.field_value = str(value)
                w.update()
                doc.xref_set_key(int(w.xref), "Ff", str(target_flags))
                if align is not None and w.field_type == pymupdf.PDF_WIDGET_TYPE_TEXT:
                    _write_widget_align(doc, int(w.xref), align)
                break
        return doc.tobytes(garbage=2, deflate=True)
    finally:
        doc.close()


def duplicate_form_field(pdf_bytes: bytes, page_index: int, xref: int, offset_pt: float = 18.0) -> bytes:
    """Duplicate an existing AcroForm widget on the same page with a unique name."""
    fields = list_form_fields(pdf_bytes, page_index=page_index)
    target = next((f for f in fields if int(f["xref"]) == int(xref)), None)
    if target is None:
        raise KeyError(f"Form field xref {xref} not found on page {page_index}")
    x0, y0, x1, y1 = target["bbox"]
    new_bbox = [x0 + offset_pt, y0 + offset_pt, x1 + offset_pt, y1 + offset_pt]
    existing_names = {f["field_name"] for f in list_form_fields(pdf_bytes)}
    base_name = f"{target['field_name']}_copy"
    cand = base_name
    idx = 2
    while cand in existing_names:
        cand = f"{base_name}_{idx}"
        idx += 1
    return create_form_field(
        pdf_bytes=pdf_bytes,
        page_index=page_index,
        field_type=target["field_type"],
        field_name=cand,
        bbox=new_bbox,
        default_value=str(target.get("value") or ""),
        checked=bool(target.get("checked")),
        choices=target.get("choices") or None,
        font_size=float(target.get("text_fontsize") or 11.0),
        text_color_hex=target.get("text_color") or "#000000",
        fill_color_hex=target.get("fill_color") or "#f8fafc",
        border_color_hex=target.get("border_color") or "#475569",
        read_only=bool(target.get("read_only")),
        required=bool(target.get("required")),
        multiline=bool(target.get("multiline")),
        max_length=int(target.get("text_maxlen") or 0),
        align=str(target.get("align") or "left"),
        font_name=str(target.get("text_font") or "helv"),
        tooltip=str(target.get("field_label") or cand),
    )


def reorder_form_tab_order(pdf_bytes: bytes, page_index: int, ordered_xrefs: List[int]) -> bytes:
    """Reorder widget annotations in a page's /Annots array to control Tab order."""
    with pikepdf.open(io.BytesIO(pdf_bytes)) as pdf:
        page = pdf.pages[page_index]
        if "/Annots" not in page:
            return pdf_bytes
        annots = list(page["/Annots"])
        widget_map: Dict[int, Any] = {}
        non_widgets: List[Tuple[int, Any]] = []
        for idx, annot in enumerate(annots):
            objgen = getattr(annot, "objgen", None)
            xref_num = int(objgen[0]) if objgen else -1
            is_widget = hasattr(annot, "get") and annot.get("/Subtype") == pikepdf.Name("/Widget")
            if is_widget and xref_num > 0:
                widget_map[xref_num] = annot
            else:
                non_widgets.append((idx, annot))

        reordered_widgets: List[Any] = []
        seen = set()
        for xr in ordered_xrefs:
            if int(xr) in widget_map and int(xr) not in seen:
                reordered_widgets.append(widget_map[int(xr)])
                seen.add(int(xr))
        for xr, annot in widget_map.items():
            if xr not in seen:
                reordered_widgets.append(annot)

        new_annots: List[Any] = [a for _, a in non_widgets] + reordered_widgets
        page["/Annots"] = pikepdf.Array(new_annots)
        out = io.BytesIO()
        pdf.save(out)
        return out.getvalue()


def detect_form_field_candidates(pdf_bytes: bytes, page_index: int = 0) -> List[Dict[str, Any]]:
    """Heuristically suggest AcroForm fields from static rectangles/tables/checkboxes without altering the PDF."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = doc[page_index]
        existing_widgets = list(page.widgets() or [])
        existing_rects = [w.rect for w in existing_widgets]
        used_names: set = {str(w.field_name or "").strip() for w in existing_widgets if getattr(w, "field_name", None)}

        text_spans: List[Dict[str, Any]] = []
        tdict = page.get_text("dict")
        for blk in tdict.get("blocks", []):
            if blk.get("type") != 0:
                continue
            for ln in blk.get("lines", []):
                spans = ln.get("spans", [])
                txt = "".join(sp.get("text", "") for sp in spans).strip()
                if txt:
                    avg_size = sum(float(sp.get("size", 10.0)) for sp in spans) / max(1, len(spans))
                    text_spans.append({
                        "text": txt,
                        "rect": pymupdf.Rect(ln["bbox"]),
                        "size": avg_size,
                    })

        word_spans: List[Dict[str, Any]] = [
            {"text": str(w[4]).strip(), "rect": pymupdf.Rect(w[0], w[1], w[2], w[3])}
            for w in (page.get_text("words") or [])
            if str(w[4]).strip()
        ]

        drawings = page.get_drawings()
        vertical_dividers: List[Tuple[float, float, float]] = []
        disabled_fill_rects: List[pymupdf.Rect] = []

        def _is_disabled_grey_fill(fill: Any) -> bool:
            if not fill or not isinstance(fill, (tuple, list)) or len(fill) < 3:
                return False
            r_c, g_c, b_c = float(fill[0]), float(fill[1]), float(fill[2])
            return 0.25 <= r_c <= 0.78 and abs(r_c - g_c) <= 0.06 and abs(g_c - b_c) <= 0.06

        for d in drawings:
            dr = pymupdf.Rect(d["rect"])
            if 0.3 <= dr.width <= 3.0 and dr.height >= 35:
                vertical_dividers.append(((dr.x0 + dr.x1) / 2.0, dr.y0, dr.y1))
            for item in d.get("items", []):
                if item and item[0] == "l" and len(item) >= 3:
                    p1, p2 = item[1], item[2]
                    if abs(p1.x - p2.x) <= 1.5 and abs(p1.y - p2.y) >= 35:
                        vertical_dividers.append(((p1.x + p2.x) / 2.0, min(p1.y, p2.y), max(p1.y, p2.y)))
            if dr.width >= 20 and dr.height >= 12 and _is_disabled_grey_fill(d.get("fill")):
                disabled_fill_rects.append(dr)

        candidates: List[Dict[str, Any]] = []
        seen_boxes: List[pymupdf.Rect] = []

        def _overlaps_existing(r: pymupdf.Rect) -> bool:
            for ex in existing_rects + seen_boxes:
                inter = r & ex
                if not inter.is_empty and inter.get_area() > 0.35 * min(r.get_area(), ex.get_area()):
                    return True
            return False

        def _text_inside(r: pymupdf.Rect) -> str:
            inner = pymupdf.Rect(r.x0 - 1, r.y0 - 1, r.x1 + 1, r.y1 + 1)
            hits = [
                sp for sp in text_spans
                if inner.contains(pymupdf.Point((sp["rect"].x0 + sp["rect"].x1) / 2.0, (sp["rect"].y0 + sp["rect"].y1) / 2.0))
            ]
            hits.sort(key=lambda s: (round(s["rect"].y0 / 4.0), s["rect"].x0))
            return " ".join(h["text"] for h in hits).strip()

        def _is_cell_disabled(r: pymupdf.Rect) -> bool:
            inside_txt = _text_inside(r).upper()
            if inside_txt in ("N/A", "NA", "NONE", "-", "—"):
                return True
            for df in disabled_fill_rects:
                inter = r & df
                if not inter.is_empty and inter.get_area() >= 0.5 * r.get_area():
                    return True
            return False

        def _left_row_label(r: pymupdf.Rect) -> str:
            # Find primary label(s) to the left on the same horizontal band
            left_hits: List[Dict[str, Any]] = []
            for sp in text_spans:
                sr = sp["rect"]
                txt_u = sp["text"].strip().upper()
                if txt_u in ("N/A", "NA", "NONE", "-", "—"):
                    continue
                if sr.x1 > r.x0 + 10:
                    continue
                v_overlap = min(sr.y1, r.y1) - max(sr.y0, r.y0)
                mid_diff = abs((sr.y0 + sr.y1) / 2.0 - (r.y0 + r.y1) / 2.0)
                if v_overlap >= 2 or mid_diff <= max(14.0, r.height * 0.45):
                    if r.x0 - sr.x1 <= 260:
                        left_hits.append(sp)
            if not left_hits:
                return ""
            # Prefer non-parenthetical primary lines (closest horizontally, but accept table row labels up to 260pt)
            left_hits.sort(key=lambda s: (abs(r.x0 - s["rect"].x1) > 150, s["rect"].y0, s["rect"].x0))
            primary = [h for h in left_hits if not h["text"].startswith("(") and h["size"] >= 7.5]
            if primary:
                # If multi-line label in the same column (e.g. LONG HAUL / TRUCKING-MEDIUM), join lines
                anchor_x = primary[0]["rect"].x0
                same_col = [h for h in primary if abs(h["rect"].x0 - anchor_x) <= 24]
                same_col.sort(key=lambda s: s["rect"].y0)
                return " ".join(h["text"].rstrip(":") for h in same_col[:2]).strip()
            return left_hits[0]["text"].rstrip(":")

        def _nearest_label(r: pymupdf.Rect) -> str:
            left_lbl = _left_row_label(r)
            if left_lbl:
                return left_lbl
            best_txt = ""
            best_dist = 180.0
            for sp in text_spans:
                sr = sp["rect"]
                if sr.size < 7.5 or sp["text"].startswith("("):
                    continue
                if 0 <= r.y0 - sr.y1 <= 16 and abs(sr.x0 - r.x0) <= 60:
                    dist = (r.y0 - sr.y1) + 12.0
                    if dist < best_dist:
                        best_dist = dist
                        best_txt = sp["text"].rstrip(":")
            return best_txt

        def _col_header_for_cell(cell_r: pymupdf.Rect, table_top_y: float) -> str:
            cx = (cell_r.x0 + cell_r.x1) / 2.0
            hits = []
            for sp in text_spans:
                sr = sp["rect"]
                if sr.y1 <= cell_r.y0 + 2 and sr.y0 >= table_top_y - 36:
                    # Prefer line span if it doesn't straddle far outside this cell
                    if sr.x0 >= cell_r.x0 - 10 and sr.x1 <= cell_r.x1 + 10:
                        hits.append(sp)
            if not hits:
                # Fall back to word-level spans when a header line straddles two columns (e.g. "ACCIDENT SECONDARY")
                word_hits = [
                    ws for ws in word_spans
                    if ws["rect"].y1 <= cell_r.y0 + 2
                    and ws["rect"].y0 >= table_top_y - 36
                    and ws["rect"].x0 - 6 <= cx <= ws["rect"].x1 + 6
                ]
                if word_hits:
                    word_hits.sort(key=lambda s: abs(cell_r.y0 - s["rect"].y1))
                    return word_hits[0]["text"].strip()
                for sp in text_spans:
                    sr = sp["rect"]
                    if sr.y1 <= cell_r.y0 + 2 and sr.y0 >= table_top_y - 36:
                        if sr.x0 - 12 <= cx <= sr.x1 + 12 or (min(sr.x1, cell_r.x1) - max(sr.x0, cell_r.x0)) >= 8:
                            hits.append(sp)
            if not hits:
                return ""
            hits.sort(key=lambda s: abs(cell_r.y0 - s["rect"].y1))
            return hits[0]["text"].strip()

        def _slug(label: str, fallback: str) -> str:
            cleaned = "".join(ch.lower() if ch.isalnum() else "_" for ch in label).strip("_")
            while "__" in cleaned:
                cleaned = cleaned.replace("__", "_")
            base = cleaned[:40] if cleaned else fallback
            candidate = base
            idx = 2
            while candidate in used_names:
                suffix = f"_{idx}"
                candidate = f"{base[:max(1, 40 - len(suffix))]}{suffix}"
                idx += 1
            used_names.add(candidate)
            return candidate

        for d in drawings:
            r = pymupdf.Rect(d["rect"])
            if r.width <= 3 or r.height <= 3:
                continue
            # Checkbox candidate: small square
            if 8 <= r.width <= 22 and 8 <= r.height <= 22 and abs(r.width - r.height) <= 5:
                if _overlaps_existing(r) or _text_inside(r):
                    continue
                lbl = _nearest_label(r)
                seen_boxes.append(r)
                candidates.append({
                    "id": f"cand_{len(candidates) + 1}",
                    "page_index": page_index,
                    "field_type": "checkbox",
                    "field_name": _slug(lbl, f"checkbox_{len(candidates) + 1}"),
                    "label": lbl or f"Checkbox {len(candidates) + 1}",
                    "bbox": rect_to_display(page, r),
                    "confidence": 0.85 if lbl else 0.65,
                })
            # Text / multiline box / table row matrix
            elif 48 <= r.width <= page.rect.width * 0.92 and 12 <= r.height <= 120:
                if _is_cell_disabled(r):
                    continue
                # Check if vertical grid dividers split this row into table cells
                split_xs = sorted({
                    round(vx, 2)
                    for vx, vy0, vy1 in vertical_dividers
                    if r.x0 + 8 < vx < r.x1 - 8 and vy0 <= r.y0 + 2 and vy1 >= r.y1 - 2
                })
                if split_xs:
                    col_bounds = [r.x0] + split_xs + [r.x1]
                    row_lbl = _left_row_label(r)
                    # Find top of table header region
                    table_top = min(
                        (vy0 for vx, vy0, vy1 in vertical_dividers if r.x0 - 4 <= vx <= r.x1 + 4 and vy1 >= r.y1 - 2),
                        default=r.y0 - 30,
                    )
                    for cx0, cx1 in zip(col_bounds[:-1], col_bounds[1:]):
                        cell_r = pymupdf.Rect(cx0, r.y0, cx1, r.y1)
                        if cell_r.width < 14 or _overlaps_existing(cell_r) or _is_cell_disabled(cell_r):
                            continue
                        col_lbl = _col_header_for_cell(cell_r, table_top)
                        if not col_lbl and _text_inside(cell_r):
                            continue
                        if cell_r.width <= 95 and cell_r.height <= 36 and row_lbl and col_lbl:
                            # Interactive checkbox centered inside matrix cell
                            cb_w = min(16.0, max(12.0, cell_r.width - 8.0))
                            cb_h = min(14.0, max(11.0, cell_r.height - 3.0))
                            mid_x = (cell_r.x0 + cell_r.x1) / 2.0
                            mid_y = (cell_r.y0 + cell_r.y1) / 2.0
                            cb_r = pymupdf.Rect(mid_x - cb_w / 2.0, mid_y - cb_h / 2.0, mid_x + cb_w / 2.0, mid_y + cb_h / 2.0)
                            full_lbl = f"{row_lbl} - {col_lbl}"
                            seen_boxes.append(cell_r)
                            candidates.append({
                                "id": f"cand_{len(candidates) + 1}",
                                "page_index": page_index,
                                "field_type": "checkbox",
                                "field_name": _slug(full_lbl, f"checkbox_{len(candidates) + 1}"),
                                "label": full_lbl,
                                "bbox": rect_to_display(page, cb_r),
                                "confidence": 0.90,
                            })
                        elif cell_r.width >= 36:
                            full_lbl = f"{row_lbl} - {col_lbl}".strip(" -") if (row_lbl or col_lbl) else ""
                            f_type = "multiline" if cell_r.height >= 38 else "text"
                            seen_boxes.append(cell_r)
                            candidates.append({
                                "id": f"cand_{len(candidates) + 1}",
                                "page_index": page_index,
                                "field_type": f_type,
                                "field_name": _slug(full_lbl, f"field_{len(candidates) + 1}"),
                                "label": full_lbl or f"Cell {len(candidates) + 1}",
                                "bbox": rect_to_display(page, cell_r),
                                "confidence": 0.85 if full_lbl else 0.70,
                            })
                    continue

                if _overlaps_existing(r) or _text_inside(r):
                    continue
                lbl = _nearest_label(r)
                lbl_l = lbl.lower()
                is_multiline = r.height >= 38 or (
                    r.height >= 28
                    and any(k in lbl_l for k in ("area", "location", "notes", "comment", "description", "detail", "remark"))
                )
                f_type = "multiline" if is_multiline else "text"
                seen_boxes.append(r)
                candidates.append({
                    "id": f"cand_{len(candidates) + 1}",
                    "page_index": page_index,
                    "field_type": f_type,
                    "field_name": _slug(lbl, f"field_{len(candidates) + 1}"),
                    "label": lbl or f"Text Field {len(candidates) + 1}",
                    "bbox": rect_to_display(page, r),
                    "confidence": 0.90 if lbl else 0.70,
                })

        candidates.sort(key=lambda c: (round(c["bbox"][1] / 8.0), c["bbox"][0]))
        for idx, c in enumerate(candidates, start=1):
            c["id"] = f"cand_{idx}"
        return candidates
    finally:
        doc.close()


def delete_form_field(pdf_bytes: bytes, page_index: int, xref: int) -> bytes:
    """Delete an interactive form field widget from a page."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = doc[page_index]
        for w in page.widgets() or []:
            if int(w.xref) == int(xref):
                page.delete_widget(w)
                break
        return doc.tobytes(garbage=2, deflate=True)
    finally:
        doc.close()


# --- Visual vs. Cryptographic Digital Signatures ---


def apply_visual_signature(
    pdf_bytes: bytes,
    page_index: int,
    bbox: List[float],
    mode: str = "typed",
    signer_name: str = "Authorized Signer",
    typed_text: Optional[str] = None,
    ink_strokes: Optional[List[List[List[float]]]] = None,
    signature_image_bytes: Optional[bytes] = None,
    color_hex: str = "#0f172a",
    include_date: bool = True,
) -> Dict[str, Any]:
    """
    Apply a VISUAL-ONLY signature (drawn handwritten path, uploaded signature image, or stylized text).
    Explicitly tagged as a visual appearance signature (not a cryptographic PKCS#7 digital signature).
    """
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = doc[page_index]
        rect = pymupdf.Rect(bbox)
        if rect.width < 80:
            rect.x1 = rect.x0 + 180
        if rect.height < 36:
            rect.y1 = rect.y0 + 56

        rgb = hex_to_rgb_float(color_hex)
        now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

        # Subtle signature baseline
        page.draw_line(
            pymupdf.Point(rect.x0 + 4, rect.y1 - 12),
            pymupdf.Point(rect.x1 - 4, rect.y1 - 12),
            color=(0.6, 0.65, 0.72),
            width=0.75,
        )

        if mode == "image" and signature_image_bytes:
            img_rect = pymupdf.Rect(rect.x0 + 4, rect.y0 + 2, rect.x1 - 4, rect.y1 - 14)
            page.insert_image(img_rect, stream=signature_image_bytes, keep_proportion=True)
        elif mode == "drawn" and ink_strokes:
            shape = page.new_shape()
            for stroke in ink_strokes:
                pts = [pymupdf.Point(float(p[0]), float(p[1])) for p in stroke if len(p) >= 2]
                for i in range(len(pts) - 1):
                    shape.draw_line(pts[i], pts[i + 1])
            shape.finish(color=rgb, width=2.2)
            shape.commit()
        else:
            sig_label = typed_text or signer_name or "Signed"
            fsize = min(22.0, max(12.0, rect.height * 0.42))
            page.insert_text(
                pymupdf.Point(rect.x0 + 8, rect.y1 - 18),
                sig_label,
                fontsize=fsize,
                fontname="tiit",  # Times-Italic calligraphic style
                color=rgb,
            )

        if include_date:
            caption = f"Visually Signed by {signer_name} • {now_str}"
            page.insert_text(
                pymupdf.Point(rect.x0 + 6, rect.y1 - 3),
                caption,
                fontsize=7.0,
                fontname="helv",
                color=(0.35, 0.4, 0.48),
            )

        return {
            "pdf_bytes": doc.tobytes(garbage=2, deflate=True),
            "signature_kind": "visual_appearance_only",
            "cryptographic": False,
            "notice": "Visual signature applied. For tamper-evident cryptographic X.509 signing, use Certificate Digital Signing.",
        }
    finally:
        doc.close()


def generate_pkcs12_certificate(
    common_name: str = "Alice Vance",
    organization: str = "Vellum PDF Enterprise",
    email: str = "alice@example.org",
    country: str = "US",
    passphrase: str = "vellum-secret",
    valid_days: int = 365,
) -> Dict[str, Any]:
    """
    Generate a standards-compliant RSA-2048 X.509 certificate and PKCS#12 (.p12) bundle
    suitable for cryptographic PDF signing via pyHanko.
    """
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    c_code = (country or "US").strip()[:2].upper() or "US"
    subject = issuer = x509.Name(
        [
            x509.NameAttribute(NameOID.COUNTRY_NAME, c_code),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, organization or "Vellum PDF User"),
            x509.NameAttribute(NameOID.COMMON_NAME, common_name or "PDF Signer"),
            x509.NameAttribute(NameOID.EMAIL_ADDRESS, email or "signer@localhost"),
        ]
    )
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=max(1, int(valid_days))))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=True,  # nonRepudiation for PDF document signing
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .sign(private_key, hashes.SHA256())
    )

    p12_bytes = pkcs12.serialize_key_and_certificates(
        name=common_name.encode("utf-8"),
        key=private_key,
        cert=cert,
        cas=None,
        encryption_algorithm=serialization.BestAvailableEncryption(passphrase.encode("utf-8"))
        if passphrase
        else serialization.NoEncryption(),
    )
    fingerprint = cert.fingerprint(hashes.SHA256()).hex()
    return {
        "p12_bytes": p12_bytes,
        "common_name": common_name,
        "organization": organization,
        "email": email,
        "serial_number": hex(cert.serial_number),
        "sha256_fingerprint": fingerprint,
        "valid_from": cert.not_valid_before_utc.isoformat(),
        "valid_until": cert.not_valid_after_utc.isoformat(),
    }


def sign_pdf_cryptographic(
    pdf_bytes: bytes,
    page_index: int = 0,
    bbox: Optional[List[float]] = None,
    field_name: str = "DigitalSignature1",
    reason: str = "I approve and certify this PDF document",
    location: str = "Linux Desktop Workstation",
    contact_info: str = "",
    p12_bytes: Optional[bytes] = None,
    passphrase: str = "vellum-secret",
    signer_name: str = "Alice Vance",
    organization: str = "Vellum PDF Enterprise",
) -> Dict[str, Any]:
    """
    Cryptographically sign a PDF document using an X.509 PKCS#12 certificate and pyHanko.
    Embeds both a visual cryptographic seal stamp and a verifiable CMS/PKCS#7 detached signature
    over the PDF `/ByteRange`.
    """
    cert_meta: Dict[str, Any] = {}
    if not p12_bytes:
        generated = generate_pkcs12_certificate(
            common_name=signer_name,
            organization=organization,
            passphrase=passphrase,
        )
        p12_bytes = generated["p12_bytes"]
        cert_meta = {k: v for k, v in generated.items() if k != "p12_bytes"}

    # Load PKCS#12 certificate to extract subject metadata and render seal banner
    _, cert_obj, _ = pkcs12.load_key_and_certificates(
        p12_bytes,
        passphrase.encode("utf-8") if passphrase else None,
    )
    if cert_obj is None:
        raise ValueError("Invalid PKCS#12 archive: no X.509 certificate found")

    cn_attrs = cert_obj.subject.get_attributes_for_oid(NameOID.COMMON_NAME)
    org_attrs = cert_obj.subject.get_attributes_for_oid(NameOID.ORGANIZATION_NAME)
    subject_cn = cn_attrs[0].value if cn_attrs else signer_name
    subject_org = org_attrs[0].value if org_attrs else organization
    fp_short = cert_obj.fingerprint(hashes.SHA256()).hex()[:16].upper()
    now_iso = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    # 1. Draw the visual cryptographic seal banner onto the page before incremental signing
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        p_idx = max(0, min(page_index, len(doc) - 1))
        page = doc[p_idx]
        page_h = page.rect.height
        raw_box = bbox or [50.0, page_h - 110.0, 310.0, page_h - 45.0]
        rect = pymupdf.Rect(raw_box)
        if rect.width < 140:
            rect.x1 = rect.x0 + 240
        if rect.height < 48:
            rect.y1 = rect.y0 + 62

        # Seal box
        page.draw_rect(
            rect,
            color=(0.08, 0.38, 0.24),
            fill=(0.94, 0.99, 0.96),
            width=1.2,
        )
        page.insert_text(
            pymupdf.Point(rect.x0 + 8, rect.y0 + 14),
            f"DIGITALLY SIGNED: {subject_cn}",
            fontsize=9.5,
            fontname="hebo",
            color=(0.06, 0.32, 0.18),
        )
        page.insert_text(
            pymupdf.Point(rect.x0 + 8, rect.y0 + 27),
            f"Org: {subject_org} | Reason: {reason[:38]}",
            fontsize=7.5,
            fontname="helv",
            color=(0.15, 0.23, 0.20),
        )
        page.insert_text(
            pymupdf.Point(rect.x0 + 8, rect.y0 + 39),
            f"Date: {now_iso} | Loc: {location[:24]}",
            fontsize=7.0,
            fontname="helv",
            color=(0.25, 0.33, 0.30),
        )
        page.insert_text(
            pymupdf.Point(rect.x0 + 8, rect.y0 + 50),
            f"X.509 SHA256: {fp_short}...",
            fontsize=6.8,
            fontname="cour",
            color=(0.25, 0.35, 0.45),
        )

        # Convert top-left PDF coordinates to bottom-left PDF coordinates for pyHanko SigFieldSpec
        llx = float(rect.x0)
        lly = float(page_h - rect.y1)
        urx = float(rect.x1)
        ury = float(page_h - rect.y0)
        prepped_bytes = doc.tobytes(garbage=2, deflate=True)
    finally:
        doc.close()

    # 2. Perform cryptographic CMS signing over PDF /ByteRange via pyHanko
    tmp_p12 = io.BytesIO(p12_bytes)
    # Write to a temporary named buffer or load directly via cryptography/pyHanko
    import tempfile

    with tempfile.NamedTemporaryFile(suffix=".p12", delete=True) as tf:
        tf.write(p12_bytes)
        tf.flush()
        signer = pyhanko_signers.SimpleSigner.load_pkcs12(
            pfx_file=tf.name,
            passphrase=passphrase.encode("utf-8") if passphrase else None,
        )

    writer = IncrementalPdfFileWriter(io.BytesIO(prepped_bytes))
    existing_fields = set()
    try:
        with pikepdf.open(io.BytesIO(prepped_bytes)) as pdoc:
            if "/AcroForm" in pdoc.Root and "/Fields" in pdoc.Root.AcroForm:
                for f_obj in pdoc.Root.AcroForm.Fields:
                    if "/T" in f_obj:
                        existing_fields.add(str(f_obj["/T"]))
    except Exception:
        pass

    actual_field_name = field_name
    counter = 1
    while actual_field_name in existing_fields:
        counter += 1
        actual_field_name = f"{field_name}_{counter}"

    pyhanko_fields.append_signature_field(
        writer,
        sig_field_spec=pyhanko_fields.SigFieldSpec(
            sig_field_name=actual_field_name,
            on_page=p_idx,
            box=(llx, lly, urx, ury),
        ),
    )

    meta = pyhanko_signers.PdfSignatureMetadata(
        field_name=actual_field_name,
        reason=reason,
        location=location,
        contact_info=contact_info or None,
    )
    out_stream = pyhanko_signers.sign_pdf(writer, signature_meta=meta, signer=signer)
    signed_bytes = out_stream.getvalue()

    return {
        "pdf_bytes": signed_bytes,
        "signature_kind": "cryptographic_pkcs7_cms",
        "cryptographic": True,
        "field_name": actual_field_name,
        "signer_cn": subject_cn,
        "signer_org": subject_org,
        "reason": reason,
        "location": location,
        "signed_at": now_iso,
        "certificate_sha256": cert_obj.fingerprint(hashes.SHA256()).hex(),
        "certificate_meta": cert_meta,
    }


def verify_pdf_signatures(pdf_bytes: bytes) -> Dict[str, Any]:
    """
    Inspect and cryptographically verify all digital signatures in a PDF document.
    Validates CMS cryptographic digest integrity, `/ByteRange` coverage, tampering detection,
    and X.509 certificate metadata.
    """
    signatures_report: List[Dict[str, Any]] = []
    try:
        reader = PdfFileReader(io.BytesIO(pdf_bytes), strict=False)
        embedded_sigs = reader.embedded_signatures
        for sig in embedded_sigs:
            field_name = sig.field_name
            sig_obj = sig.sig_object
            reason = str(sig_obj.get("/Reason", "")) if "/Reason" in sig_obj else ""
            location = str(sig_obj.get("/Location", "")) if "/Location" in sig_obj else ""
            byte_range = [int(x) for x in sig_obj.get("/ByteRange", [])] if "/ByteRange" in sig_obj else []

            signer_cert = sig.signer_cert
            subject_str = signer_cert.subject.human_friendly if signer_cert else "Unknown"
            issuer_str = signer_cert.issuer.human_friendly if signer_cert else "Unknown"
            serial_hex = hex(signer_cert.serial_number) if signer_cert else ""
            cert_sha256 = hashlib.sha256(signer_cert.dump()).hexdigest() if signer_cert else ""

            # Validate cryptographic signature integrity & byte-range coverage
            intact = False
            valid_digest = False
            coverage_level = "unknown"
            summary_text = ""
            try:
                vc = ValidationContext(
                    trust_roots=[signer_cert] if signer_cert else [],
                    allow_fetching=False,
                )
                status = validate_pdf_signature(sig, signer_validation_context=vc)
                intact = bool(status.intact)
                valid_digest = bool(status.valid)
                coverage_level = str(status.modification_level.name if status.modification_level else "ENTIRE_FILE")
                summary_text = status.summary()
            except Exception as val_err:
                summary_text = f"Validation error: {val_err}"

            # Check if bytes were appended or modified outside the signed /ByteRange
            signed_end = (byte_range[2] + byte_range[3]) if len(byte_range) == 4 else 0
            entire_file_covered = signed_end == len(pdf_bytes)
            tampered = (not intact) or (not valid_digest)

            signatures_report.append(
                {
                    "field_name": field_name,
                    "cryptographic": True,
                    "intact": intact,
                    "valid_digest": valid_digest,
                    "entire_file_covered": entire_file_covered,
                    "tampered": tampered,
                    "coverage_level": coverage_level,
                    "signer_subject": subject_str,
                    "signer_issuer": issuer_str,
                    "serial_number": serial_hex,
                    "certificate_sha256": cert_sha256,
                    "reason": reason,
                    "location": location,
                    "byte_range": byte_range,
                    "summary": summary_text,
                }
            )
    except Exception as exc:
        return {
            "has_cryptographic_signatures": False,
            "signature_count": 0,
            "signatures": [],
            "error": str(exc),
        }

    return {
        "has_cryptographic_signatures": len(signatures_report) > 0,
        "signature_count": len(signatures_report),
        "all_intact": all(s["intact"] and s["valid_digest"] for s in signatures_report) if signatures_report else False,
        "signatures": signatures_report,
    }

