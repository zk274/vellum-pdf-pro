"""
Reproducible PDF Compatibility Corpus Generator.

Every fixture carries explicit provenance (`origin`):
- "real_libreoffice_writer": exported via `soffice --headless --convert-to pdf`
- "real_libreoffice_calc": exported via `soffice --headless --convert-to pdf`
- "real_chrome_headless": exported via `google-chrome --headless --print-to-pdf`
- "synthetic_*": deterministically generated via PyMuPDF / pikepdf / Pillow
  (clearly identified as synthetic; never misrepresented as third-party files)
"""
from __future__ import annotations

import io
import os
import shutil
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import pikepdf
import pymupdf
from PIL import Image, ImageDraw


DEJAVU_SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


@dataclass
class CompatFixture:
    fixture_id: str
    category: str
    origin: str  # e.g. "real_libreoffice_writer", "real_chrome_headless", "synthetic_pymupdf"
    description: str
    pdf_bytes: bytes
    expected_phrase: Optional[str] = None
    password: Optional[str] = None
    is_malformed: bool = False
    is_scanned: bool = False


def _run_libreoffice_convert(src_path: Path, out_dir: Path) -> Optional[bytes]:
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        return None
    user_profile = out_dir / "lo_profile"
    user_profile.mkdir(exist_ok=True)
    proc = subprocess.run(
        [
            soffice,
            f"-env:UserInstallation=file://{user_profile}",
            "--headless",
            "--norestore",
            "--convert-to",
            "pdf",
            "--outdir",
            str(out_dir),
            str(src_path),
        ],
        capture_output=True,
        text=True,
        timeout=45,
    )
    pdf_out = out_dir / f"{src_path.stem}.pdf"
    if proc.returncode == 0 and pdf_out.exists():
        return pdf_out.read_bytes()
    return None


def build_real_libreoffice_writer_fixture(tmp_dir: Path) -> Optional[CompatFixture]:
    """Generate a real LibreOffice Writer PDF from an HTML/ODT document."""
    html_path = tmp_dir / "lo_writer_sample.html"
    html_path.write_text(
        """<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>LibreOffice Writer Sample</title></head>
<body style="font-family: Liberation Sans, DejaVu Sans, sans-serif; font-size: 11pt;">
  <h1>Quarterly Engineering Review</h1>
  <p>This paragraph contains <b>bold emphasis</b>, <i>italic phrasing</i>, and
  <span style="color:#b91c1c;">colored highlights</span> exported directly by LibreOffice Writer.
  Reference: <a href="https://vellumpdf.linux/lo-spec">Vellum Specification</a>.</p>
  <table border="1" cellpadding="4" cellspacing="0">
    <tr><th>Item</th><th>Status</th><th>Budget</th></tr>
    <tr><td>PDF Content Engine</td><td>Verified</td><td>$12,400</td></tr>
    <tr><td>Offline OCR</td><td>Active</td><td>$4,200</td></tr>
  </table>
</body>
</html>
""",
        encoding="utf-8",
    )
    pdf_bytes = _run_libreoffice_convert(html_path, tmp_dir)
    if not pdf_bytes:
        return None
    return CompatFixture(
        fixture_id="lo_writer_real",
        category="LibreOffice Writer",
        origin="real_libreoffice_writer",
        description="Real LibreOffice Writer HTML->PDF export with mixed runs, hyperlink, and table",
        pdf_bytes=pdf_bytes,
        expected_phrase="Quarterly Engineering Review",
    )


def build_real_libreoffice_calc_fixture(tmp_dir: Path) -> Optional[CompatFixture]:
    """Generate a real LibreOffice Calc PDF from a CSV spreadsheet."""
    csv_path = tmp_dir / "lo_calc_invoice.csv"
    csv_path.write_text(
        "LineItem,Quantity,UnitPrice,Total\n"
        "Linux Desktop License,10,450.00,4500.00\n"
        "Cryptographic Signing Module,2,1200.00,2400.00\n"
        "Support Retainer,1,1500.00,1500.00\n",
        encoding="utf-8",
    )
    pdf_bytes = _run_libreoffice_convert(csv_path, tmp_dir)
    if not pdf_bytes:
        return None
    return CompatFixture(
        fixture_id="lo_calc_real",
        category="LibreOffice Calc",
        origin="real_libreoffice_calc",
        description="Real LibreOffice Calc CSV->PDF spreadsheet export",
        pdf_bytes=pdf_bytes,
        expected_phrase="Linux Desktop License",
    )


def build_real_chrome_headless_fixture(tmp_dir: Path) -> Optional[CompatFixture]:
    """Generate a real browser-exported PDF via Google Chrome headless."""
    chrome = shutil.which("google-chrome") or shutil.which("chromium")
    if not chrome:
        return None
    html_path = tmp_dir / "chrome_print.html"
    pdf_path = tmp_dir / "chrome_print.pdf"
    html_path.write_text(
        """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: sans-serif; margin: 36px; color: #111827; }
  .cols { display: flex; gap: 24px; }
  .col { flex: 1; border: 1px solid #cbd5e1; padding: 12px; border-radius: 6px; }
  .accent { color: #1d4ed8; font-weight: bold; }
</style>
</head>
<body>
  <h2>Browser-Printed Multi-Column Report</h2>
  <div class="cols">
    <div class="col">
      <p>Left column prose with <span class="accent">styled inline span</span> and
      <i>italic text</i> for Chrome headless PDF validation.</p>
      <p><a href="https://vellumpdf.linux/chrome-test">Browser Link Target</a></p>
    </div>
    <div class="col">
      <p>Right column independent block that must stay isolated during left-column edits.</p>
    </div>
  </div>
</body>
</html>
""",
        encoding="utf-8",
    )
    proc = subprocess.run(
        [
            chrome,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            f"--print-to-pdf={pdf_path}",
            "--no-pdf-header-footer",
            html_path.as_uri(),
        ],
        capture_output=True,
        text=True,
        timeout=45,
    )
    if proc.returncode != 0 or not pdf_path.exists():
        return None
    return CompatFixture(
        fixture_id="chrome_headless_real",
        category="Browser-Exported PDF (Chrome)",
        origin="real_chrome_headless",
        description="Real Google Chrome headless --print-to-pdf multi-column HTML/CSS export",
        pdf_bytes=pdf_path.read_bytes(),
        expected_phrase="Browser-Printed Multi-Column Report",
    )


def _make_png_bytes(width: int = 180, height: int = 90, label: str = "LOGO") -> bytes:
    img = Image.new("RGB", (width, height), (28, 68, 128))
    draw = ImageDraw.Draw(img)
    draw.rectangle([6, 6, width - 7, height - 7], outline=(220, 235, 255), width=3)
    draw.text((24, height // 2 - 6), label, fill=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def build_synthetic_fixtures() -> list[CompatFixture]:
    fixtures: list[CompatFixture] = []

    # 1. Microsoft Office-style synthetic contract (NOT native MS Word)
    doc = pymupdf.open()
    p = doc.new_page(width=612, height=792)
    p.insert_text((72, 72), "MASTER SERVICES AGREEMENT (SYNTHETIC OFFICE-STYLE)", fontname="hebo", fontsize=14, color=(0.1, 0.2, 0.45))
    p.insert_text((72, 102), "1. Scope of Work. Vendor shall deliver offline PDF tooling on Linux.", fontname="helv", fontsize=11)
    p.insert_text((72, 118), "All deliverables remain under local cryptographic verification.", fontname="helv", fontsize=11)
    p.insert_text((72, 150), "2. Compensation. Annual fee is $24,000 USD payable net 30 days.", fontname="helv", fontsize=11)
    fixtures.append(
        CompatFixture(
            fixture_id="msoffice_style_synthetic",
            category="Microsoft Office-Style (Synthetic)",
            origin="synthetic_pymupdf",
            description="Synthetic Office-style contract layout (native MS Office binary not present on Linux)",
            pdf_bytes=doc.tobytes(),
            expected_phrase="Vendor shall deliver offline PDF tooling",
        )
    )
    doc.close()

    # 2. Scanned page (image-only, no text layer)
    scan_img = Image.new("RGB", (850, 1100), (248, 246, 240))
    d_scan = ImageDraw.Draw(scan_img)
    d_scan.text((70, 80), "SCANNED DOCUMENT FIXTURE - NO TEXT LAYER", fill=(20, 20, 20))
    d_scan.text((70, 120), "Invoice #SCN-2026-0091  Total Due: $1,250.00", fill=(30, 30, 30))
    sbuf = io.BytesIO()
    scan_img.save(sbuf, format="PNG")
    doc = pymupdf.open()
    p = doc.new_page(width=612, height=792)
    p.insert_image(pymupdf.Rect(0, 0, 612, 792), stream=sbuf.getvalue())
    fixtures.append(
        CompatFixture(
            fixture_id="scanned_page_synthetic",
            category="Scanned Page (Image-Only)",
            origin="synthetic_pymupdf",
            description="Synthetic rasterized scanned page without embedded text layer",
            pdf_bytes=doc.tobytes(),
            is_scanned=True,
        )
    )
    doc.close()

    # 3. Invoice with colored banner & table
    doc = pymupdf.open()
    p = doc.new_page(width=612, height=792)
    p.draw_rect(pymupdf.Rect(48, 48, 564, 96), color=(0.1, 0.25, 0.55), fill=(0.1, 0.25, 0.55))
    p.insert_text((64, 78), "INVOICE #INV-2026-441", fontname="hebo", fontsize=16, color=(1, 1, 1))
    p.insert_text((48, 125), "Bill To: Northwind Linux Systems", fontname="helv", fontsize=11)
    p.insert_text((48, 141), "Terms: Net 30 · Currency: USD", fontname="helv", fontsize=11)
    # Table grid
    for row_i, row_txt in enumerate(["Description | Qty | Amount", "Vellum Pro Seat | 5 | $2,500.00", "Support Plan | 1 | $900.00"]):
        y0 = 180 + row_i * 24
        p.draw_rect(pymupdf.Rect(48, y0, 564, y0 + 24), color=(0.7, 0.75, 0.82), width=0.8)
        p.insert_text((56, y0 + 16), row_txt, fontname="helv", fontsize=10.5)
    fixtures.append(
        CompatFixture(
            fixture_id="invoice_synthetic",
            category="Invoice",
            origin="synthetic_pymupdf",
            description="Synthetic invoice with colored vector banner and bordered table rows",
            pdf_bytes=doc.tobytes(),
            expected_phrase="Bill To: Northwind Linux Systems",
        )
    )
    doc.close()

    # 4. Complex AcroForm
    doc = pymupdf.open()
    p = doc.new_page(width=612, height=792)
    p.insert_text((72, 80), "Client Onboarding Form", fontname="hebo", fontsize=14)
    p.insert_text((72, 112), "Applicant Name:", fontname="helv", fontsize=11)
    w1 = pymupdf.Widget()
    w1.field_name = "applicant_name"
    w1.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    w1.rect = pymupdf.Rect(180, 98, 400, 118)
    w1.field_value = "Ada Lovelace"
    p.add_widget(w1)
    w2 = pymupdf.Widget()
    w2.field_name = "agree_terms"
    w2.field_type = pymupdf.PDF_WIDGET_TYPE_CHECKBOX
    w2.rect = pymupdf.Rect(180, 134, 196, 150)
    w2.field_value = True
    p.add_widget(w2)
    p.insert_text((72, 147), "Accept Terms:", fontname="helv", fontsize=11)
    fixtures.append(
        CompatFixture(
            fixture_id="acroform_synthetic",
            category="Complex Forms (AcroForm)",
            origin="synthetic_pymupdf",
            description="Synthetic AcroForm with text widget + checkbox + surrounding labels",
            pdf_bytes=doc.tobytes(),
            expected_phrase="Client Onboarding Form",
        )
    )
    doc.close()

    # 5. Multi-column layout
    doc = pymupdf.open()
    p = doc.new_page(width=612, height=792)
    p.insert_text((50, 80), "Left column line one prose.", fontname="helv", fontsize=11)
    p.insert_text((50, 96), "Left column line two prose.", fontname="helv", fontsize=11)
    p.insert_text((330, 80), "Right column independent prose.", fontname="helv", fontsize=11)
    p.insert_text((330, 96), "Right column must stay intact.", fontname="helv", fontsize=11)
    fixtures.append(
        CompatFixture(
            fixture_id="multicolumn_synthetic",
            category="Multi-Column Layout",
            origin="synthetic_pymupdf",
            description="Synthetic 2-column layout verifying column isolation during paragraph edit",
            pdf_bytes=doc.tobytes(),
            expected_phrase="Left column line one prose.",
        )
    )
    doc.close()

    # 6. Mixed formatting + hyperlink + annotations
    doc = pymupdf.open()
    p = doc.new_page(width=612, height=792)
    x = 72.0
    for txt, fn, sz, col in [
        ("Normal ", "helv", 11.0, (0, 0, 0)),
        ("BoldRed ", "hebo", 12.5, (0.85, 0.05, 0.05)),
        ("ItalicBlue ", "heit", 11.0, (0.05, 0.25, 0.85)),
        ("SpecLink", "helv", 11.0, (0.0, 0.45, 0.85)),
    ]:
        p.insert_text((x, 100), txt, fontname=fn, fontsize=sz, color=col)
        w = pymupdf.get_text_length(txt, fontname=fn, fontsize=sz)
        if txt == "SpecLink":
            p.insert_link({"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(x, 88, x + w, 104), "uri": "https://vellumpdf.linux/spec"})
        x += w
    p.insert_text((72, 118), "Second line of mixed paragraph.", fontname="helv", fontsize=11)
    p.insert_text((72, 180), "Annotated note target line.", fontname="helv", fontsize=11)
    p.add_highlight_annot(pymupdf.Rect(72, 168, 220, 184))
    p.add_text_annot((240, 175), "Reviewer comment must survive")
    p.insert_text((72, 240), "Sensitive Tax ID: SSN 999-42-8174 / ACCT-7781920", fontname="cour", fontsize=10.5, color=(0.6, 0.1, 0.1))
    fixtures.append(
        CompatFixture(
            fixture_id="mixed_links_annots_redact_synthetic",
            category="Mixed Formatting, Links, Annotations & Redaction",
            origin="synthetic_pymupdf",
            description="Synthetic mixed runs + /Link + Highlight/Text annotations + redaction target",
            pdf_bytes=doc.tobytes(),
            expected_phrase="Second line of mixed paragraph.",
        )
    )
    doc.close()

    # 7. Embedded & subset font + Unicode & ligatures
    if os.path.exists(DEJAVU_SANS):
        doc = pymupdf.open()
        p = doc.new_page(width=612, height=792)
        p.insert_font(fontname="dejavu", fontfile=DEJAVU_SANS)
        p.insert_text((72, 100), "Subset Alpha Beta Café — €100 ﬁle", fontname="dejavu", fontsize=12)
        doc.subset_fonts()
        fixtures.append(
            CompatFixture(
                fixture_id="subset_unicode_synthetic",
                category="Embedded/Subset Fonts & Unicode",
                origin="synthetic_pymupdf",
                description="Synthetic subsetted DejaVuSans PDF with Unicode + ligatures",
                pdf_bytes=doc.tobytes(),
                expected_phrase="Subset Alpha Beta",
            )
        )
        doc.close()

    # 8. Rotations (90°, 180°, 270°)
    for rot in (90, 180, 270):
        doc = pymupdf.open()
        p = doc.new_page(width=612, height=792)
        p.insert_text((72, 100), f"Rotated {rot} line one.", fontname="helv", fontsize=11)
        p.insert_text((72, 116), f"Rotated {rot} line two.", fontname="helv", fontsize=11)
        p.set_rotation(rot)
        fixtures.append(
            CompatFixture(
                fixture_id=f"rotation_{rot}_synthetic",
                category=f"Page Rotation ({rot}°)",
                origin="synthetic_pymupdf",
                description=f"Synthetic page rotated {rot} degrees",
                pdf_bytes=doc.tobytes(),
                expected_phrase=f"Rotated {rot} line one.",
            )
        )
        doc.close()

    # 9. Images + colored vector background behind text
    doc = pymupdf.open()
    p = doc.new_page(width=612, height=792)
    p.draw_rect(pymupdf.Rect(50, 60, 420, 150), color=(0.88, 0.93, 0.99), fill=(0.88, 0.93, 0.99))
    p.insert_text((72, 95), "Text over tinted vector background.", fontname="helv", fontsize=12, color=(0.05, 0.15, 0.35))
    p.insert_image(pymupdf.Rect(72, 180, 252, 270), stream=_make_png_bytes(180, 90, "VELLUM"))
    fixtures.append(
        CompatFixture(
            fixture_id="images_vectors_synthetic",
            category="Images & Vector Backgrounds",
            origin="synthetic_pymupdf",
            description="Synthetic PDF with raster PNG image and text over colored vector fill",
            pdf_bytes=doc.tobytes(),
            expected_phrase="Text over tinted vector background.",
        )
    )
    doc.close()

    # 10. Large document (40 pages)
    doc = pymupdf.open()
    for idx in range(40):
        p = doc.new_page(width=612, height=792)
        p.insert_text((72, 80), f"Large Document Page {idx + 1} of 40", fontname="hebo", fontsize=13)
        p.insert_text((72, 110), f"Body content on page {idx + 1} for performance and integrity verification.", fontname="helv", fontsize=11)
    fixtures.append(
        CompatFixture(
            fixture_id="large_40p_synthetic",
            category="Large Document (40 Pages)",
            origin="synthetic_pymupdf",
            description="Synthetic 40-page document testing mid-document edit and structural persistence",
            pdf_bytes=doc.tobytes(),
            expected_phrase="Body content on page 20",
        )
    )
    doc.close()

    # 11. Encrypted PDF (AES-256)
    doc = pymupdf.open()
    p = doc.new_page(width=612, height=792)
    p.insert_text((72, 100), "Confidential Encrypted Clause.", fontname="helv", fontsize=12)
    enc_bytes = doc.tobytes(
        encryption=pymupdf.PDF_ENCRYPT_AES_256,
        user_pw="vellum_secret_2026",
        owner_pw="vellum_owner_2026",
        permissions=int(pymupdf.PDF_PERM_PRINT | pymupdf.PDF_PERM_MODIFY | pymupdf.PDF_PERM_COPY),
    )
    doc.close()
    fixtures.append(
        CompatFixture(
            fixture_id="encrypted_aes256_synthetic",
            category="Encrypted PDF (AES-256)",
            origin="synthetic_pymupdf",
            description="Synthetic AES-256 password-protected PDF",
            pdf_bytes=enc_bytes,
            expected_phrase="Confidential Encrypted Clause.",
            password="vellum_secret_2026",
        )
    )

    # 12. Malformed & Hostile PDFs
    fixtures.append(
        CompatFixture(
            fixture_id="malformed_truncated_synthetic",
            category="Malformed / Truncated PDF",
            origin="synthetic_malformed",
            description="Truncated non-PDF garbage payload",
            pdf_bytes=b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog /CORRUPT_TRUNCATED",
            is_malformed=True,
        )
    )

    # Hostile PDF with embedded /OpenAction JavaScript
    hostile_doc = pymupdf.open()
    hp = hostile_doc.new_page(width=612, height=792)
    hp.insert_text((72, 100), "Hostile JS payload test document.", fontname="helv", fontsize=11)
    hostile_raw = hostile_doc.tobytes()
    hostile_doc.close()
    with pikepdf.open(io.BytesIO(hostile_raw)) as pk:
        pk.Root["/OpenAction"] = pikepdf.Dictionary(
            S=pikepdf.Name("/JavaScript"),
            JS=pikepdf.String("app.alert('SHOULD_NEVER_EXECUTE');"),
        )
        out_h = io.BytesIO()
        pk.save(out_h)
        hostile_bytes = out_h.getvalue()
    fixtures.append(
        CompatFixture(
            fixture_id="hostile_js_openaction_synthetic",
            category="Hostile PDF (/OpenAction JavaScript)",
            origin="synthetic_pikepdf",
            description="Synthetic PDF with /OpenAction /JavaScript payload to verify passive non-execution",
            pdf_bytes=hostile_bytes,
            expected_phrase="Hostile JS payload test document.",
        )
    )

    return fixtures


def collect_all_fixtures() -> list[CompatFixture]:
    with tempfile.TemporaryDirectory(prefix="vellum_compat_") as td:
        td_path = Path(td)
        out: list[CompatFixture] = []
        for builder in (
            build_real_libreoffice_writer_fixture,
            build_real_libreoffice_calc_fixture,
            build_real_chrome_headless_fixture,
        ):
            fx = builder(td_path)
            if fx is not None:
                out.append(fx)
        out.extend(build_synthetic_fixtures())
        return out

