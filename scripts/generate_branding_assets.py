#!/usr/bin/env python3
"""
Vellum PDF Pro — Deterministic Branding Asset Generator
Generates and verifies multi-resolution Linux and cross-platform desktop icons
from the vector master SVG (vellum-app-icon.svg).

Required sizes: 16x16, 24x24, 32x32, 48x48, 64x64, 128x128, 256x256, 512x512, 1024x1024.
"""

import os
import sys
import shutil
import subprocess
from pathlib import Path
from PIL import Image

SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]

def find_project_root() -> Path:
    current = Path(__file__).resolve().parent
    if (current.parent / "package.json").exists():
        return current.parent
    return Path.cwd()

def rasterize_svg_with_inkscape(svg_path: Path, png_path: Path, size: int) -> bool:
    inkscape_bin = shutil.which("inkscape")
    if not inkscape_bin:
        return False
    cmd = [
        inkscape_bin,
        str(svg_path),
        "-o",
        str(png_path),
        "-w",
        str(size),
        "-h",
        str(size),
    ]
    res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return res.returncode == 0

def rasterize_with_pillow_fallback(svg_path: Path, png_path: Path, size: int, source_1024: Path) -> bool:
    if source_1024.exists():
        with Image.open(source_1024) as im:
            im_resized = im.resize((size, size), Image.Resampling.LANCZOS)
            im_resized.save(png_path, format="PNG", optimize=True)
            return True
    return False

def generate_icons(force_regenerate: bool = False):
    root = find_project_root()
    svg_source = root / "resources" / "branding" / "vellum-app-icon.svg"
    icons_dir = root / "resources" / "icons"
    icons_dir.mkdir(parents=True, exist_ok=True)

    if not svg_source.exists():
        print(f"Error: Vector source not found at {svg_source}", file=sys.stderr)
        sys.exit(1)

    print(f"Master Vector Source: {svg_source}")
    print(f"Target Icons Directory: {icons_dir}")

    # Primary 1024 source if available
    source_1024 = icons_dir / "vellum-1024.png"

    results = {}
    for size in SIZES:
        target_png = icons_dir / f"vellum-{size}.png"
        need_gen = force_regenerate or (not target_png.exists())

        if need_gen:
            ok = rasterize_svg_with_inkscape(svg_source, target_png, size)
            if not ok:
                ok = rasterize_with_pillow_fallback(svg_source, target_png, size, source_1024)
            if not ok:
                print(f"Failed to rasterize size {size}x{size}", file=sys.stderr)
                sys.exit(1)

        # Verify dimensions and integrity
        with Image.open(target_png) as im:
            w, h = im.size
            if (w, h) != (size, size):
                raise ValueError(f"Size mismatch in {target_png}: expected {size}x{size}, got {w}x{h}")
            results[size] = (w, h, target_png.stat().st_size)
            print(f"  [OK] vellum-{size}.png ({w}x{h}, {target_png.stat().st_size:,} bytes)")

    # Generate multi-size vellum.ico
    ico_path = icons_dir / "vellum.ico"
    ico_sizes = [16, 24, 32, 48, 64, 128, 256]
    ico_images = [Image.open(icons_dir / f"vellum-{s}.png") for s in ico_sizes]
    ico_images[0].save(
        ico_path,
        format="ICO",
        sizes=[(s, s) for s in ico_sizes],
        append_images=ico_images[1:],
    )
    print(f"  [OK] vellum.ico ({ico_path.stat().st_size:,} bytes, sizes {ico_sizes})")

    # Also make available as vellum-app-icon.png in resources/branding
    branding_png = root / "resources" / "branding" / "vellum-app-icon.png"
    shutil.copy2(icons_dir / "vellum-1024.png", branding_png)
    print(f"  [OK] vellum-app-icon.png updated")

    print("\nAll 9 resolution assets verified successfully!")

if __name__ == "__main__":
    force = "--regenerate" in sys.argv
    generate_icons(force_regenerate=force)

