# Release Notes — Vellum PDF Pro v1.0.0-beta.1

**Release Tag**: `v1.0.0-beta.1`  
**License**: GNU Affero General Public License v3.0 (GNU AGPL-3.0)  
**Date**: November 10, 2026  
**Architecture**: Linux x86_64

---

## Highlights

Vellum PDF Pro `v1.0.0-beta.1` is the first public beta release of an offline, full-featured Linux desktop PDF editor designed to provide true document modification comparable to Adobe Acrobat Pro.

Unlike lightweight PDF viewers that draw opaque annotations over existing text, Vellum PDF Pro directly inspects and modifies PDF content streams, embedded TrueType glyph tables, cross-reference tables, and interactive AcroForms.

---

## Release Artifacts & SHA-256 Checksums

| Package | Format | File Size | SHA-256 Checksum |
| :--- | :--- | :--- | :--- |
| **Debian / Ubuntu / Mint** | `.deb` | `450 MB` | `7413afc2256e326193e85e141f35bf078d47d307ea378ca14238bc17c639768a` |
| **Standalone AppImage** | `.AppImage` | `389 MB` | `14daf8733fe17c0a087ddfd633139b1ac7b6548ec260171bb45a9de6b03aad58` |

Both packages are completely self-contained, bundling the Electron desktop shell, a standalone CPython 3.11 runtime, and all required Python processing engines. **No manual virtual environment setup or npm installation is required.**

---

## Installation

### Ubuntu / Debian / Linux Mint (`.deb`)
```bash
sudo dpkg -i vellum-pdf-pro_1.0.0_amd64.deb
vellum-pdf-pro
```

### Universal Linux AppImage (`.AppImage`)
```bash
chmod +x Vellum_PDF_Pro-1.0.0-x86_64.AppImage
./Vellum_PDF_Pro-1.0.0-x86_64.AppImage
```

---

## Core Capabilities in Beta 1

- **Direct Content Editing**: Click-to-edit text with original font re-encoding, TrueType subset fallback, and image replace/crop.
- **Page Operations**: Rotate (90°/180°/270°), reorder, duplicate, extract, split, and merge.
- **Form Filling & Designer**: AcroForm text, checkbox, dropdown, and signature fields.
- **X.509 Cryptographic Signatures**: Offline 2048-bit RSA PKCS#7 detached digital signing and tamper verification.
- **Permanent Redaction**: Purges sensitive text and pixel streams completely via level-4 garbage collection.
- **Offline Neural OCR**: Bundled RapidOCR ONNX models for instant searchable text embedding without cloud connectivity.
- **Document Export**: PDF to Word (`.docx`), Excel tables (`.xlsx`), HTML, and plain text.
- **Safe Save & Crash Recovery**: Atomic saving with `.bak` backups and real-time session journaling.

---

## Known Limitations

1. **Multi-Column Text Reflow**: In-place text editing modifies existing text spans and bounding boxes cleanly. Large paragraph additions do not yet automatically reflow across column or page margins.
2. **TrueType Subset Glyph Merging**: When typing characters outside an existing subsetted font, the editor automatically applies a metric-matched standard font with a clear notification rather than synthesizing new glyph outlines into the subset table.
3. **DOCX Import**: Converting `.docx` to `.pdf` requires system-installed `libreoffice-core`.

---

## Feedback & Bug Reports

Please report issues, document compatibility questions, or feature requests via GitHub Issues.

