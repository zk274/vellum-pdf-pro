"""Direct PDF Content Editing Engine (text, images, vector shapes, hyperlinks).

Coordinate convention
---------------------
Every public function in this module accepts and returns **display-space**
coordinates (PDF points, top-left origin, page rotation applied) — i.e. exactly
what the user sees on the rendered page. Conversion to PyMuPDF's unrotated page
space happens internally.

Text editing strategy (in order of preference)
----------------------------------------------
1. ``original_font``: remove only the target glyphs from the content stream, then
   write the new text with the *original font resource* by re-encoding each
   character into the font's own character codes (using the ToUnicode CMap /
   WinAnsi encoding) and verifying every glyph is present in the (possibly
   subsetted) embedded font. This is a true, lossless content-stream edit.
2. ``substitute_font``: if the original font cannot render the new characters
   (subset font missing glyphs, Type3 font, custom encodings, user picked another
   font), the glyphs are still removed from the stream (no white-out box) and the
   new text is written with a metric-compatible standard/system font. The result
   carries ``fallback_used=True`` and a human-readable reason for the UI.
"""

from __future__ import annotations

import base64
import io
import json
import math
import random
import re
import time
from typing import Any, Dict, List, Optional, Set, Tuple

import pymupdf
from PIL import Image

from .utils import (
    hex_to_rgb_float,
    int_color_to_hex,
    point_to_display,
    point_to_pdf,
    rect_to_display,
    rect_to_pdf,
    resolve_pdf_font,
)

ALIGN_MAP = {
    "left": pymupdf.TEXT_ALIGN_LEFT,
    "center": pymupdf.TEXT_ALIGN_CENTER,
    "right": pymupdf.TEXT_ALIGN_RIGHT,
    "justify": pymupdf.TEXT_ALIGN_JUSTIFY,
}


def _strip_subset(name: str) -> str:
    return re.sub(r"^[A-Z]{6}\+", "", name or "")


def _norm_font_key(name: str) -> str:
    base = _strip_subset(name).lower()
    for suffix in ("psmt", "mt", "book", "regular", "roman", "ps"):
        if base.endswith("-" + suffix):
            base = base[: -(len(suffix) + 1)]
        elif base.endswith(" " + suffix):
            base = base[: -(len(suffix) + 1)]
    return re.sub(r"[^a-z0-9]", "", base)


def _page_font_catalog(doc: "pymupdf.Document", page: "pymupdf.Page") -> List[Dict[str, Any]]:
    """Build a rich catalog of fonts on `page`, including DescendantFont BaseFont names."""
    catalog: List[Dict[str, Any]] = []
    for f in page.get_fonts(full=True):
        xref, ext, ftype, basefont, refname, encoding = int(f[0]), f[1], f[2], f[3] or "", f[4] or "", f[5] or ""
        is_emb = bool(ext and ext != "n/a")
        is_sub = "+" in basefont
        aliases = {basefont, _strip_subset(basefont), _norm_font_key(basefont)}
        if xref > 0:
            try:
                obj_str = doc.xref_object(xref, compressed=True)
                for m in re.findall(r"/BaseFont\s*/([^\s/>]+)", obj_str):
                    clean_m = m.replace("#20", " ")
                    if "+" in clean_m:
                        is_sub = True
                    aliases.update({clean_m, _strip_subset(clean_m), _norm_font_key(clean_m)})
                desc = re.search(r"/DescendantFonts\s*\[\s*(\d+)\s+0\s+R", obj_str)
                if desc:
                    d_obj = doc.xref_object(int(desc.group(1)), compressed=True)
                    for m in re.findall(r"/BaseFont\s*/([^\s/>]+)", d_obj):
                        clean_m = m.replace("#20", " ")
                        if "+" in clean_m:
                            is_sub = True
                        aliases.update({clean_m, _strip_subset(clean_m), _norm_font_key(clean_m)})
            except Exception:
                pass
        # Also check if embedded TTF has a small subset of glyphs
        if is_emb and not is_sub and ext in ("ttf", "otf"):
            try:
                from fontTools.ttLib import TTFont

                _, _, _, content = doc.extract_font(xref)
                if content:
                    tt = TTFont(io.BytesIO(content))
                    if "glyf" in tt:
                        glyf = tt["glyf"]
                        order = tt.getGlyphOrder()
                        non_empty = sum(
                            1 for g in order if g in glyf and (glyf[g].numberOfContours != 0 or g in ("space", ".notdef"))
                        )
                        if len(order) > 50 and non_empty < len(order) * 0.5:
                            is_sub = True
            except Exception:
                pass

        catalog.append(
            {
                "xref": xref,
                "ext": ext,
                "ftype": ftype,
                "basefont": basefont,
                "refname": refname,
                "encoding": encoding,
                "embedded": is_emb,
                "subset": is_sub,
                "aliases": {a for a in aliases if a},
            }
        )
    return catalog


def _match_font_in_catalog(catalog: List[Dict[str, Any]], span_font: str) -> Optional[Dict[str, Any]]:
    if not span_font:
        return None
    raw = span_font.strip()
    stripped = _strip_subset(raw)
    norm = _norm_font_key(raw)
    for entry in catalog:
        if raw in entry["aliases"] or stripped in entry["aliases"] or (norm and norm in entry["aliases"]):
            return entry
    # Prefix match on normalized font name (e.g. "dejavusans" matching "dejavusansbook")
    if norm:
        for entry in catalog:
            for al in entry["aliases"]:
                if al.startswith(norm) or norm.startswith(al):
                    return entry
    return None


# ---------------------------------------------------------------------------
# Inspection & Vellum Object Metadata Persistence
# ---------------------------------------------------------------------------


def _get_page_vellum_data(doc: pymupdf.Document, page: pymupdf.Page) -> Dict[str, Any]:
    """Retrieve application-managed private object records from page dictionary."""
    try:
        kind, raw = doc.xref_get_key(page.xref, "VellumData")
        if kind == "string" and raw:
            clean = raw
            if clean.startswith("(") and clean.endswith(")"):
                clean = clean[1:-1]
            return json.loads(clean)
    except Exception:
        pass
    return {"boxes": [], "shapes": []}


def _set_page_vellum_data(doc: pymupdf.Document, page: pymupdf.Page, data: Dict[str, Any]) -> None:
    """Store application-managed private object records into page dictionary."""
    try:
        serialized = json.dumps(data)
        doc.xref_set_key(page.xref, "VellumData", pymupdf.get_pdf_str(serialized))
    except Exception:
        pass


def inspect_page_objects(pdf_bytes: bytes, page_index: int = 0) -> Dict[str, Any]:
    """Return all editable objects on a page in display coordinates."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        if page_index < 0 or page_index >= len(doc):
            raise IndexError(f"Page index {page_index} out of range (0..{len(doc)-1})")
        page = doc[page_index]
        catalog = _page_font_catalog(doc, page)

        text_dict = page.get_text("dict", flags=pymupdf.TEXTFLAGS_DICT & ~pymupdf.TEXT_DEHYPHENATE)
        text_spans: List[Dict[str, Any]] = []
        text_blocks: List[Dict[str, Any]] = []
        counter = 0
        for b_idx, block in enumerate(text_dict.get("blocks", [])):
            if block.get("type") != 0:
                continue
            block_lines: List[str] = []
            block_ids: List[str] = []
            for l_idx, line in enumerate(block.get("lines", [])):
                horizontal = abs(line.get("dir", (1, 0))[1]) < 1e-3
                parts: List[str] = []
                for s_idx, span in enumerate(line.get("spans", [])):
                    txt = span.get("text", "")
                    if not txt.strip():
                        continue
                    sid = f"span_{page_index}_{b_idx}_{l_idx}_{s_idx}_{counter}"
                    counter += 1
                    font = span.get("font", "Helvetica")
                    flags = int(span.get("flags", 0))
                    low = font.lower()
                    is_mono = bool(flags & 8) or "mono" in low or "cour" in low
                    is_serif = (bool(flags & 4) and "sans" not in low) or "times" in low or "serif" in low
                    matched_f = _match_font_in_catalog(catalog, font)
                    emb = bool(matched_f["embedded"]) if matched_f else False
                    subset = bool(matched_f["subset"] or "+" in font) if matched_f else ("+" in font)
                    text_spans.append(
                        {
                            "id": sid,
                            "block_index": b_idx,
                            "line_index": l_idx,
                            "span_index": s_idx,
                            "text": txt,
                            "bbox": rect_to_display(page, span["bbox"]),
                            "origin": point_to_display(page, span.get("origin", span["bbox"][:2])),
                            "font": font,
                            "family": "mono" if is_mono else ("serif" if is_serif else "sans"),
                            "size": round(float(span.get("size", 12.0)), 2),
                            "color": int_color_to_hex(span.get("color", 0)),
                            "bold": bool(flags & 16) or "bold" in low,
                            "italic": bool(flags & 2) or "italic" in low or "oblique" in low,
                            "is_embedded_font": emb,
                            "is_subset_font": subset,
                            "can_edit_losslessly": not subset,
                            "horizontal": horizontal,
                        }
                    )
                    block_ids.append(sid)
                    parts.append(txt)
                if parts:
                    block_lines.append("".join(parts))
            if block_lines:
                text_blocks.append(
                    {
                        "id": f"block_{page_index}_{b_idx}",
                        "block_index": b_idx,
                        "bbox": rect_to_display(page, block["bbox"]),
                        "text": "\n".join(block_lines),
                        "span_ids": block_ids,
                    }
                )

        images: List[Dict[str, Any]] = []
        for i_idx, info in enumerate(page.get_image_info(xrefs=True)):
            xref = int(info.get("xref", 0))
            w, h = int(info.get("width", 0)), int(info.get("height", 0))
            if w <= 1 and h <= 1:  # placeholder left by delete_image
                continue
            thumb = None
            if xref > 0:
                try:
                    pix = pymupdf.Pixmap(doc, xref)
                    if pix.alpha or pix.n > 3:
                        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
                    img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
                    img.thumbnail((160, 160))
                    buf = io.BytesIO()
                    img.save(buf, format="PNG")
                    thumb = base64.b64encode(buf.getvalue()).decode("ascii")
                except Exception:
                    thumb = None
            images.append(
                {
                    "id": f"img_{page_index}_{i_idx}_{xref}",
                    "image_index": i_idx,
                    "xref": xref,
                    "bbox": rect_to_display(page, info.get("bbox", (0, 0, 0, 0))),
                    "width": w,
                    "height": h,
                    "colorspace": str(info.get("cs-name", "")),
                    "bpc": int(info.get("bpc", 8)),
                    "thumbnail_base64": thumb,
                }
            )

        links: List[Dict[str, Any]] = []
        for l_idx, link in enumerate(page.get_links()):
            links.append(
                {
                    "id": f"link_{page_index}_{l_idx}",
                    "link_index": l_idx,
                    "kind": int(link.get("kind", 0)),
                    "uri": link.get("uri", "") or "",
                    "target_page": int(link.get("page", -1)) if link.get("page") is not None else -1,
                    "bbox": rect_to_display(page, link["from"]),
                }
            )

        v_data = _get_page_vellum_data(doc, page)

        return {
            "page_index": page_index,
            "width": round(page.rect.width, 2),
            "height": round(page.rect.height, 2),
            "rotation": page.rotation,
            "text_spans": text_spans,
            "text_blocks": text_blocks,
            "images": images,
            "links": links,
            "vector_drawings_count": len(page.get_drawings()),
            "vellum_boxes": v_data.get("boxes", []),
            "vellum_shapes": v_data.get("shapes", []),
        }
    finally:
        doc.close()


# ---------------------------------------------------------------------------
# Original-font re-encoding
# ---------------------------------------------------------------------------


def _parse_hex(h: str) -> int:
    return int(h, 16)


def _parse_tounicode(cmap: bytes) -> Tuple[Dict[str, int], int]:
    """Parse a ToUnicode CMap -> (unicode string -> code, code byte length)."""
    text = cmap.decode("latin-1", errors="ignore")
    inv: Dict[str, int] = {}
    code_len = 1

    def decode_uni(hexstr: str) -> str:
        h = hexstr.strip()
        if not h:
            return ""
        try:
            if len(h) <= 6:
                cp = int(h, 16)
                if 0 < cp <= 0x10FFFF and not (0xD800 <= cp <= 0xDFFF):
                    return chr(cp)
            if len(h) % 2 == 1:
                h = "0" + h
            return bytes.fromhex(h).decode("utf-16-be")
        except Exception:
            return ""

    for block in re.findall(r"beginbfchar(.*?)endbfchar", text, re.S):
        for src, dst in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>", block):
            code_len = max(code_len, (len(src) + 1) // 2)
            uni = decode_uni(dst)
            if uni:
                inv.setdefault(uni, _parse_hex(src))
    for block in re.findall(r"beginbfrange(.*?)endbfrange", text, re.S):
        for lo, hi, rest in re.findall(r"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(\[[^\]]*\]|<[0-9A-Fa-f]*>)", block):
            code_len = max(code_len, (len(lo) + 1) // 2)
            a, b = _parse_hex(lo), _parse_hex(hi)
            if rest.startswith("["):
                for i, dst in enumerate(re.findall(r"<([0-9A-Fa-f]*)>", rest)):
                    uni = decode_uni(dst)
                    if uni and a + i <= b:
                        inv.setdefault(uni, a + i)
            else:
                dst_hex = rest.strip("<>").strip()
                if not dst_hex:
                    continue
                try:
                    start_cp = int(dst_hex, 16)
                except ValueError:
                    continue
                for i in range(0, min(b - a, 65535) + 1):
                    cp = start_cp + i
                    if 0 < cp <= 0x10FFFF and not (0xD800 <= cp <= 0xDFFF):
                        inv.setdefault(chr(cp), a + i)
    return inv, code_len


def _find_font(doc: "pymupdf.Document", page: "pymupdf.Page", span_font: str) -> Optional[Dict[str, Any]]:
    """Locate the font resource used by a span using the page font catalog."""
    catalog = _page_font_catalog(doc, page)
    return _match_font_in_catalog(catalog, span_font)


def _glyph_inventory(doc: "pymupdf.Document", page_index: int, span_font: str, needed: Set[str]) -> Set[str]:
    """Characters already drawn with this font (=> glyph guaranteed present in subset)."""
    inv: Set[str] = set()
    target_norm = _norm_font_key(span_font)
    order = [page_index] + [i for i in range(len(doc)) if i != page_index][:40]
    for idx in order:
        for span in doc[idx].get_texttrace():
            sf = span.get("font") or ""
            if sf == span_font or _norm_font_key(sf) == target_norm:
                for ch in span.get("chars", ()):
                    if ch[0] > 0:
                        inv.add(chr(ch[0]))
        if needed <= inv:
            break
    return inv


def _embedded_ttf_has_gids(doc: "pymupdf.Document", font_xref: int, gids: Set[int]) -> Optional[Set[int]]:
    """Return subset of `gids` that have non-empty outlines in the embedded TrueType font, or None if not inspectable."""
    try:
        from fontTools.ttLib import TTFont

        _, ext, _, content = doc.extract_font(font_xref)
        if not content or ext not in ("ttf", "otf"):
            return None
        tt = TTFont(io.BytesIO(content))
        if "glyf" not in tt:
            return None
        order = tt.getGlyphOrder()
        glyf = tt["glyf"]
        present: Set[int] = set()
        for gid in gids:
            if 0 < gid < len(order):
                gname = order[gid]
                if gname in glyf:
                    g_obj = glyf[gname]
                    if g_obj.numberOfContours != 0 or g_obj.isComposite() or gname in ("space", "uni00A0"):
                        present.add(gid)
        return present
    except Exception:
        return None


def _encode_with_original_font(
    doc: "pymupdf.Document",
    page_index: int,
    span_font: str,
    text: str,
) -> Tuple[Optional[Dict[str, Any]], str]:
    """Return ({refname, xref, hex}, "") or (None, reason)."""
    page = doc[page_index]
    found = _find_font(doc, page, span_font)
    if not found:
        if "+" in (span_font or ""):
            return None, f"Original PDF font '{span_font}' is an embedded subset font; substituted metric-compatible font."
        return None, f"Font resource for '{span_font}' not found on page."
    xref = found["xref"]
    refname = found["refname"]
    ftype = found["ftype"]
    encoding = found["encoding"]
    embedded = found["embedded"]
    if ftype == "Type3":
        return None, f"'{span_font}' is a Type3 (glyph procedure) font; re-encoding is not supported."

    font_obj = doc.xref_object(xref, compressed=True)
    inv_map: Dict[str, int] = {}
    code_len = 2 if ftype == "Type0" else 1
    tu = doc.xref_get_key(xref, "ToUnicode")
    if tu[0] == "xref":
        try:
            inv_map, code_len = _parse_tounicode(doc.xref_stream(int(tu[1].split()[0])))
        except Exception:
            inv_map = {}
    if ftype == "Type0":
        if "Identity-H" not in encoding and "/Identity-H" not in font_obj:
            return None, f"'{span_font}' uses a non-identity CMap ({encoding}); cannot re-encode safely."
        code_len = 2
    elif not inv_map:
        if "/Differences" in font_obj:
            return None, f"'{span_font}' uses a custom /Differences encoding without ToUnicode map."
        # Standard WinAnsi / StandardEncoding simple font
        for ch in set(text):
            try:
                inv_map[ch] = ch.encode("cp1252")[0]
            except Exception:
                return None, f"Character '{ch}' is not encodable in '{span_font}' ({encoding or 'standard'} encoding)."

    missing_code = sorted({c for c in text if c not in inv_map})
    if missing_code:
        return None, (
            f"Embedded font '{span_font}' has no character code for: "
            + " ".join(repr(c) for c in missing_code[:12])
        )

    if embedded:
        needed = {c for c in text if c != " "}
        have = _glyph_inventory(doc, page_index, span_font, needed)
        still_unchecked = needed - have
        if still_unchecked:
            # Inspect the embedded TTF glyf table directly to see if the outlines exist in the font binary
            needed_gids = {inv_map[c] for c in still_unchecked}
            present_gids = _embedded_ttf_has_gids(doc, xref, needed_gids)
            if present_gids is not None:
                for c in list(still_unchecked):
                    if inv_map[c] in present_gids:
                        have.add(c)
        missing = sorted(needed - have)
        if missing:
            return None, (
                f"Embedded subset font '{span_font}' does not contain glyphs for: "
                + " ".join(repr(c) for c in missing[:12])
            )

    hex_codes = "".join(f"{inv_map[c]:0{code_len * 2}X}" for c in text)
    return {"refname": refname, "xref": xref, "hex": hex_codes}, ""


def _append_content(doc: "pymupdf.Document", page: "pymupdf.Page", data: bytes) -> None:
    page.wrap_contents()
    new_xref = doc.get_new_xref()
    doc.update_object(new_xref, "<<>>")
    doc.update_stream(new_xref, data)
    contents = page.get_contents() + [new_xref]
    doc.xref_set_key(page.xref, "Contents", "[" + " ".join(f"{x} 0 R" for x in contents) + "]")


def _ensure_font_resource(doc: "pymupdf.Document", page: "pymupdf.Page", refname: str, font_xref: int) -> None:
    if any(f[4] == refname for f in page.get_fonts(full=True)):
        return
    res = doc.xref_get_key(page.xref, "Resources")
    if res[0] == "xref":
        res_xref = int(res[1].split()[0])
        doc.xref_set_key(res_xref, f"Font/{refname}", f"{font_xref} 0 R")
    else:
        doc.xref_set_key(page.xref, f"Resources/Font/{refname}", f"{font_xref} 0 R")


def _write_original_font_lines(
    doc: "pymupdf.Document",
    page: "pymupdf.Page",
    lines: List[Dict[str, Any]],
    refname: str,
    font_xref: int,
    size: float,
    rgb: Tuple[float, float, float],
    line_dir: Tuple[float, float] = (1.0, 0.0),
) -> None:
    """Write pre-encoded lines at PyMuPDF (unrotated, top-left) baseline points."""
    _ensure_font_resource(doc, page, refname, font_xref)
    to_pdf = ~page.transformation_matrix
    dx, dy = float(line_dir[0]), float(line_dir[1])
    ops = [f"q BT /{refname} {size:.3f} Tf {rgb[0]:.4f} {rgb[1]:.4f} {rgb[2]:.4f} rg"]
    for ln in lines:
        p = pymupdf.Point(ln["origin"]) * to_pdf
        ops.append(f"{dx:.4f} {-dy:.4f} {dy:.4f} {dx:.4f} {p.x:.3f} {p.y:.3f} Tm <{ln['hex']}> Tj")
    ops.append("ET Q\n")
    _append_content(doc, page, " ".join(ops).encode("latin-1"))


# ---------------------------------------------------------------------------
# Text editing
# ---------------------------------------------------------------------------


def _detect_span_dir(page: "pymupdf.Page", pdf_rect: "pymupdf.Rect") -> Tuple[float, float]:
    """Find the dominant baseline direction (dx, dy) for the text span inside pdf_rect."""
    best_overlap = 0.0
    best_dir: Tuple[float, float] = (1.0, 0.0)
    try:
        for b in page.get_text("dict", flags=pymupdf.TEXTFLAGS_TEXT).get("blocks", []):
            if b.get("type") != 0:
                continue
            for line in b.get("lines", []):
                ldir = line.get("dir", (1.0, 0.0))
                for sp in line.get("spans", []):
                    srect = pymupdf.Rect(sp["bbox"])
                    inter = srect & pdf_rect
                    if not inter.is_empty:
                        area = inter.width * inter.height
                        if area > best_overlap:
                            best_overlap = area
                            best_dir = (float(ldir[0]), float(ldir[1]))
    except Exception:
        pass
    return best_dir


def _dir_to_rotate_angle(line_dir: Tuple[float, float]) -> int:
    dx, dy = line_dir
    if abs(dx) >= abs(dy):
        return 0 if dx >= 0 else 180
    return 90 if dy < 0 else 270


def _remove_glyphs(
    page: "pymupdf.Page",
    pdf_rect: "pymupdf.Rect",
    line_dir: Tuple[float, float] = (1.0, 0.0),
) -> None:
    """Remove only text glyphs inside rect (no fill, images and vector art untouched).

    Uses a tight mid-x-height band (44%-56% across the line-height axis) so that
    tightly spaced lines above/below (even at 10.5pt leading on 12pt text) and
    0-gap horizontal neighbor spans are never intersected or erased.
    """
    r = pymupdf.Rect(pdf_rect)
    dx, dy = line_dir
    if abs(dx) >= abs(dy):
        inset_x = min(0.6, r.width * 0.12)
        y_top = r.y0 + r.height * 0.44
        y_bot = r.y0 + r.height * 0.56
        if y_bot <= y_top:
            y_top, y_bot = r.y0 + r.height * 0.25, r.y1 - r.height * 0.25
        target = pymupdf.Rect(r.x0 + inset_x, y_top, r.x1 - inset_x, y_bot)
    else:
        inset_y = min(0.6, r.height * 0.12)
        x_left = r.x0 + r.width * 0.44
        x_right = r.x0 + r.width * 0.56
        if x_right <= x_left:
            x_left, x_right = r.x0 + r.width * 0.25, r.x1 - r.width * 0.25
        target = pymupdf.Rect(x_left, r.y0 + inset_y, x_right, r.y1 - inset_y)
    if target.is_empty:
        target = r
    page.add_redact_annot(target, fill=False)
    page.apply_redactions(
        images=pymupdf.PDF_REDACT_IMAGE_NONE,
        graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
        text=pymupdf.PDF_REDACT_TEXT_REMOVE,
    )


def edit_text_span(
    pdf_bytes: bytes,
    page_index: int,
    orig_bbox: List[float],
    new_text: str,
    orig_origin: Optional[List[float]] = None,
    new_bbox: Optional[List[float]] = None,
    font_name: Optional[str] = None,
    original_font: Optional[str] = None,
    font_size: float = 12.0,
    color_hex: str = "#000000",
    bold: bool = False,
    italic: bool = False,
    align: str = "left",
    line_height: float = 1.2,
    keep_original_font: bool = True,
) -> Dict[str, Any]:
    """Edit, move or delete an existing text span (all coordinates in display space)."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = doc[page_index]
        pdf_rect = pymupdf.Rect(rect_to_pdf(page, orig_bbox))
        line_dir = _detect_span_dir(page, pdf_rect)
        text_rot = _dir_to_rotate_angle(line_dir)
        if orig_origin and len(orig_origin) == 2:
            pdf_origin = pymupdf.Point(point_to_pdf(page, orig_origin))
        else:
            pdf_origin = pymupdf.Point(pdf_rect.x0, pdf_rect.y1 - pdf_rect.height * 0.22)

        # Translation (in unrotated page space) if the block was moved in the UI
        delta = pymupdf.Point(0, 0)
        moved = False
        if new_bbox and len(new_bbox) == 4:
            a = pymupdf.Point(point_to_pdf(page, orig_bbox[:2]))
            b = pymupdf.Point(point_to_pdf(page, new_bbox[:2]))
            delta = b - a
            moved = abs(delta.x) > 0.5 or abs(delta.y) > 0.5

        rgb = hex_to_rgb_float(color_hex)
        lines = new_text.split("\n") if new_text else []
        method = "deleted" if not new_text else ""
        fallback_used = False
        fallback_reason = ""
        applied_font = original_font or font_name or "helv"

        # Pre-compute original-font encoding BEFORE removing the glyphs (inventory needs them)
        encoded_lines: Optional[List[Dict[str, Any]]] = None
        enc_meta: Dict[str, Any] = {}
        if new_text and keep_original_font and original_font and align in ("left", ""):
            encoded_lines = []
            for i, ln in enumerate(lines):
                if not ln:
                    encoded_lines.append({"hex": "", "line": i})
                    continue
                enc, reason = _encode_with_original_font(doc, page_index, original_font, ln)
                if enc is None:
                    encoded_lines = None
                    fallback_reason = reason
                    break
                enc_meta = enc
                encoded_lines.append({"hex": enc["hex"], "line": i})
        elif new_text and keep_original_font and align not in ("left", ""):
            fallback_reason = f"'{align}' alignment requires re-flowing text; used a standard font."
        elif new_text and not keep_original_font:
            fallback_reason = "Font family/style changed by user; standard font applied."

        # Capture any link annotations intersecting pdf_rect before _remove_glyphs removes them
        affected_links: List[Dict[str, Any]] = []
        try:
            for lk in page.get_links():
                lk_rect = pymupdf.Rect(lk["from"])
                if lk_rect.intersects(pdf_rect) or (abs(lk_rect.x0 - pdf_rect.x0) < 15 and abs(lk_rect.y0 - pdf_rect.y0) < 15):
                    affected_links.append(dict(lk))
        except Exception:
            affected_links = []

        _remove_glyphs(page, pdf_rect, line_dir=line_dir)

        if new_text:
            base = pdf_origin + delta
            step = font_size * line_height
            perp_x, perp_y = -line_dir[1], line_dir[0]
            if encoded_lines is not None and enc_meta:
                payload = [
                    {
                        "origin": (
                            base.x + e["line"] * step * perp_x,
                            base.y + e["line"] * step * perp_y,
                        ),
                        "hex": e["hex"],
                    }
                    for e in encoded_lines
                    if e["hex"]
                ]
                _write_original_font_lines(
                    doc,
                    page,
                    payload,
                    enc_meta["refname"],
                    enc_meta["xref"],
                    font_size,
                    rgb,
                    line_dir=line_dir,
                )
                method = "original_font"
                applied_font = original_font
            else:
                fallback_used = bool(keep_original_font)  # user-requested changes are not "fallbacks"
                info = resolve_pdf_font(font_name or original_font, bold=bold, italic=italic, text_content=new_text)
                applied_font = info["base14"] if not info["fontfile"] else info["fontfile"].rsplit("/", 1)[-1]
                method = "substitute_font"
                if align in ("left", ""):
                    for i, ln in enumerate(lines):
                        if ln:
                            page.insert_text(
                                pymupdf.Point(base.x + i * step * perp_x, base.y + i * step * perp_y),
                                ln,
                                fontsize=font_size,
                                fontname=info["fontname"],
                                fontfile=info["fontfile"],
                                color=rgb,
                                rotate=text_rot,
                            )
                else:
                    width = max(pdf_rect.width, 40)
                    box = pymupdf.Rect(
                        pdf_rect.x0 + delta.x,
                        pdf_rect.y0 + delta.y,
                        pdf_rect.x0 + delta.x + width,
                        pdf_rect.y0 + delta.y + font_size * line_height * (len(lines) + 1) + 4,
                    )
                    page.insert_textbox(
                        box,
                        new_text,
                        fontsize=font_size,
                        fontname=info["fontname"],
                        fontfile=info["fontfile"],
                        color=rgb,
                        align=ALIGN_MAP.get(align, 0),
                        lineheight=line_height,
                        rotate=text_rot,
                    )
                if fallback_used and not fallback_reason:
                    fallback_reason = "Original font could not be reused; standard font substituted."

            # Restore or reposition affected link annotations
            if affected_links:
                for lk in affected_links:
                    try:
                        old_from = pymupdf.Rect(lk["from"])
                        new_from = pymupdf.Rect(
                            old_from.x0 + delta.x,
                            old_from.y0 + delta.y,
                            old_from.x1 + delta.x,
                            old_from.y1 + delta.y,
                        )
                        lk_data: Dict[str, Any] = {"kind": lk.get("kind", pymupdf.LINK_URI), "from": new_from}
                        if lk.get("uri"):
                            lk_data["uri"] = lk["uri"]
                        elif lk.get("page") is not None and lk.get("page") >= 0:
                            lk_data["page"] = lk["page"]
                        page.insert_link(lk_data)
                    except Exception:
                        pass

        out = doc.tobytes(garbage=1, deflate=True)
        return {
            "pdf_bytes": out,
            "edit_method": "direct_content_stream",
            "font_strategy": method,
            "moved": moved,
            "whiteout_used": False,
            "fallback_used": fallback_used,
            "fallback_reason": fallback_reason if fallback_used or method == "substitute_font" else "",
            "applied_font": applied_font,
        }
    finally:
        doc.close()


def add_text_object(
    pdf_bytes: bytes,
    page_index: int,
    text: str,
    bbox: List[float],
    font_name: str = "helv",
    font_size: float = 12.0,
    color_hex: str = "#000000",
    bold: bool = False,
    italic: bool = False,
    align: str = "left",
    background_hex: Optional[str] = None,
    border_hex: Optional[str] = None,
    border_width: float = 0.0,
    object_id: Optional[str] = None,
) -> bytes:
    """Insert a new upright text block (display-space bbox) into the page content stream."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = doc[page_index]
        d = pymupdf.Rect(bbox)
        if d.width < 20:
            d.x1 = d.x0 + 200
        if d.height < font_size * 1.4:
            d.y1 = d.y0 + max(font_size * 2.0, font_size * 1.3 * (text.count("\n") + 1) + 8)
        rect = pymupdf.Rect(rect_to_pdf(page, d))

        if background_hex or (border_hex and border_width > 0):
            page.draw_rect(
                rect,
                color=hex_to_rgb_float(border_hex) if (border_hex and border_width > 0) else None,
                fill=hex_to_rgb_float(background_hex) if background_hex else None,
                width=float(border_width) if border_width else 0,
            )

        info = resolve_pdf_font(font_name, bold=bold, italic=italic, text_content=text)
        rgb = hex_to_rgb_float(color_hex)
        pad = 4.0 if (background_hex or (border_hex and border_width > 0)) else 1.0

        d_inner = pymupdf.Rect(
            d.x0 + pad,
            d.y0 + pad,
            max(d.x0 + pad + 10, d.x1 - pad),
            max(d.y0 + pad + 10, d.y1 - pad),
        )
        inner = pymupdf.Rect(rect_to_pdf(page, d_inner))
        align_code = ALIGN_MAP.get(align, pymupdf.TEXT_ALIGN_LEFT)

        rc = page.insert_textbox(
            inner,
            text,
            fontsize=float(font_size),
            fontname=info["fontname"],
            fontfile=info["fontfile"],
            color=rgb,
            align=align_code,
            rotate=page.rotation,
        )

        final_bbox = [round(float(v), 2) for v in bbox]

        # If text overflowed the designated box height, expand downward to accommodate full wrapped text
        if rc < 0:
            overflow_h = max(abs(rc), font_size * 2.0)
            d_expanded = pymupdf.Rect(d.x0, d.y0, d.x1, d.y1 + overflow_h + 12)
            d_inner_exp = pymupdf.Rect(
                d_expanded.x0 + pad,
                d_expanded.y0 + pad,
                max(d_expanded.x0 + pad + 10, d_expanded.x1 - pad),
                max(d_expanded.y0 + pad + 10, d_expanded.y1 - pad),
            )
            inner_exp = pymupdf.Rect(rect_to_pdf(page, d_inner_exp))
            page.insert_textbox(
                inner_exp,
                text,
                fontsize=float(font_size),
                fontname=info["fontname"],
                fontfile=info["fontfile"],
                color=rgb,
                align=align_code,
                rotate=page.rotation,
            )
            final_bbox = [round(float(d_expanded.x0), 2), round(float(d_expanded.y0), 2), round(float(d_expanded.x1), 2), round(float(d_expanded.y1), 2)]

        # Persist Vellum Text Box metadata into page dictionary
        v_data = _get_page_vellum_data(doc, page)
        box_id = object_id or f"vbox_{int(time.time() * 1000)}_{random.randint(100, 999)}"
        box_record = {
            "id": box_id,
            "type": "textbox",
            "text": text,
            "bbox": final_bbox,
            "font": font_name,
            "size": round(float(font_size), 2),
            "color": color_hex,
            "bold": bold,
            "italic": italic,
            "align": align,
            "background_hex": background_hex,
            "border_hex": border_hex,
            "border_width": border_width,
        }
        existing_idx = next((i for i, b in enumerate(v_data.get("boxes", [])) if b.get("id") == box_id), None)
        if existing_idx is not None:
            v_data["boxes"][existing_idx] = box_record
        else:
            v_data.setdefault("boxes", []).append(box_record)
        _set_page_vellum_data(doc, page, v_data)

        return doc.tobytes(garbage=1, deflate=True)
    finally:
        doc.close()


# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------


def insert_image_object(
    pdf_bytes: bytes,
    page_index: int,
    image_bytes: bytes,
    bbox: List[float],
    rotation: int = 0,
    keep_proportion: bool = False,
) -> bytes:
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = doc[page_index]
        page.insert_image(
            pymupdf.Rect(rect_to_pdf(page, bbox)),
            stream=image_bytes,
            rotate=(int(rotation) + page.rotation) % 360,
            keep_proportion=keep_proportion,
        )
        return doc.tobytes(garbage=1, deflate=True)
    finally:
        doc.close()


def _image_bytes(doc: "pymupdf.Document", xref: int) -> bytes:
    """Extract an image (including soft mask) as PNG bytes."""
    pix = pymupdf.Pixmap(doc, xref)
    smask = doc.xref_get_key(xref, "SMask")
    if smask[0] == "xref":
        try:
            mask = pymupdf.Pixmap(doc, int(smask[1].split()[0]))
            pix = pymupdf.Pixmap(pix, mask)
        except Exception:
            pass
    if pix.n - pix.alpha > 3:
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    return pix.tobytes("png")


def edit_image_object(
    pdf_bytes: bytes,
    page_index: int,
    xref: int,
    action: str,
    orig_bbox: Optional[List[float]] = None,
    new_bbox: Optional[List[float]] = None,
    rotation: int = 0,
    crop_ratios: Optional[List[float]] = None,
    replacement_image_bytes: Optional[bytes] = None,
) -> bytes:
    """delete | replace | transform (move / resize / rotate / crop) an image."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = doc[page_index]
        if action == "delete":
            if xref > 0:
                page.delete_image(xref)
            elif orig_bbox:
                page.add_redact_annot(pymupdf.Rect(rect_to_pdf(page, orig_bbox)), fill=False)
                page.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_REMOVE, graphics=0, text=1)
            return doc.tobytes(garbage=3, deflate=True)

        if action == "replace":
            if not replacement_image_bytes:
                raise ValueError("replacement image required")
            if xref > 0 and not new_bbox:
                page.replace_image(xref, stream=replacement_image_bytes)
            else:
                if xref > 0:
                    page.delete_image(xref)
                page.insert_image(
                    pymupdf.Rect(rect_to_pdf(page, new_bbox or orig_bbox or [72, 72, 272, 272])),
                    stream=replacement_image_bytes,
                    rotate=(int(rotation) + page.rotation) % 360,
                )
            return doc.tobytes(garbage=3, deflate=True)

        if action == "transform":
            data = _image_bytes(doc, xref)
            if crop_ratios and len(crop_ratios) == 4 and crop_ratios != [0, 0, 1, 1]:
                img = Image.open(io.BytesIO(data))
                w, h = img.size
                l = max(0, min(w - 1, int(w * float(crop_ratios[0]))))
                t = max(0, min(h - 1, int(h * float(crop_ratios[1]))))
                r = max(l + 1, min(w, int(w * float(crop_ratios[2]))))
                b = max(t + 1, min(h, int(h * float(crop_ratios[3]))))
                buf = io.BytesIO()
                img.crop((l, t, r, b)).save(buf, format="PNG")
                data = buf.getvalue()
            page.delete_image(xref)
            page.insert_image(
                pymupdf.Rect(rect_to_pdf(page, new_bbox or orig_bbox or [72, 72, 272, 272])),
                stream=data,
                rotate=(int(rotation) + page.rotation) % 360,
                keep_proportion=False,
            )
            return doc.tobytes(garbage=3, deflate=True)

        raise ValueError(f"Unsupported image action: {action}")
    finally:
        doc.close()


# ---------------------------------------------------------------------------
# Vector shapes & hyperlinks
# ---------------------------------------------------------------------------


def add_shape_object(
    pdf_bytes: bytes,
    page_index: int,
    shape_type: str,
    bbox: List[float],
    stroke_hex: str = "#1d4ed8",
    fill_hex: Optional[str] = None,
    stroke_width: float = 2.0,
    opacity: float = 1.0,
    object_id: Optional[str] = None,
) -> bytes:
    """Draw rect / ellipse / line / arrow into the content stream.

    For line & arrow, ``bbox`` is interpreted as [x_start, y_start, x_end, y_end].
    """
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = doc[page_index]
        shape = page.new_shape()
        stroke = hex_to_rgb_float(stroke_hex) if stroke_hex else None
        fill = hex_to_rgb_float(fill_hex) if fill_hex else None
        p1 = pymupdf.Point(point_to_pdf(page, bbox[:2]))
        p2 = pymupdf.Point(point_to_pdf(page, bbox[2:]))
        rect = pymupdf.Rect(rect_to_pdf(page, bbox))

        if shape_type == "rect":
            shape.draw_rect(rect)
        elif shape_type in ("ellipse", "circle"):
            shape.draw_oval(rect)
        elif shape_type == "line":
            shape.draw_line(p1, p2)
        elif shape_type == "arrow":
            shape.draw_line(p1, p2)
            ang = math.atan2(p2.y - p1.y, p2.x - p1.x)
            head = max(8.0, float(stroke_width) * 4.0)
            for dlt in (-math.pi / 6, math.pi / 6):
                shape.draw_line(p2, pymupdf.Point(p2.x - head * math.cos(ang + dlt), p2.y - head * math.sin(ang + dlt)))
        else:
            raise ValueError(f"Unsupported shape_type: {shape_type}")

        shape.finish(
            color=stroke,
            fill=fill if shape_type in ("rect", "ellipse", "circle") else None,
            width=float(stroke_width),
            stroke_opacity=float(opacity),
            fill_opacity=float(opacity),
        )
        shape.commit()

        # Persist Vellum Shape metadata
        v_data = _get_page_vellum_data(doc, page)
        shape_id = object_id or f"vshape_{int(time.time() * 1000)}_{random.randint(100, 999)}"
        shape_record = {
            "id": shape_id,
            "type": "shape",
            "shape_type": shape_type,
            "bbox": [round(float(v), 2) for v in bbox],
            "stroke_hex": stroke_hex,
            "fill_hex": fill_hex,
            "stroke_width": round(float(stroke_width), 2),
            "opacity": round(float(opacity), 2),
            "rotation": 0,
        }
        existing_idx = next((i for i, s in enumerate(v_data.get("shapes", [])) if s.get("id") == shape_id), None)
        if existing_idx is not None:
            v_data["shapes"][existing_idx] = shape_record
        else:
            v_data.setdefault("shapes", []).append(shape_record)
        _set_page_vellum_data(doc, page, v_data)

        return doc.tobytes(garbage=1, deflate=True)
    finally:
        doc.close()


def manage_hyperlink(
    pdf_bytes: bytes,
    page_index: int,
    action: str,
    bbox: List[float],
    uri: Optional[str] = None,
    target_page: Optional[int] = None,
) -> bytes:
    """add | update | delete a link annotation (display-space bbox)."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = doc[page_index]
        rect = pymupdf.Rect(rect_to_pdf(page, bbox))
        if action in ("delete", "update"):
            for link in page.get_links():
                if pymupdf.Rect(link["from"]).intersects(rect):
                    page.delete_link(link)
        if action in ("add", "update"):
            if uri:
                page.insert_link({"kind": pymupdf.LINK_URI, "from": rect, "uri": uri})
            elif target_page is not None and target_page >= 0:
                page.insert_link({"kind": pymupdf.LINK_GOTO, "from": rect, "page": int(target_page)})
            else:
                raise ValueError("Either uri or target_page must be provided")
        return doc.tobytes(garbage=1, deflate=True)
    finally:
        doc.close()


def transform_object(
    pdf_bytes: bytes,
    page_index: int,
    object_id: str,
    object_type: str,
    action: str,  # "transform" | "move" | "delete" | "duplicate" | "update_style"
    orig_bbox: List[float],
    new_bbox: Optional[List[float]] = None,
    orig_origin: Optional[List[float]] = None,
    text: Optional[str] = None,
    font_name: Optional[str] = None,
    font_size: Optional[float] = None,
    color_hex: Optional[str] = None,
    bold: Optional[bool] = None,
    italic: Optional[bool] = None,
    align: Optional[str] = None,
    shape_type: Optional[str] = None,
    stroke_hex: Optional[str] = None,
    fill_hex: Optional[str] = None,
    stroke_width: Optional[float] = None,
    opacity: Optional[float] = None,
    rotation: Optional[int] = 0,
    image_xref: Optional[int] = None,
) -> bytes:
    """Unified transformation, repositioning, resizing, styling, and deletion for any object."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = doc[page_index]
        v_data = _get_page_vellum_data(doc, page)

        if object_type == "textbox":
            # Find in VellumData boxes
            boxes = v_data.get("boxes", [])
            box = next((b for b in boxes if b.get("id") == object_id), None)
            if box is None:
                # Proximity fallback
                for b in boxes:
                    bx = b.get("bbox", [])
                    if len(bx) == 4 and abs(bx[0] - orig_bbox[0]) < 10 and abs(bx[1] - orig_bbox[1]) < 10:
                        box = b
                        break

            if box is not None:
                # Remove previous text from content stream if not duplicating
                if action != "duplicate":
                    old_pdf_rect = pymupdf.Rect(rect_to_pdf(page, box.get("bbox", orig_bbox)))
                    _remove_glyphs(page, old_pdf_rect)
                    if box.get("background_hex") or (box.get("border_hex") and box.get("border_width", 0) > 0):
                        page.add_redact_annot(old_pdf_rect, fill=False)
                        page.apply_redactions(graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED, text=0, images=0)

                if action == "delete":
                    v_data["boxes"] = [b for b in boxes if b.get("id") != box["id"]]
                    _set_page_vellum_data(doc, page, v_data)
                    return doc.tobytes(garbage=1, deflate=True)

                # Determine target bbox
                if action == "duplicate":
                    target_bbox = [orig_bbox[0] + 20, orig_bbox[1] + 20, orig_bbox[2] + 20, orig_bbox[3] + 20]
                    target_id = f"vbox_{int(time.time() * 1000)}_{random.randint(100, 999)}"
                else:
                    target_bbox = new_bbox or orig_bbox
                    target_id = box["id"]

                final_text = text if text is not None else box.get("text", "")
                final_font = font_name or box.get("font", "helv")
                final_size = font_size if font_size is not None else box.get("size", 12.0)
                final_color = color_hex or box.get("color", "#000000")
                final_bold = bold if bold is not None else box.get("bold", False)
                final_italic = italic if italic is not None else box.get("italic", False)
                final_align = align or box.get("align", "left")

                d = pymupdf.Rect(target_bbox)
                if d.width < 20:
                    d.x1 = d.x0 + 100
                if d.height < final_size * 1.4:
                    d.y1 = d.y0 + max(final_size * 2.0, final_size * 1.3 * (final_text.count("\n") + 1) + 8)

                inner = pymupdf.Rect(rect_to_pdf(page, d))
                info = resolve_pdf_font(final_font, bold=final_bold, italic=final_italic, text_content=final_text)
                align_code = ALIGN_MAP.get(final_align, pymupdf.TEXT_ALIGN_LEFT)
                page.insert_textbox(
                    inner,
                    final_text,
                    fontsize=float(final_size),
                    fontname=info["fontname"],
                    fontfile=info["fontfile"],
                    color=hex_to_rgb_float(final_color),
                    align=align_code,
                    rotate=page.rotation,
                )

                updated_box = {
                    "id": target_id,
                    "type": "textbox",
                    "text": final_text,
                    "bbox": [round(float(v), 2) for v in target_bbox],
                    "font": final_font,
                    "size": round(float(final_size), 2),
                    "color": final_color,
                    "bold": final_bold,
                    "italic": final_italic,
                    "align": final_align,
                    "background_hex": box.get("background_hex"),
                    "border_hex": box.get("border_hex"),
                    "border_width": box.get("border_width", 0),
                }
                if action == "duplicate":
                    v_data.setdefault("boxes", []).append(updated_box)
                else:
                    b_idx = next(i for i, b in enumerate(boxes) if b.get("id") == box["id"])
                    v_data["boxes"][b_idx] = updated_box
                _set_page_vellum_data(doc, page, v_data)
                return doc.tobytes(garbage=1, deflate=True)
            else:
                # Text box was not in VellumData, fall back to edit_text_span
                doc.close()
                res = edit_text_span(
                    pdf_bytes,
                    page_index,
                    orig_bbox=orig_bbox,
                    new_bbox=new_bbox if action in ("transform", "move", "update_style") else None,
                    new_text="" if action == "delete" else (text if text is not None else ""),
                    font_name=font_name,
                    font_size=font_size or 12.0,
                    color_hex=color_hex or "#000000",
                    bold=bold or False,
                    italic=italic or False,
                    align=align or "left",
                )
                return res["pdf_bytes"]

        elif object_type == "shape":
            shapes = v_data.get("shapes", [])
            shape = next((s for s in shapes if s.get("id") == object_id), None)
            if shape is None:
                for s in shapes:
                    sb = s.get("bbox", [])
                    if len(sb) == 4 and abs(sb[0] - orig_bbox[0]) < 10 and abs(sb[1] - orig_bbox[1]) < 10:
                        shape = s
                        break

            if shape is not None:
                if action != "duplicate":
                    old_pdf_rect = pymupdf.Rect(rect_to_pdf(page, shape.get("bbox", orig_bbox)))
                    # Expand slightly to cover stroke borders
                    old_pdf_rect.x0 -= 2
                    old_pdf_rect.y0 -= 2
                    old_pdf_rect.x1 += 2
                    old_pdf_rect.y1 += 2
                    page.add_redact_annot(old_pdf_rect, fill=False)
                    page.apply_redactions(graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_COVERED, text=0, images=0)

                if action == "delete":
                    v_data["shapes"] = [s for s in shapes if s.get("id") != shape["id"]]
                    _set_page_vellum_data(doc, page, v_data)
                    return doc.tobytes(garbage=1, deflate=True)

                if action == "duplicate":
                    target_bbox = [orig_bbox[0] + 20, orig_bbox[1] + 20, orig_bbox[2] + 20, orig_bbox[3] + 20]
                    target_id = f"vshape_{int(time.time() * 1000)}_{random.randint(100, 999)}"
                else:
                    target_bbox = new_bbox or orig_bbox
                    target_id = shape["id"]

                s_type = shape_type or shape.get("shape_type", "rect")
                s_stroke = stroke_hex or shape.get("stroke_hex", "#1d4ed8")
                s_fill = fill_hex if fill_hex is not None else shape.get("fill_hex")
                s_width = stroke_width if stroke_width is not None else shape.get("stroke_width", 2.0)
                s_opacity = opacity if opacity is not None else shape.get("opacity", 1.0)

                sh = page.new_shape()
                stroke_c = hex_to_rgb_float(s_stroke) if s_stroke else None
                fill_c = hex_to_rgb_float(s_fill) if s_fill else None
                p1 = pymupdf.Point(point_to_pdf(page, target_bbox[:2]))
                p2 = pymupdf.Point(point_to_pdf(page, target_bbox[2:]))
                rect = pymupdf.Rect(rect_to_pdf(page, target_bbox))

                if s_type == "rect":
                    sh.draw_rect(rect)
                elif s_type in ("ellipse", "circle"):
                    sh.draw_oval(rect)
                elif s_type == "line":
                    sh.draw_line(p1, p2)
                elif s_type == "arrow":
                    sh.draw_line(p1, p2)
                    ang = math.atan2(p2.y - p1.y, p2.x - p1.x)
                    head = max(8.0, float(s_width) * 4.0)
                    for dlt in (-math.pi / 6, math.pi / 6):
                        sh.draw_line(p2, pymupdf.Point(p2.x - head * math.cos(ang + dlt), p2.y - head * math.sin(ang + dlt)))
                else:
                    sh.draw_rect(rect)

                sh.finish(
                    color=stroke_c,
                    fill=fill_c if s_type in ("rect", "ellipse", "circle") else None,
                    width=float(s_width),
                    stroke_opacity=float(s_opacity),
                    fill_opacity=float(s_opacity),
                )
                sh.commit()

                updated_shape = {
                    "id": target_id,
                    "type": "shape",
                    "shape_type": s_type,
                    "bbox": [round(float(v), 2) for v in target_bbox],
                    "stroke_hex": s_stroke,
                    "fill_hex": s_fill,
                    "stroke_width": round(float(s_width), 2),
                    "opacity": round(float(s_opacity), 2),
                    "rotation": 0,
                }
                if action == "duplicate":
                    v_data.setdefault("shapes", []).append(updated_shape)
                else:
                    s_idx = next(i for i, s in enumerate(shapes) if s.get("id") == shape["id"])
                    v_data["shapes"][s_idx] = updated_shape
                _set_page_vellum_data(doc, page, v_data)
                return doc.tobytes(garbage=1, deflate=True)
            else:
                return pdf_bytes

        elif object_type == "image":
            doc.close()
            if action == "delete":
                return edit_image_object(pdf_bytes, page_index, xref=image_xref or 0, action="delete", orig_bbox=orig_bbox)
            elif action in ("transform", "move", "update_style"):
                return edit_image_object(
                    pdf_bytes,
                    page_index,
                    xref=image_xref or 0,
                    action="transform",
                    orig_bbox=orig_bbox,
                    new_bbox=new_bbox,
                    rotation=rotation or 0,
                )
            elif action == "duplicate":
                target_bbox = [orig_bbox[0] + 20, orig_bbox[1] + 20, orig_bbox[2] + 20, orig_bbox[3] + 20]
                doc_img = pymupdf.open(stream=pdf_bytes, filetype="pdf")
                try:
                    data = _image_bytes(doc_img, image_xref or 0)
                    p_img = doc_img[page_index]
                    p_img.insert_image(pymupdf.Rect(rect_to_pdf(p_img, target_bbox)), stream=data, rotate=(int(rotation or 0) + p_img.rotation) % 360)
                    return doc_img.tobytes(garbage=1, deflate=True)
                finally:
                    doc_img.close()

        elif object_type in ("text_span", "text"):
            doc.close()
            if action == "delete":
                res = edit_text_span(pdf_bytes, page_index, orig_bbox=orig_bbox, new_text="")
                return res["pdf_bytes"]

            # If text or styling is not fully provided by caller, look up existing span from the page
            matched_span: Optional[Dict[str, Any]] = None
            try:
                page_objs = inspect_page_objects(pdf_bytes, page_index)
                for s in page_objs.get("text_spans", []):
                    if s.get("id") == object_id:
                        matched_span = s
                        break
                    sb = s.get("bbox", [])
                    if len(sb) == 4 and abs(sb[0] - orig_bbox[0]) < 12 and abs(sb[1] - orig_bbox[1]) < 12:
                        matched_span = s
                        break
            except Exception:
                matched_span = None

            if matched_span:
                if text is None:
                    text = matched_span.get("text", "")
                if not font_name:
                    font_name = matched_span.get("font", "helv")
                if not font_size:
                    font_size = matched_span.get("size", 12.0)
                if not color_hex:
                    color_hex = matched_span.get("color", "#000000")
                if bold is None:
                    bold = matched_span.get("bold", False)
                if italic is None:
                    italic = matched_span.get("italic", False)
                if orig_origin is None:
                    orig_origin = matched_span.get("origin")
                actual_span_bbox = matched_span.get("bbox") or orig_bbox
            else:
                actual_span_bbox = orig_bbox

            # Atomic guard: on move/transform/style update, never erase if text is missing
            if not text:
                return pdf_bytes

            if action in ("transform", "move", "update_style"):
                target_bbox = new_bbox if new_bbox else orig_bbox
                try:
                    res = edit_text_span(
                        pdf_bytes,
                        page_index,
                        orig_bbox=actual_span_bbox,
                        new_bbox=target_bbox,
                        orig_origin=orig_origin,
                        new_text=text,
                        original_font=font_name,
                        font_name=font_name,
                        font_size=font_size or 12.0,
                        color_hex=color_hex or "#000000",
                        bold=bold or False,
                        italic=italic or False,
                        align=align or "left",
                        keep_original_font=True,
                    )
                    transformed_bytes = res["pdf_bytes"]

                    # Atomic verification: verify text exists in resulting document
                    verify_doc = pymupdf.open(stream=transformed_bytes, filetype="pdf")
                    try:
                        p_verify = verify_doc[page_index]
                        page_txt = p_verify.get_text()
                        first_token = text.strip().split()[0] if text.strip() else ""
                        if first_token and first_token not in page_txt:
                            # If text was lost, abort atomically and restore original document
                            return pdf_bytes
                    finally:
                        verify_doc.close()

                    return transformed_bytes
                except Exception:
                    # On unexpected error, return original bytes untouched
                    return pdf_bytes

            elif action == "duplicate":
                target_bbox = [orig_bbox[0] + 20, orig_bbox[1] + 20, orig_bbox[2] + 20, orig_bbox[3] + 20]
                return add_text_object(
                    pdf_bytes,
                    page_index,
                    text=text or "Copy",
                    bbox=target_bbox,
                    font_name=font_name or "helv",
                    font_size=font_size or 12.0,
                    color_hex=color_hex or "#000000",
                    bold=bold or False,
                    italic=italic or False,
                    align=align or "left",
                )

        return pdf_bytes
    finally:
        if not doc.is_closed:
            doc.close()
