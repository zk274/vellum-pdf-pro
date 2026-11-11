# Vellum PDF Pro — Technical Architecture, Library Assessment & Roadmap

## 1. Overview

**Vellum PDF Pro** is an offline-first Linux desktop PDF editor providing direct PDF content editing, page organization, annotation & review, interactive AcroForm authoring, cryptographic PKCS#12/X.509 digital signing, offline neural OCR, permanent security redaction, multi-format conversion, visual/text document comparison, and PDF/A archival tools.

## 2. Technology Stack & Licensing Evaluation

### 2.1 Desktop Runtime: Electron 43 + React 19 + TypeScript + Python 3.11 Sidecar
- **Why Electron + Python 3.11 Hybrid Sidecar**:
  - **Linux Build Portability**: Tauri 2 requires C development headers (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libsoup-3.0-dev`, `pkg-config`) on the build host. Electron uses prebuilt Chromium + Node runtimes and builds `.AppImage` and `.deb` packages without requiring root privileges or system `-dev` headers.
  - **Rendering Precision**: Chromium's Skia compositor delivers consistent high-DPI canvas rendering across X11 and Wayland without WebKit2GTK's fractional-scaling blurriness.
  - **Native PDF Capabilities**: Python 3.11 provides direct C/C++ bindings to the industry's strongest PDF manipulation engines (`PyMuPDF`, `pikepdf`/`libqpdf`, `pyHanko`, `pypdfium2`, `RapidOCR`/`ONNXRuntime`, `pdf2docx`, `pdfplumber`).

### 2.2 PDF Engine Library Matrix
| Component | Library | License | Role |
| :--- | :--- | :--- | :--- |
| **Content Stream & Rendering** | `PyMuPDF` (`pymupdf` 2.1) | AGPL-3.0 | Page rasterization, text/image extraction, surgical content stream editing (`fill=False`), annotations, AcroForms, redactions |
| **Secondary Renderer** | `pypdfium2` (5.15.2) | Apache-2.0 / BSD | Permissive-licensed PDFium rendering & bitmap verification |
| **Structural & Encryption Engine** | `pikepdf` (10.18.0 / `libqpdf30`) | MPL-2.0 | Lossless structural manipulation, AES-256 (`R=6`) encryption, permissions, linearization, metadata sanitization, PDF repair |
| **Cryptographic Signatures** | `pyHanko` (0.38.1) + `cryptography` | MIT | PKCS#12 (`.p12`/`.pfx`) X.509 CMS detached `/ByteRange` digital signing, self-signed cert generation, and signature verification |
| **Offline OCR Engine** | `rapidocr-onnxruntime` (1.4.4) + `pytesseract` | Apache-2.0 | Neural offline OCR (PP-OCRv4) + invisible searchable PDF text layer (`render_mode=3`) injection |
| **Conversions & Table Extraction** | `pdf2docx`, `python-docx`, `pdfplumber`, `openpyxl`, `LibreOffice` | MIT / GPL-3.0 / MPL-2.0 | PDF ↔ DOCX, PDF → XLSX/CSV tables, PDF → HTML/Text/Images, Images → PDF |
| **Archival & PDF/A** | `Ghostscript` (`gs`) + `pikepdf` | AGPL-3.0 / MPL-2.0 | PDF/A-2b conversion and XMP conformance metadata validation |

## 3. Direct PDF Editing Engine (`backend/engine/direct_edit.py`)

Unlike viewers that mask old text with opaque white boxes:
1. **Text Span Extraction**: Extracts every text block, line, and span (`page.get_text("dict")`) with exact `[x0, y0, x1, y1]` bounding box, baseline `origin [x, y]`, font name, font size, RGB hex color, and style flags.
2. **True Content Stream Glyph Removal**: When editing, moving, or deleting an existing text span, Vellum PDF Pro applies a surgical glyph removal filter with `fill=False`, `images=PDF_REDACT_IMAGE_NONE`, and `graphics=PDF_REDACT_LINE_ART_NONE`. Only the character glyphs in the `BT ... ET` content stream are removed; colored backgrounds, table borders, gradients, and images underneath remain 100% intact.
3. **Font Mapping & Subset Fallback**: Writes updated text at the exact baseline origin or new coordinates. If the original span used a subsetted embedded font that lacks glyphs for newly entered characters, the engine maps to a metric-compatible TrueType font (`DejaVuSans`, `DejaVuSerif`, `DejaVuSansMono`) or Base-14 font and returns `fallback_used: true` with a clear warning message in the UI.
4. **Image Object Manipulation**: Supports moving, resizing, rotating, cropping, replacing (`page.replace_image`), and deleting (`page.delete_image`) existing embedded images by `xref` and bounding box.

