"""Page Management Engine (Insert, Delete, Extract, Duplicate, Reorder, Rotate, Crop, Resize, Merge, Split)."""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import pymupdf


def parse_page_range_spec(spec: str, total_pages: int) -> List[int]:
    """
    Parse 1-based page range string like '1, 3-5, 8' into 0-based page indices.
    """
    if not spec or not spec.strip():
        return list(range(total_pages))
    indices: List[int] = []
    for part in spec.split(","):
        token = part.strip()
        if not token:
            continue
        if "-" in token:
            start_s, end_s = token.split("-", 1)
            start = max(1, int(start_s.strip()))
            end = min(total_pages, int(end_s.strip()))
            if start <= end:
                for p in range(start - 1, end):
                    if p not in indices:
                        indices.append(p)
        else:
            p = int(token) - 1
            if 0 <= p < total_pages and p not in indices:
                indices.append(p)
    return indices


def insert_blank_page(
    pdf_bytes: bytes,
    index: int = -1,
    width: Optional[float] = None,
    height: Optional[float] = None,
) -> bytes:
    """Insert a blank page at `index` (-1 appends at end). Matches existing page dimensions if omitted."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        if len(doc) > 0 and (width is None or height is None):
            ref_page = doc[min(max(0, index), len(doc) - 1)] if index >= 0 else doc[-1]
            w = float(width or ref_page.rect.width)
            h = float(height or ref_page.rect.height)
        else:
            w = float(width or 595.0)
            h = float(height or 842.0)

        doc.new_page(pno=int(index), width=w, height=h)
        return doc.tobytes(garbage=2, deflate=True)
    finally:
        doc.close()


def delete_pages(pdf_bytes: bytes, page_indices: List[int]) -> bytes:
    """Delete specified 0-based page indices (ensures at least 1 page remains)."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        total = len(doc)
        to_delete = sorted({i for i in page_indices if 0 <= i < total}, reverse=True)
        if len(to_delete) >= total:
            raise ValueError("Cannot delete all pages from a PDF document")
        for idx in to_delete:
            doc.delete_page(idx)
        return doc.tobytes(garbage=3, deflate=True)
    finally:
        doc.close()


def duplicate_page(pdf_bytes: bytes, page_index: int) -> bytes:
    """Duplicate `page_index` right after itself."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        if page_index < 0 or page_index >= len(doc):
            raise IndexError(f"Page index {page_index} out of range")
        doc.fullcopy_page(page_index, to=page_index + 1)
        return doc.tobytes(garbage=2, deflate=True)
    finally:
        doc.close()


def extract_pages(pdf_bytes: bytes, page_indices: List[int]) -> bytes:
    """Extract specified 0-based page indices into a new standalone PDF."""
    src = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    out = pymupdf.open()
    try:
        valid = [i for i in page_indices if 0 <= i < len(src)]
        if not valid:
            raise ValueError("No valid pages selected for extraction")
        for idx in valid:
            out.insert_pdf(src, from_page=idx, to_page=idx)
        return out.tobytes(garbage=3, deflate=True)
    finally:
        out.close()
        src.close()


def reorder_pages(pdf_bytes: bytes, new_order: List[int]) -> bytes:
    """Rearrange pages in the document according to `new_order` list of 0-based page indices."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        if not new_order:
            raise ValueError("new_order cannot be empty")
        valid = [i for i in new_order if 0 <= i < len(doc)]
        if not valid:
            raise ValueError("No valid page indices in new_order")
        doc.select(valid)
        return doc.tobytes(garbage=3, deflate=True)
    finally:
        doc.close()


def rotate_pages(pdf_bytes: bytes, page_indices: List[int], delta_degrees: int = 90) -> bytes:
    """Rotate specified pages by `delta_degrees` (multiple of 90)."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        for idx in page_indices:
            if 0 <= idx < len(doc):
                page = doc[idx]
                new_rot = (page.rotation + int(delta_degrees)) % 360
                page.set_rotation(new_rot)
        return doc.tobytes(garbage=2, deflate=True)
    finally:
        doc.close()


def crop_page(
    pdf_bytes: bytes,
    page_index: int,
    crop_box: Optional[List[float]] = None,
    margins: Optional[Dict[str, float]] = None,
    apply_to_all: bool = False,
) -> bytes:
    """
    Crop a page (or all pages) either to explicit `crop_box = [x0, y0, x1, y1]`
    or inset `margins = {'top': ..., 'right': ..., 'bottom': ..., 'left': ...}` in points.
    """
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        targets = list(range(len(doc))) if apply_to_all else [page_index]
        for idx in targets:
            if not (0 <= idx < len(doc)):
                continue
            page = doc[idx]
            mb = page.mediabox
            if crop_box and len(crop_box) == 4:
                rect = pymupdf.Rect(crop_box) & mb
            elif margins:
                left = float(margins.get("left", 0.0))
                top = float(margins.get("top", 0.0))
                right = float(margins.get("right", 0.0))
                bottom = float(margins.get("bottom", 0.0))
                rect = pymupdf.Rect(mb.x0 + left, mb.y0 + top, mb.x1 - right, mb.y1 - bottom)
            else:
                continue
            if rect.width < 20 or rect.height < 20:
                raise ValueError("Crop box dimensions too small")
            page.set_cropbox(rect)
        return doc.tobytes(garbage=2, deflate=True)
    finally:
        doc.close()


def resize_pages(
    pdf_bytes: bytes,
    new_width: float,
    new_height: float,
    page_indices: Optional[List[int]] = None,
    scale_content: bool = True,
) -> bytes:
    """
    Change page dimensions to (`new_width`, `new_height`) in PDF points.
    When `scale_content=True`, existing page contents, vectors, and images are scaled and centered.
    """
    src = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    out = pymupdf.open()
    try:
        targets = set(page_indices) if page_indices is not None else set(range(len(src)))
        for idx in range(len(src)):
            if idx not in targets:
                out.insert_pdf(src, from_page=idx, to_page=idx)
            else:
                if scale_content:
                    new_p = out.new_page(width=float(new_width), height=float(new_height))
                    new_p.show_pdf_page(
                        new_p.rect,
                        src,
                        idx,
                        keep_proportion=True,
                    )
                else:
                    out.insert_pdf(src, from_page=idx, to_page=idx)
                    out[-1].set_mediabox(pymupdf.Rect(0, 0, float(new_width), float(new_height)))
        return out.tobytes(garbage=3, deflate=True)
    finally:
        out.close()
        src.close()


def merge_pdfs(pdf_bytes_list: List[bytes]) -> bytes:
    """Merge multiple PDF byte streams into a single combined PDF document."""
    if not pdf_bytes_list:
        raise ValueError("No PDF documents provided to merge")
    out = pymupdf.open()
    try:
        for stream in pdf_bytes_list:
            src = pymupdf.open(stream=stream, filetype="pdf")
            try:
                out.insert_pdf(src)
            finally:
                src.close()
        return out.tobytes(garbage=3, deflate=True)
    finally:
        out.close()


def insert_pages_from_pdf(
    base_pdf_bytes: bytes,
    source_pdf_bytes: bytes,
    insert_at_index: int = -1,
    source_range: Optional[str] = None,
) -> bytes:
    """Insert pages from `source_pdf_bytes` into `base_pdf_bytes` at `insert_at_index`."""
    base_doc = pymupdf.open(stream=base_pdf_bytes, filetype="pdf")
    src_doc = pymupdf.open(stream=source_pdf_bytes, filetype="pdf")
    try:
        indices = parse_page_range_spec(source_range or "", len(src_doc))
        pos = int(insert_at_index)
        for offset, src_idx in enumerate(indices):
            target_pos = (pos + offset) if pos >= 0 else -1
            base_doc.insert_pdf(src_doc, from_page=src_idx, to_page=src_idx, start_at=target_pos)
        return base_doc.tobytes(garbage=3, deflate=True)
    finally:
        src_doc.close()
        base_doc.close()


def split_pdf(
    pdf_bytes: bytes,
    mode: str = "ranges",
    ranges_spec: str = "1",
    every_n_pages: int = 1,
) -> List[Tuple[str, bytes]]:
    """
    Split a PDF into multiple PDF documents:
    - mode == 'ranges': semicolon-separated page ranges e.g. '1-2; 3-4' or comma-separated chunks
    - mode == 'every_n': splits every N pages
    """
    src = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    results: List[Tuple[str, bytes]] = []
    try:
        total = len(src)
        if mode == "every_n":
            step = max(1, int(every_n_pages))
            for start in range(0, total, step):
                end = min(total - 1, start + step - 1)
                part = pymupdf.open()
                part.insert_pdf(src, from_page=start, to_page=end)
                results.append((f"pages_{start+1}_to_{end+1}.pdf", part.tobytes(garbage=3, deflate=True)))
                part.close()
        else:
            groups = [g.strip() for g in ranges_spec.replace(";", "|").split("|") if g.strip()]
            if len(groups) == 1 and "," in groups[0]:
                groups = [g.strip() for g in groups[0].split(",") if g.strip()]
            for g_idx, grp in enumerate(groups):
                indices = parse_page_range_spec(grp, total)
                if not indices:
                    continue
                part = pymupdf.open()
                for idx in indices:
                    part.insert_pdf(src, from_page=idx, to_page=idx)
                label = grp.replace(" ", "").replace(",", "_")
                results.append((f"split_{g_idx+1}_pages_{label}.pdf", part.tobytes(garbage=3, deflate=True)))
                part.close()
        return results
    finally:
        src.close()

