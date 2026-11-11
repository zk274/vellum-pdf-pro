"""Annotation and Review Engine (Markup, Sticky Notes, Freehand Ink, Shapes, Stamps, Comment List)."""

from __future__ import annotations

import datetime
from typing import Any, Dict, List, Optional

import pymupdf

from .utils import hex_to_rgb_float, rgb_float_to_hex

STAMP_CODES: Dict[str, int] = {
    "APPROVED": 0,
    "EXPERIMENTAL": 1,
    "NOTAPPROVED": 2,
    "ASIS": 3,
    "EXPIRED": 4,
    "NOTFORPUBLICRELEASE": 5,
    "CONFIDENTIAL": 6,
    "FINAL": 7,
    "SOLD": 8,
    "DEPARTMENTAL": 9,
    "FORCOMMENT": 10,
    "TOPSECRET": 11,
    "DRAFT": 12,
    "FORPUBLICRELEASE": 13,
    "VOID": 14,
}


def _pdf_date_now() -> str:
    now = datetime.datetime.now(datetime.timezone.utc)
    return now.strftime("D:%Y%m%d%H%M%SZ")


def _iso_now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def list_annotations(pdf_bytes: bytes, page_index: Optional[int] = None) -> List[Dict[str, Any]]:
    """List all PDF annotations across the document (or on a specific page) with metadata."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    items: List[Dict[str, Any]] = []
    try:
        pages = [page_index] if (page_index is not None and 0 <= page_index < len(doc)) else range(len(doc))
        for p_idx in pages:
            page = doc[p_idx]
            annots = page.annots()
            if not annots:
                continue
            for annot in annots:
                info = annot.info or {}
                colors = annot.colors or {}
                stroke = colors.get("stroke") or colors.get("fill") or (1.0, 0.85, 0.0)
                rect = annot.rect
                a_type = annot.type[1] if isinstance(annot.type, (list, tuple)) and len(annot.type) > 1 else str(annot.type)
                items.append(
                    {
                        "xref": int(annot.xref),
                        "page_index": p_idx,
                        "page_number": p_idx + 1,
                        "type": a_type,
                        "bbox": [round(rect.x0, 2), round(rect.y0, 2), round(rect.x1, 2), round(rect.y1, 2)],
                        "content": info.get("content", ""),
                        "author": info.get("title", "") or "Reviewer",
                        "subject": info.get("subject", a_type),
                        "created_at": info.get("creationDate", ""),
                        "modified_at": info.get("modDate", ""),
                        "color": rgb_float_to_hex(tuple(stroke)),
                        "opacity": round(float(annot.opacity if annot.opacity >= 0 else 1.0), 2),
                    }
                )
        return items
    finally:
        doc.close()


def add_annotation(
    pdf_bytes: bytes,
    page_index: int,
    annot_type: str,
    bbox: List[float],
    content: str = "",
    author: str = "Linux Reviewer",
    color_hex: str = "#facc15",
    fill_hex: Optional[str] = None,
    opacity: float = 0.85,
    stroke_width: float = 2.0,
    ink_strokes: Optional[List[List[List[float]]]] = None,
    stamp_name: str = "APPROVED",
    font_size: float = 11.0,
) -> bytes:
    """
    Create a PDF annotation on `page_index` with full author, timestamp, and appearance stream.
    Supported types:
    - highlight, underline, strikeout
    - sticky_note (or text)
    - freetext (text comment callout box)
    - ink (freehand drawing)
    - rect (or square), circle (or ellipse), line, arrow
    - stamp
    """
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = doc[page_index]
        x0, y0, x1, y1 = [float(v) for v in bbox]
        rect = pymupdf.Rect(min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))
        if rect.width < 4:
            rect.x1 = rect.x0 + 24
        if rect.height < 4:
            rect.y1 = rect.y0 + 24

        rgb = hex_to_rgb_float(color_hex)
        fill_rgb = hex_to_rgb_float(fill_hex) if fill_hex else None
        kind = annot_type.lower().strip()
        annot = None

        if kind == "highlight":
            annot = page.add_highlight_annot(rect)
            annot.set_colors(stroke=rgb)
            annot.set_opacity(min(float(opacity), 0.55))
        elif kind == "underline":
            annot = page.add_underline_annot(rect)
            annot.set_colors(stroke=rgb)
            annot.set_opacity(float(opacity))
        elif kind in ("strikeout", "strikethrough"):
            annot = page.add_strikeout_annot(rect)
            annot.set_colors(stroke=rgb)
            annot.set_opacity(float(opacity))
        elif kind in ("sticky_note", "text", "note"):
            annot = page.add_text_annot(pymupdf.Point(rect.x0, rect.y0), content or "Sticky Note", icon="Note")
            annot.set_colors(stroke=rgb)
            annot.set_opacity(float(opacity))
        elif kind in ("freetext", "text_comment", "callout"):
            if rect.width < 60:
                rect.x1 = rect.x0 + 160
            if rect.height < 28:
                rect.y1 = rect.y0 + 44
            annot = page.add_freetext_annot(
                rect,
                content or "Comment",
                fontsize=float(font_size),
                fontname="helv",
                text_color=rgb,
                fill_color=fill_rgb or (1.0, 0.99, 0.88),
            )
            annot.set_border(width=max(1.0, float(stroke_width)))
            annot.set_opacity(float(opacity))
        elif kind == "ink":
            strokes: List[List[Tuple[float, float]]] = []
            if ink_strokes:
                for stroke in ink_strokes:
                    pts = [(float(pt[0]), float(pt[1])) for pt in stroke if len(pt) >= 2]
                    if len(pts) >= 2:
                        strokes.append(pts)
            if not strokes:
                strokes = [[(x0, y0), ((x0 + x1) / 2.0, y0), (x1, y1)]]
            annot = page.add_ink_annot(strokes)
            annot.set_colors(stroke=rgb)
            annot.set_border(width=float(stroke_width))
            annot.set_opacity(float(opacity))
        elif kind in ("rect", "square"):
            annot = page.add_rect_annot(rect)
            annot.set_colors(stroke=rgb, fill=fill_rgb)
            annot.set_border(width=float(stroke_width))
            annot.set_opacity(float(opacity))
        elif kind in ("circle", "ellipse"):
            annot = page.add_circle_annot(rect)
            annot.set_colors(stroke=rgb, fill=fill_rgb)
            annot.set_border(width=float(stroke_width))
            annot.set_opacity(float(opacity))
        elif kind in ("line", "arrow"):
            p1 = pymupdf.Point(x0, y0)
            p2 = pymupdf.Point(x1, y1)
            if p1 == p2:
                p2 = pymupdf.Point(x0 + 80, y0)
            annot = page.add_line_annot(p1, p2)
            annot.set_colors(stroke=rgb, fill=rgb)
            annot.set_border(width=float(stroke_width))
            if kind == "arrow":
                annot.set_line_ends(pymupdf.PDF_ANNOT_LE_NONE, pymupdf.PDF_ANNOT_LE_CLOSED_ARROW)
            annot.set_opacity(float(opacity))
        elif kind == "stamp":
            if rect.width < 80:
                rect.x1 = rect.x0 + 150
            if rect.height < 32:
                rect.y1 = rect.y0 + 48
            stamp_key = (stamp_name or content or "APPROVED").upper().replace(" ", "").replace("_", "")
            stamp_id = STAMP_CODES.get(stamp_key, 0)
            annot = page.add_stamp_annot(rect, stamp=stamp_id)
            annot.set_opacity(float(opacity))
            if not content:
                content = f"Stamp: {stamp_name}"
        else:
            raise ValueError(f"Unsupported annotation type: {annot_type}")

        if annot is not None:
            now_str = _pdf_date_now()
            annot.set_info(
                title=author or "Linux Reviewer",
                content=content,
                subject=f"{kind.upper()} ({_iso_now()})",
                creationDate=now_str,
                modDate=now_str,
            )
            annot.update()

        return doc.tobytes(garbage=2, deflate=True)
    finally:
        doc.close()


def update_annotation(
    pdf_bytes: bytes,
    page_index: int,
    xref: int,
    content: Optional[str] = None,
    author: Optional[str] = None,
    color_hex: Optional[str] = None,
    opacity: Optional[float] = None,
    new_bbox: Optional[List[float]] = None,
) -> bytes:
    """Update an existing annotation's content, author, color, opacity, or position."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = doc[page_index]
        target = None
        for annot in page.annots() or []:
            if int(annot.xref) == int(xref):
                target = annot
                break
        if target is None:
            raise KeyError(f"Annotation with xref {xref} not found on page {page_index}")

        info = target.info or {}
        if content is not None:
            info["content"] = content
        if author is not None:
            info["title"] = author
        info["modDate"] = _pdf_date_now()
        target.set_info(info)

        if color_hex:
            rgb = hex_to_rgb_float(color_hex)
            try:
                target.set_colors(stroke=rgb)
            except Exception:
                pass
        if opacity is not None:
            target.set_opacity(float(opacity))
        if new_bbox and len(new_bbox) == 4:
            target.set_rect(pymupdf.Rect(new_bbox))

        target.update()
        return doc.tobytes(garbage=2, deflate=True)
    finally:
        doc.close()


def delete_annotation(pdf_bytes: bytes, page_index: int, xref: int) -> bytes:
    """Delete an annotation by its PDF object xref."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = doc[page_index]
        for annot in list(page.annots() or []):
            if int(annot.xref) == int(xref):
                page.delete_annot(annot)
                break
        return doc.tobytes(garbage=0, deflate=True)
    finally:
        doc.close()
