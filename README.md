<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="resources/branding/vellum-wordmark-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="resources/branding/vellum-wordmark-light.svg">
    <img alt="Vellum PDF Pro" src="resources/branding/vellum-wordmark-dark.svg" width="460">
  </picture>
</p>

<p align="center">
  <strong>Professional Offline Linux Desktop PDF Editor</strong><br>
  <em>Direct content stream editing, embedded font glyph synthesis, PKCS#12 digital signatures, and neural OCR.</em>
</p>

<p align="center">
  <a href="https://www.gnu.org/licenses/agpl-3.0"><img src="https://img.shields.io/badge/License-AGPL_v3-blue.svg" alt="License: AGPL v3"></a>
  <img src="https://img.shields.io/badge/Platform-Linux%20x86__64-orange.svg" alt="Platform: Linux">
  <img src="https://img.shields.io/badge/Engine-PyMuPDF%20%7C%20pikepdf%20%7C%20pyHanko-green.svg" alt="Engine: PyMuPDF | pikepdf | pyHanko">
</p>

**Vellum PDF Pro** is a professional, full-featured Linux desktop PDF editor built to provide an offline, genuine document editing experience comparable in functionality to Adobe Acrobat Pro.

Unlike superficial PDF annotators that merely draw opaque rectangles over text, Vellum PDF Pro directly inspects and modifies PDF content streams, embedded font glyph tables, cross-reference tables, and interactive AcroForms.

---

## Key Features

- **Direct PDF Content Editing**:
  - Click and edit existing PDF text in-place without whiteout box masking.
  - Full font inspection: supports embedded TrueType fonts and subsetted fonts with graceful fallbacks.
  - Preserves tight line spacing (10.5pt leading on 12pt fonts) and adjacent zero-gap spans without erasing neighboring text.
  - Insert, move, resize, replace, and crop raster images.
  - Add vector shapes (rectangles, ellipses, arrows, lines) and manage URI/page hyperlinks.
- **Page Management & Reorganization**:
  - Insert blank pages, delete, duplicate, extract, and reorder pages via thumbnail cards.
  - Rotate pages (90° / 180° / 270°) with automatic coordinate remapping.
  - Merge multiple PDF documents or split pages by ranges into ZIP archives.
- **Annotation & Review**:
  - Highlight, underline, strikeout, sticky notes, freehand ink drawing, and standard PDF stamps (`APPROVED`, `CONFIDENTIAL`, `DRAFT`, etc.).
  - Comment sidebar navigation with author and timestamp metadata.
- **Interactive Forms & Digital Signatures**:
  - **Direct Form Filling**: Click directly into existing AcroForm fields (single-line text, multiline text, checkboxes, grouped radio buttons, dropdowns, and list boxes), navigate with `Tab` / `Shift+Tab`, auto-fit long entries, and save values into PDF appearance streams.
  - **Prepare Form Authoring**: Add new text, multiline, checkbox, radio, dropdown, list box, and signature fields; edit field properties (`required`, `read_only`, `multiline`, `max_length`, alignment, coordinates); duplicate/delete fields; reorder page tab order; and review candidate fields detected from static drawings.
  - **XFA Notice**: Dynamic XFA forms are detected and reported with a non-destructive notice banner (XFA script execution and dynamic XFA layout rendering are not supported).
- **Default Text Box Appearance**:
  - New text boxes default to `#000000` black, Helvetica, `11 pt`, left-aligned, transparent background, and no border, with **Save as Default** and **Reset Defaults** preferences in the Inspector.
  - Visual signatures (drawn or typed script).
  - Cryptographic X.509 digital signing with 2048-bit RSA keys and PKCS#7/CMS detached signatures.
  - Digital signature verification (tamper detection and digest check).
- **OCR & Document Conversion**:
  - Offline neural OCR (RapidOCR / Tesseract) embedding searchable, invisible text layers.
  - Multilingual OCR support (English, German, French, Spanish, Chinese, Multilingual).
  - Convert PDF to DOCX, HTML, plain text, and high-resolution image archives.
  - Extract structured tables into multi-sheet Excel (.xlsx) workbooks and CSV.
- **Security & Optimization**:
  - AES-128 / AES-256 password encryption with granular permissions (printing, modifying, extracting).
  - **Permanent Content Redaction**: Purges text, vector art, and raster pixels permanently from content streams using level-4 garbage collection.
  - Metadata sanitization (scrubs hidden XMP packets, Document Info, JavaScript actions).
  - PDF repair: rebuilds broken XREF tables and trailer dictionaries.
- **Professional Tools**:
  - Side-by-side visual and structural PDF comparison.
  - Dynamic headers, footers, watermarks, and Bates legal numbering.
  - Hierarchical table of contents (bookmarks) and file attachments.
  - PDF/A-2b archival preflight validation and conversion.

---

## Desktop Interface

Vellum PDF Pro features a clean, responsive Linux interface inspired by modern professional document workflows:
- **Top Menu Bar**: Native Linux menu (`File`, `Edit`, `View`, `Document`, `Tools`, `Window`, `Help`).
- **Main Ribbon**: Functional mode switcher (`Edit PDF`, `Annotate`, `Pages`, `Forms`, `Sign & Certify`, `OCR & Convert`, `Security & Redact`, `Pro & Compare`).
- **Left Sidebar**: Page thumbnails, bookmarks, comment lists, and attachments.
- **Central Canvas**: Real-time rendering with sub-pixel text overlays and zoom controls.
- **Right Inspector**: Context-sensitive properties panel that auto-expands on object selection.
- **Bottom Status Bar**: Active engine indicator, page count, dimensions, and zoom level.
- **Command Palette**: Searchable quick-action palette (`Ctrl+K` or `F1`).

---

## Installation & Distribution

### Linux Packages
Vellum PDF Pro is distributed as both a native Debian package (`.deb`) and an AppImage (`.AppImage`):

```bash
# Debian / Ubuntu / Linux Mint
sudo dpkg -i release/vellum-pdf-pro_1.0.0_amd64.deb

# Standalone AppImage
chmod +x release/Vellum_PDF_Pro-1.0.0-x86_64.AppImage
./release/Vellum_PDF_Pro-1.0.0-x86_64.AppImage
```

---

## Building from Source

### Prerequisites
- Linux OS (Ubuntu 22.04+, Debian 12+, Fedora 38+, Arch Linux)
- Node.js 20+ & npm
- Python 3.11+
- Tesseract OCR (optional, for OCR capabilities): `sudo apt install tesseract-ocr`
- LibreOffice (optional, for DOCX-to-PDF conversion): `sudo apt install libreoffice-core`

### Build Steps
```bash
# 1. Clone repository
git clone https://github.com/your-username/vellum-pdf-pro.git
cd vellum-pdf-pro

# 2. Set up Python virtual environment
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 3. Install Node.js frontend dependencies
npm install

# 4. Build production frontend bundle
npm run build

# 5. Build Debian and AppImage packages
npm run package:linux
```

---

## Testing

Run the automated test suite covering all PDF engines, font subsettings, line leadings, session encryption, and conversion endpoints:
```bash
npm run test:backend
```

---

## License

This project is licensed under the **GNU Affero General Public License v3.0 (GNU AGPL-3.0)**.  
See the [LICENSE](file:///home/zk/workspace/pdfedit/LICENSE) file for complete terms.

For third-party dependencies, copyright notices, and license texts, see [THIRD_PARTY_LICENSES.md](file:///home/zk/workspace/pdfedit/THIRD_PARTY_LICENSES.md).
