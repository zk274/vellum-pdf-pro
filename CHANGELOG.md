# Changelog

All notable changes to **Vellum PDF Pro** are documented in this file.  
The project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0-beta.1] — 2026-11-10

### Initial Public Beta Release

This is the first public beta release of **Vellum PDF Pro**, an offline-first Linux desktop PDF editor built with Electron, React, TypeScript, and a native hybrid PDF processing backend powered by PyMuPDF, pikepdf, pyHanko, and RapidOCR.

### Added
- **Direct PDF Content Stream Editing**:
  - In-place editing of existing PDF text blocks with automatic font re-encoding (`_encode_with_original_font`).
  - Font fallback engine (`resolve_pdf_font`) with TrueType subset detection (`fontTools.ttLib`).
  - Selective glyph removal (`_remove_glyphs`) using mid-x-height bands (`[44%, 56%]`) to prevent erasing adjacent lines on tight vertical leading (10.5pt leading on 12pt text) and zero-gap horizontal neighbor spans.
  - Directional vector math (`_detect_span_dir`) supporting upright text editing on rotated pages (90°, 180°, 270°).
  - Raster image placement, moving, deletion, resizing, and aspect-ratio cropping with soft-mask (SMask) extraction.
  - Vector shape drawing (rectangles, ellipses, lines, directional arrows) and URI/GOTO hyperlink management.
- **Page Organization**:
  - Page thumbnail rail with drag-and-drop reordering, rotation (90°/180°/270°), deletion, duplication, extraction, and page size modifications.
  - Multi-document merging and range-based PDF splitting into ZIP archives.
- **Annotations & Review**:
  - Native PDF highlight, underline, strikeout, sticky notes, freehand ink paths, and standard stamps (`APPROVED`, `CONFIDENTIAL`, `DRAFT`, etc.).
  - Comment list sidebar with author and timestamp navigation.
- **Interactive Forms & Digital Signatures**:
  - AcroForm field filling and interactive widget creation (`text`, `checkbox`, `dropdown`, `signature`).
  - Visual signatures (freehand canvas drawing or script typography).
  - Cryptographic X.509 digital signing with offline 2048-bit RSA keys and PKCS#7/CMS detached signatures (`pyHanko`).
  - Signature integrity verification (tamper detection and digest check).
- **OCR & Document Conversions**:
  - Offline neural OCR (`RapidOCR` with bundled ONNX models / `Tesseract`) embedding searchable, invisible text layers directly into PDF streams.
  - PDF to Word (`.docx`), HTML, plain text (`.txt`), and high-resolution image ZIP extraction.
  - PDF table extraction into multi-sheet Excel (`.xlsx`) workbooks and CSV.
- **Security & Optimization**:
  - AES-128 / AES-256 password encryption with permission flags (print, modify, extract, annotate).
  - Permanent content redaction with level-4 garbage collection (`garbage=4, clean=True`) purging text, vector art, and raster image pixels completely from PDF object streams.
  - Metadata sanitization (scrubbing hidden XMP packets, Document Info, JavaScript actions).
  - PDF structural repair rebuilding broken cross-reference (XREF) tables and trailer dictionaries.
- **Professional Tools**:
  - Side-by-side visual and structural document comparison.
  - Header and footer stamping with dynamic page count (`{page}`, `{total}`) and title macros.
  - Watermarking and legal Bates numbering.
  - Hierarchical table of contents (bookmarks) and embedded file attachments.
  - PDF/A-2b archival preflight validation and conversion.
- **Packaging & Desktop Shell**:
  - Genuinely self-contained Debian package (`.deb`, 450 MB) bundling Electron `v43.4.1`, embedded CPython 3.11 runtime, and all 74 required Python wheels.
  - Standalone Linux AppImage (`.AppImage`, 389 MB) with AppRun launcher and universal zlib/gzip SquashFS compression.
  - Native Linux menu bar, dark/light theme toggle, and keyboard command palette (`Ctrl+K` / `F1`).

### Changed
- Relicensed distribution under the **GNU Affero General Public License v3.0 (GNU AGPL-3.0)** in compliance with PyMuPDF copyleft terms.
- Updated `pdf2docx` dependency to `v0.5.13`, verifying its official relicensing from GPL to MIT.
- Polished properties inspector to auto-expand upon clicking any selectable text span or image.
- Replaced unstyled browser `window.prompt` dialog with an integrated, dark-themed password decryption modal.
- Enhanced `safe_save` to write atomically via `.vellum_save_*.pdf` with automatic `.bak` backup creation.
