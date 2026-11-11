"""Utility helpers for colors, fonts, coordinates, and visual comparison."""

from __future__ import annotations

import base64
import io
import os
from typing import Any, Dict, List, Optional, Tuple

import pymupdf
from PIL import Image, ImageChops, ImageStat


# --- Coordinate spaces -------------------------------------------------------
# PyMuPDF content/text/annotation APIs use the *unrotated* page space (relative to
# the CropBox origin). Rendered bitmaps, and therefore everything the UI shows, are
# in *display* space (rotation applied). These helpers convert between the two so
# the UI can always work in display coordinates.


def _round_rect(r: "pymupdf.Rect") -> List[float]:
    return [round(r.x0, 2), round(r.y0, 2), round(r.x1, 2), round(r.y1, 2)]


def rect_to_display(page: "pymupdf.Page", bbox: Any) -> List[float]:
    r = pymupdf.Rect(bbox)
    if page.rotation:
        r = r * page.rotation_matrix
    r.normalize()
    return _round_rect(r)


def rect_to_pdf(page: "pymupdf.Page", bbox: Any) -> List[float]:
    r = pymupdf.Rect(bbox)
    if page.rotation:
        r = r * page.derotation_matrix
    r.normalize()
    return _round_rect(r)


def point_to_display(page: "pymupdf.Page", pt: Any) -> List[float]:
    p = pymupdf.Point(pt)
    if page.rotation:
        p = p * page.rotation_matrix
    return [round(p.x, 2), round(p.y, 2)]


def point_to_pdf(page: "pymupdf.Page", pt: Any) -> List[float]:
    p = pymupdf.Point(pt)
    if page.rotation:
        p = p * page.derotation_matrix
    return [round(p.x, 2), round(p.y, 2)]


def int_color_to_hex(color_int: Optional[int]) -> str:
    """Convert PyMuPDF 24-bit integer RGB color to #RRGGBB hex string."""
    if color_int is None:
        return "#000000"
    r = (color_int >> 16) & 0xFF
    g = (color_int >> 8) & 0xFF
    b = color_int & 0xFF
    return f"#{r:02x}{g:02x}{b:02x}"


def hex_to_rgb_float(hex_str: str) -> Tuple[float, float, float]:
    """Convert #RRGGBB hex string to normalized (r, g, b) floats in [0.0, 1.0]."""
    if not hex_str:
        return (0.0, 0.0, 0.0)
    clean = hex_str.strip().lstrip("#")
    if len(clean) == 3:
        clean = "".join(c * 2 for c in clean)
    if len(clean) != 6:
        return (0.0, 0.0, 0.0)
    try:
        r = int(clean[0:2], 16) / 255.0
        g = int(clean[2:4], 16) / 255.0
        b = int(clean[4:6], 16) / 255.0
        return (r, g, b)
    except ValueError:
        return (0.0, 0.0, 0.0)


def rgb_float_to_hex(rgb: Tuple[float, ...]) -> str:
    """Convert normalized (r, g, b) float tuple to #RRGGBB hex string."""
    if not rgb or len(rgb) < 3:
        return "#000000"
    r = max(0, min(255, int(round(rgb[0] * 255))))
    g = max(0, min(255, int(round(rgb[1] * 255))))
    b = max(0, min(255, int(round(rgb[2] * 255))))
    return f"#{r:02x}{g:02x}{b:02x}"


# Standard Base-14 & System Font Resolution
BASE14_MAP: Dict[str, str] = {
    "helv": "helv",
    "helvetica": "helv",
    "sans": "helv",
    "sans-serif": "helv",
    "arial": "helv",
    "hebo": "hebo",
    "helvetica-bold": "hebo",
    "heit": "heit",
    "helvetica-oblique": "heit",
    "hebi": "hebi",
    "helvetica-boldoblique": "hebi",
    "tiro": "tiro",
    "times": "tiro",
    "times-roman": "tiro",
    "serif": "tiro",
    "tibo": "tibo",
    "times-bold": "tibo",
    "tiit": "tiit",
    "times-italic": "tiit",
    "tibi": "tibi",
    "times-bolditalic": "tibi",
    "cour": "cour",
    "courier": "cour",
    "mono": "cour",
    "monospace": "cour",
    "cobo": "cobo",
    "courier-bold": "cobo",
    "coit": "coit",
    "courier-oblique": "coit",
    "cobi": "cobi",
    "courier-boldoblique": "cobi",
}

SYSTEM_TTF_CANDIDATES: Dict[str, List[str]] = {
    "sans": [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/usr/share/fonts/truetype/ubuntu/Ubuntu-R.ttf",
    ],
    "sans-bold": [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ],
    "serif": [
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
    ],
    "serif-bold": [
        "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf",
    ],
    "mono": [
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationMono-Regular.ttf",
    ],
}


def resolve_pdf_font(
    requested_font: Optional[str],
    original_font: Optional[str] = None,
    bold: bool = False,
    italic: bool = False,
    text_content: str = "",
) -> Dict[str, Any]:
    """
    Resolve a font request into a PyMuPDF fontname/fontfile specification,
    detecting whether subset font fallback was required.
    """
    needs_unicode = any(ord(ch) > 127 for ch in text_content)
    orig = (original_font or "").strip()
    req = (requested_font or orig or "helv").strip()

    is_subset = "+" in orig or (
        orig
        and orig.lower() not in BASE14_MAP
        and not orig.lower().startswith(("helv", "times", "cour", "tiro"))
    )

    norm = req.lower()
    family = "sans"
    if any(k in norm for k in ("times", "tiro", "serif", "georgia", "garamond", "dejavuserif")):
        family = "serif"
    elif any(k in norm for k in ("cour", "mono", "consolas", "dejavusansmono")):
        family = "mono"

    if family == "serif":
        if bold and italic:
            base14 = "tibi"
        elif bold:
            base14 = "tibo"
        elif italic:
            base14 = "tiit"
        else:
            base14 = "tiro"
    elif family == "mono":
        if bold and italic:
            base14 = "cobi"
        elif bold:
            base14 = "cobo"
        elif italic:
            base14 = "coit"
        else:
            base14 = "cour"
    else:
        if bold and italic:
            base14 = "hebi"
        elif bold:
            base14 = "hebo"
        elif italic:
            base14 = "heit"
        else:
            base14 = "helv"

    if norm in BASE14_MAP and not bold and not italic:
        base14 = BASE14_MAP[norm]

    fontfile: Optional[str] = None
    if needs_unicode or norm.startswith("dejavu"):
        ttf_key = f"{family}-bold" if bold and f"{family}-bold" in SYSTEM_TTF_CANDIDATES else family
        for candidate in SYSTEM_TTF_CANDIDATES.get(ttf_key, []):
            if os.path.isfile(candidate):
                fontfile = candidate
                break

    fallback_used = False
    fallback_reason = ""
    if is_subset and (not requested_font or requested_font == original_font):
        fallback_used = True
        fallback_reason = (
            f"Original PDF font '{orig}' is an embedded subset font; "
            f"substituted metric-compatible '{base14}' font while preserving baseline and background graphics."
        )
    elif needs_unicode and fontfile:
        fallback_used = True
        fallback_reason = (
            f"Text contains extended Unicode characters; embedded TrueType font '{os.path.basename(fontfile)}'."
        )

    return {
        "fontname": base14 if not fontfile else f"F_{family}_{'b' if bold else 'r'}",
        "fontfile": fontfile,
        "base14": base14,
        "family": family,
        "fallback_used": fallback_used,
        "fallback_reason": fallback_reason,
        "original_font": orig,
    }


def compare_page_renders(
    pdf_bytes_a: bytes,
    pdf_bytes_b: bytes,
    page_index: int = 0,
    dpi: int = 120,
) -> Dict[str, Any]:
    """
    Render a page from two PDF byte streams and compute pixel-level similarity
    and a visual diff overlay image (PNG base64).
    """
    doc_a = pymupdf.open(stream=pdf_bytes_a, filetype="pdf")
    doc_b = pymupdf.open(stream=pdf_bytes_b, filetype="pdf")
    try:
        if page_index >= len(doc_a) or page_index >= len(doc_b):
            return {"error": "Page index out of range", "similarity": 0.0}

        pix_a = doc_a[page_index].get_pixmap(dpi=dpi, alpha=False)
        pix_b = doc_b[page_index].get_pixmap(dpi=dpi, alpha=False)

        img_a = Image.frombytes("RGB", (pix_a.width, pix_a.height), pix_a.samples)
        img_b = Image.frombytes("RGB", (pix_b.width, pix_b.height), pix_b.samples)

        if img_a.size != img_b.size:
            img_b = img_b.resize(img_a.size, Image.Resampling.LANCZOS)

        diff = ImageChops.difference(img_a, img_b)
        stat = ImageStat.Stat(diff)
        mean_channel_diff = sum(stat.mean) / 3.0
        similarity = max(0.0, min(100.0, 100.0 * (1.0 - (mean_channel_diff / 255.0))))

        # Count changed pixels where max channel delta > 12
        diff_gray = diff.convert("L")
        hist = diff_gray.histogram()
        total_pixels = img_a.width * img_a.height
        changed_pixels = sum(hist[13:])
        changed_ratio = (changed_pixels / total_pixels) * 100.0 if total_pixels else 0.0

        # Create highlighted visual diff overlay (tint changed regions in magenta/red over img_b)
        mask = diff_gray.point(lambda p: 180 if p > 12 else 0)
        highlight = Image.new("RGB", img_b.size, (239, 68, 68))
        composite = Image.composite(highlight, img_b, mask)

        buf = io.BytesIO()
        composite.save(buf, format="PNG")
        diff_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

        return {
            "page_index": page_index,
            "width": img_a.width,
            "height": img_a.height,
            "similarity_percent": round(similarity, 3),
            "changed_pixels": changed_pixels,
            "changed_Area_percent": round(changed_ratio, 3),
            "diff_image_base64": diff_b64,
        }
    finally:
        doc_a.close()
        doc_b.close()

