"""Interactive AcroForms, Visual Signatures, and Cryptographic X.509/PKCS#12 Digital Signatures."""

from __future__ import annotations

import datetime
import hashlib
import io
from typing import Any, Dict, List, Optional

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

from .utils import hex_to_rgb_float, rgb_float_to_hex

WIDGET_TYPE_NAMES: Dict[int, str] = {
    pymupdf.PDF_WIDGET_TYPE_TEXT: "text",
    pymupdf.PDF_WIDGET_TYPE_CHECKBOX: "checkbox",
    pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON: "radiobutton",
    pymupdf.PDF_WIDGET_TYPE_COMBOBOX: "dropdown",
    pymupdf.PDF_WIDGET_TYPE_LISTBOX: "listbox",
    pymupdf.PDF_WIDGET_TYPE_SIGNATURE: "signature",
    pymupdf.PDF_WIDGET_TYPE_BUTTON: "button",
}


def list_form_fields(pdf_bytes: bytes, page_index: Optional[int] = None) -> List[Dict[str, Any]]:
    """List all interactive AcroForm fields in the PDF document."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    fields_out: List[Dict[str, Any]] = []
    try:
        pages = [page_index] if (page_index is not None and 0 <= page_index < len(doc)) else range(len(doc))
        for p_idx in pages:
            page = doc[p_idx]
            widgets = page.widgets()
            if not widgets:
                continue
            for w in widgets:
                rect = w.rect
                w_type = WIDGET_TYPE_NAMES.get(w.field_type, w.field_type_string.lower())
                val = w.field_value
                if w_type == "checkbox":
                    is_checked = bool(val and str(val).lower() not in ("off", "false", "0", "no", ""))
                else:
                    is_checked = False
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
                        "choices": list(w.choice_values or []),
                        "bbox": [round(rect.x0, 2), round(rect.y0, 2), round(rect.x1, 2), round(rect.y1, 2)],
                        "text_fontsize": round(float(w.text_fontsize or 11.0), 1),
                        "text_color": rgb_float_to_hex(tuple(w.text_color or (0, 0, 0))),
                        "fill_color": rgb_float_to_hex(tuple(w.fill_color)) if w.fill_color else None,
                        "border_color": rgb_float_to_hex(tuple(w.border_color)) if w.border_color else None,
                        "is_signed": bool(getattr(w, "is_signed", False)),
                        "read_only": bool(w.field_flags & pymupdf.PDF_FIELD_IS_READ_ONLY),
                    }
                )
        return fields_out
    finally:
        doc.close()


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
    tooltip: str = "",
) -> bytes:
    """Create a new interactive AcroForm field (text, checkbox, radiobutton, dropdown, signature)."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = doc[page_index]
        rect = pymupdf.Rect(bbox)
        if rect.width < 14:
            rect.x1 = rect.x0 + 140
        if rect.height < 14:
            rect.y1 = rect.y0 + 24

        widget = pymupdf.Widget()
        widget.rect = rect
        widget.field_name = field_name.strip() or f"Field_{page_index}_{int(rect.x0)}_{int(rect.y0)}"
        widget.field_label = tooltip or widget.field_name
        widget.text_fontsize = float(font_size)
        widget.text_color = list(hex_to_rgb_float(text_color_hex))
        if fill_color_hex:
            widget.fill_color = list(hex_to_rgb_float(fill_color_hex))
        if border_color_hex:
            widget.border_color = list(hex_to_rgb_float(border_color_hex))
        widget.border_width = 1.0

        kind = field_type.lower().strip()
        if kind == "text":
            widget.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
            widget.field_value = default_value
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
        elif kind == "signature":
            widget.field_type = pymupdf.PDF_WIDGET_TYPE_SIGNATURE
        else:
            raise ValueError(f"Unsupported form field type: {field_type}")

        if read_only:
            widget.field_flags |= pymupdf.PDF_FIELD_IS_READ_ONLY

        page.add_widget(widget)
        return doc.tobytes(garbage=2, deflate=True)
    finally:
        doc.close()


def fill_form_fields(
    pdf_bytes: bytes,
    values: Dict[str, Any],
    page_index: Optional[int] = None,
) -> bytes:
    """Fill one or more AcroForm fields by `field_name` (or `xref` string) and update appearances."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        pages = [page_index] if (page_index is not None and 0 <= page_index < len(doc)) else range(len(doc))
        for p_idx in pages:
            page = doc[p_idx]
            for w in page.widgets() or []:
                key_name = w.field_name
                key_xref = str(w.xref)
                if key_name in values or key_xref in values:
                    new_val = values[key_name] if key_name in values else values[key_xref]
                    if w.field_type in (pymupdf.PDF_WIDGET_TYPE_CHECKBOX, pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON):
                        if isinstance(new_val, bool):
                            w.field_value = new_val
                        else:
                            w.field_value = str(new_val).lower() in ("true", "1", "yes", "on")
                    else:
                        w.field_value = str(new_val)
                    w.update()
        return doc.tobytes(garbage=2, deflate=True)
    finally:
        doc.close()


def update_form_field(
    pdf_bytes: bytes,
    page_index: int,
    xref: int,
    field_name: Optional[str] = None,
    value: Optional[Any] = None,
    bbox: Optional[List[float]] = None,
    choices: Optional[List[str]] = None,
    read_only: Optional[bool] = None,
    text_color_hex: Optional[str] = None,
    fill_color_hex: Optional[str] = None,
    font_size: Optional[float] = None,
) -> bytes:
    """Update properties or value of an existing AcroForm field widget."""
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    try:
        page = doc[page_index]
        for w in page.widgets() or []:
            if int(w.xref) == int(xref):
                if field_name is not None:
                    w.field_name = field_name
                if bbox and len(bbox) == 4:
                    w.rect = pymupdf.Rect(bbox)
                if choices is not None and w.field_type == pymupdf.PDF_WIDGET_TYPE_COMBOBOX:
                    w.choice_values = choices
                if text_color_hex:
                    w.text_color = list(hex_to_rgb_float(text_color_hex))
                if fill_color_hex:
                    w.fill_color = list(hex_to_rgb_float(fill_color_hex))
                if font_size is not None:
                    w.text_fontsize = float(font_size)
                if read_only is not None:
                    if read_only:
                        w.field_flags |= pymupdf.PDF_FIELD_IS_READ_ONLY
                    else:
                        w.field_flags &= ~pymupdf.PDF_FIELD_IS_READ_ONLY
                if value is not None:
                    if w.field_type in (pymupdf.PDF_WIDGET_TYPE_CHECKBOX, pymupdf.PDF_WIDGET_TYPE_RADIOBUTTON):
                        w.field_value = (
                            value if isinstance(value, bool) else str(value).lower() in ("true", "1", "yes", "on")
                        )
                    else:
                        w.field_value = str(value)
                w.update()
                break
        return doc.tobytes(garbage=2, deflate=True)
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

