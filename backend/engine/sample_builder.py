"""Rich PDF Showcase & Test Fixture Generator for Vellum PDF Pro."""

from __future__ import annotations

import io
from PIL import Image, ImageDraw
import pymupdf


def create_showcase_pdf() -> bytes:
    """
    Create a comprehensive 3-page showcase PDF containing:
    - Page 1: Executive Agreement with colored banner, editable headings/paragraphs,
      an embedded raster logo/diagram image, hyperlinks, and bookmarks.
    - Page 2: Financial Quarterly Table (for Excel/CSV table extraction) + Interactive AcroForm fields.
    - Page 3: Scanned Invoice Receipt simulation & Signature/Redaction block.
    """
    doc = pymupdf.open()
    doc.set_metadata(
        {
            "title": "Vellum Enterprise Master Services Agreement",
            "author": "Vellum Legal & Engineering",
            "subject": "Commercial Contract & Financial Schedule",
            "keywords": "Contract, Invoice, AcroForm, Linux PDF Editor",
            "creator": "Vellum PDF Pro",
        }
    )

    # --- PAGE 1: Contract Text + Colored Header Banner + Embedded Raster Image + Hyperlink ---
    p1 = doc.new_page(width=595, height=842)
    # Colored header banner (tests that direct text editing preserves background color without white rectangle!)
    p1.draw_rect(pymupdf.Rect(40, 36, 555, 115), color=(0.12, 0.25, 0.55), fill=(0.88, 0.93, 1.0), width=1.5)
    p1.insert_text(
        pymupdf.Point(56, 72),
        "MASTER SOFTWARE SERVICES AGREEMENT",
        fontsize=18.0,
        fontname="hebo",
        color=(0.08, 0.18, 0.42),
    )
    p1.insert_text(
        pymupdf.Point(56, 96),
        "Document Ref: MSA-2026-8841  |  Status: Active Draft",
        fontsize=11.0,
        fontname="helv",
        color=(0.20, 0.30, 0.48),
    )

    # Generate and embed a crisp raster badge/diagram image on Page 1
    pil_img = Image.new("RGB", (240, 140), (24, 58, 122))
    draw = ImageDraw.Draw(pil_img)
    draw.rectangle([8, 8, 231, 131], outline=(96, 165, 250), width=3)
    draw.ellipse([24, 28, 104, 108], fill=(59, 130, 246), outline=(255, 255, 255), width=2)
    draw.rectangle([124, 36, 214, 62], fill=(147, 197, 253))
    draw.rectangle([124, 76, 196, 102], fill=(191, 219, 254))
    img_buf = io.BytesIO()
    pil_img.save(img_buf, format="PNG")
    p1.insert_image(pymupdf.Rect(380, 138, 550, 238), stream=img_buf.getvalue())

    # Contract sections
    p1.insert_text(pymupdf.Point(48, 155), "1. Scope of Professional Services", fontsize=14.0, fontname="hebo", color=(0.06, 0.09, 0.16))
    p1.insert_text(
        pymupdf.Point(48, 180),
        "Provider shall deliver Linux desktop infrastructure and PDF engineering services.",
        fontsize=11.0,
        fontname="helv",
        color=(0.15, 0.20, 0.28),
    )
    p1.insert_text(
        pymupdf.Point(48, 200),
        "All deliverables operate 100% offline with local cryptographic verification.",
        fontsize=11.0,
        fontname="helv",
        color=(0.15, 0.20, 0.28),
    )

    p1.insert_text(pymupdf.Point(48, 265), "2. Commercial Terms & Confidentiality", fontsize=14.0, fontname="hebo", color=(0.06, 0.09, 0.16))
    p1.insert_text(
        pymupdf.Point(48, 290),
        "Annual license fee: $48,500.00 USD payable net 30 days from invoice date.",
        fontsize=11.0,
        fontname="helv",
        color=(0.15, 0.20, 0.28),
    )
    p1.insert_text(
        pymupdf.Point(48, 312),
        "Sensitive Tax ID (For Redaction Test): SSN 999-42-8174 / ACCT-7781920",
        fontsize=11.0,
        fontname="cour",
        color=(0.55, 0.12, 0.12),
    )

    # Clickable hyperlink on Page 1
    link_rect = pymupdf.Rect(48, 345, 290, 368)
    p1.insert_text(
        pymupdf.Point(48, 360),
        "https://specifications.vellumpdf.linux/msa",
        fontsize=10.5,
        fontname="helv",
        color=(0.10, 0.35, 0.80),
    )
    p1.insert_link({"kind": pymupdf.LINK_URI, "from": link_rect, "uri": "https://specifications.vellumpdf.linux/msa"})

    # --- PAGE 2: Financial Schedule Table & Interactive AcroForm Fields ---
    p2 = doc.new_page(width=595, height=842)
    p2.insert_text(pymupdf.Point(48, 60), "Schedule A — Quarterly Financial Breakdown", fontsize=15.0, fontname="hebo", color=(0.06, 0.09, 0.16))

    # Draw bordered table for table extraction testing
    table_data = [
        ["Quarter", "Deliverable Milestone", "Hours", "Amount (USD)"],
        ["Q1 2026", "Core PDF Rendering & Content Engine", "320", "$14,400.00"],
        ["Q2 2026", "Direct Stream Editor & Font Mapper", "280", "$12,600.00"],
        ["Q3 2026", "PKCS#12 Digital Signatures & OCR", "240", "$10,800.00"],
        ["Q4 2026", "Linux Packaging (.deb & .AppImage)", "238", "$10,700.00"],
    ]
    col_x = [48.0, 130.0, 360.0, 435.0, 545.0]
    start_y = 85.0
    row_h = 26.0

    for r_i, row in enumerate(table_data):
        y0 = start_y + r_i * row_h
        y1 = y0 + row_h
        for c_i, cell_val in enumerate(row):
            x0, x1 = col_x[c_i], col_x[c_i + 1]
            cell_rect = pymupdf.Rect(x0, y0, x1, y1)
            fill_c = (0.88, 0.92, 0.98) if r_i == 0 else ((0.98, 0.99, 1.0) if r_i % 2 == 1 else (1.0, 1.0, 1.0))
            p2.draw_rect(cell_rect, color=(0.45, 0.52, 0.64), fill=fill_c, width=0.8)
            p2.insert_text(
                pymupdf.Point(x0 + 6, y0 + 17),
                cell_val,
                fontsize=9.5,
                fontname="hebo" if r_i == 0 else "helv",
                color=(0.08, 0.12, 0.22),
            )

    # Interactive AcroForm section on Page 2
    p2.insert_text(pymupdf.Point(48, 255), "Client Sign-Off & Configuration Form", fontsize=14.0, fontname="hebo", color=(0.06, 0.09, 0.16))

    p2.insert_text(pymupdf.Point(48, 290), "Client Organization:", fontsize=10.5, fontname="helv")
    w_org = pymupdf.Widget()
    w_org.field_name = "client_organization"
    w_org.field_label = "Client Organization Name"
    w_org.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
    w_org.rect = pymupdf.Rect(175, 275, 420, 297)
    w_org.field_value = "Acme Linux Systems Ltd."
    w_org.text_fontsize = 10.5
    w_org.fill_color = [0.97, 0.98, 1.0]
    w_org.border_color = [0.4, 0.5, 0.65]
    p2.add_widget(w_org)

    p2.insert_text(pymupdf.Point(48, 330), "Deployment Tier:", fontsize=10.5, fontname="helv")
    w_tier = pymupdf.Widget()
    w_tier.field_name = "deployment_tier"
    w_tier.field_label = "Deployment Tier"
    w_tier.field_type = pymupdf.PDF_WIDGET_TYPE_COMBOBOX
    w_tier.rect = pymupdf.Rect(175, 315, 350, 337)
    w_tier.choice_values = ["Enterprise Offline", "Government Air-Gapped", "Developer Workstation"]
    w_tier.field_value = "Enterprise Offline"
    w_tier.field_flags = pymupdf.PDF_CH_FIELD_IS_COMBO | pymupdf.PDF_CH_FIELD_IS_EDIT
    w_tier.fill_color = [0.97, 0.98, 1.0]
    w_tier.border_color = [0.4, 0.5, 0.65]
    p2.add_widget(w_tier)

    p2.insert_text(pymupdf.Point(48, 368), "Approve Terms:", fontsize=10.5, fontname="helv")
    w_chk = pymupdf.Widget()
    w_chk.field_name = "approve_terms"
    w_chk.field_label = "Approve Contract Terms"
    w_chk.field_type = pymupdf.PDF_WIDGET_TYPE_CHECKBOX
    w_chk.rect = pymupdf.Rect(175, 354, 193, 372)
    w_chk.field_value = True
    w_chk.border_color = [0.3, 0.4, 0.6]
    p2.add_widget(w_chk)

    # --- PAGE 3: Authorization & Notes ---
    p3 = doc.new_page(width=595, height=842)
    p3.insert_text(pymupdf.Point(48, 65), "Schedule B — Compliance & Digital Certification", fontsize=15.0, fontname="hebo", color=(0.06, 0.09, 0.16))
    p3.insert_text(
        pymupdf.Point(48, 95),
        "This page is ready for X.509 cryptographic signing, Bates numbering, or OCR testing.",
        fontsize=11.0,
        fontname="helv",
        color=(0.2, 0.25, 0.32),
    )

    # Set hierarchical outline bookmarks
    doc.set_toc(
        [
            [1, "1. Master Services Agreement", 1],
            [2, "Scope & Confidentiality", 1],
            [1, "2. Schedule A: Financial Breakdown & Form", 2],
            [1, "3. Schedule B: Certification & Signatures", 3],
        ]
    )

    out_bytes = doc.tobytes(garbage=3, deflate=True)
    doc.close()
    return out_bytes

