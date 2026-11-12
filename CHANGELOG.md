# Changelog

All notable changes to **Vellum PDF Pro** are documented in this file.  
The project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Fixed
- **Native Text Span Moving, Resizing, and Hyperlink Preservation**:
  - Permanently fixed regression where moving or resizing native PDF text spans caused text to disappear from the rendered canvas.
  - Corrected frontend payload parameter extraction in `commitObjectTransform`: explicitly bundles `text`, `font_name`, `font_size`, `color_hex`, `bold`, `italic`, `align`, and `orig_origin` to prevent empty text replacement.
  - Added robust server-side fallback and recovery in `backend/engine/direct_edit.py`: if caller omits text attributes, inspects existing page text spans dynamically to retrieve actual content, font family, size, color, and baseline origin.
  - Separated bounding box resizing from font size scaling: resizing a text span's selection frame preserves original font size, baseline, and glyph styling without unexpected magnification or text distortion.
  - Implemented atomic transformation verification: verifies text exists on target page after edit/transform; aborts atomically if missing to guarantee document integrity.
  - Synchronized intersecting hyperlink annotations: moving a hyperlinked text span automatically shifts and preserves corresponding `/Link` annotations and targets.
  - Added comprehensive automated regression tests verifying Helvetica, bold, italic, multiline text, embedded and subsetted fonts, rotated pages (0°, 90°, 180°, 270°), vector graphics/colored background overlap, undo/redo, and save/reopen persistence.

### Added
- **Professional Object Selection, Moving, Resizing & Manipulation System**:
  - Implemented single-click object selection for Vellum text boxes, vector shapes, embedded raster images, and native PDF text spans.
  - Added visible selection outline (`.object-selection-frame`) with eight interactive resize handles (`nw`, `n`, `ne`, `e`, `se`, `s`, `sw`, `w`) and live dimensions badge displaying width × height and origin (X, Y) in PostScript points.
  - Implemented fluid drag-to-move with live cursor position previews, page boundary clamping, and center-axis alignment snapping with visual dashed guide indicators (`.alignment-guide-line`).
  - Added eight-direction resize handles with minimum dimension safeguards (15 pt width, 10 pt height).
  - Added double-click to directly inline-edit text boxes on the canvas, opening the WYSIWYG editor without changing box identity.
  - Implemented keyboard arrow key nudging (1 pt standard, 10 pt with Shift), `Escape` key gesture cancellation and deselection, and `Delete` / `Backspace` removal.
  - Added full desktop clipboard operations: Cut (`Ctrl+X`), Copy (`Ctrl+C`), Paste (`Ctrl+V`), and Duplicate (`Ctrl+D` / context menu) with automatic +20 pt offset.
  - Added floating context menu (Edit Text, Cut, Copy, Paste, Duplicate, Delete, Properties).
  - Synchronized Properties Inspector with live X, Y, Width, and Height input fields, type-specific typography and shape styling controls, and on-demand commit actions.
  - Round-trip metadata persistence: stores and retrieves structured object parameters using private `VellumData` dictionary on `page.xref` via PyMuPDF without modifying standard rendering in third-party viewers.
  - Content stream glyph removal for transformed text boxes and spans using clean mid-x-height glyph redaction bands, leaving no whiteout rectangles, ghost text, or background artifacts.
  - Vector shape transformation using `PDF_REDACT_LINE_ART_REMOVE_IF_COVERED` clean line art redaction, redrawing shapes (rectangles, ellipses, lines, arrows) at updated positions and dimensions.
  - Automated undo and redo history tracking across all object moves, resizes, style updates, duplications, and deletions.
- **Official Branding Kit v2 Integration**:
  - Integrated official Vellum PDF Pro Branding Kit v2 throughout the application, Linux system packaging, and documentation.
  - Deployed the approved lighter cobalt-navy tile icon (`#285C97` → `#19477F` gradient) ensuring high contrast and sharp legibility for the dark-blue geometric "V" emblem across both light and dark desktop themes.
  - Implemented crisp SVG mark (`VellumMarkIcon`) in the frameless header brand badge, maintaining compact horizontal footprint (18×18 px) alongside application menus.
  - Enhanced About dialog with official 64×64 icon tile, bold typography, version status, GNU AGPL-3.0 licensing, engine stack specifications, and repository links.
  - Added deterministic vector rasterization utility (`scripts/generate_branding_assets.py`) generating complete standard icon resolutions: 16×16, 24×24, 32×32, 48×48, 64×64, 128×128, 256×256, 512×512, 1024×1024, multi-size `.ico`, and web favicons.
  - Configured Linux system integration: FreeDesktop `.desktop` file launcher icon, Ubuntu dock icon, task switcher, `/usr/share/icons/hicolor` hierarchy (16px to 512px + scalable SVG), `/usr/share/pixmaps` legacy fallback, and AppImage `.DirIcon`.
  - Added theme-responsive GitHub README header banner with automatic dark and light wordmark switching via SVG `<picture>` elements.
- **Integrated Frameless Linux Desktop Window**:
  - Eliminated the separate OS title bar on Linux desktops (`frame: false`), uniting window controls, document caption, menus, search, command palette, and theme options into a single compact header.
  - Added integrated desktop window controls (Minimize, Maximize / Restore with dynamic icon switching, Close with red hover highlight).
  - Implemented secure Electron IPC channels (`vellum:window-minimize`, `vellum:window-toggle-maximize`, `vellum:window-close`, `vellum:window-is-maximized`) preserving context isolation without exposing raw Node or Electron APIs.
  - Configured precise draggable regions (`-webkit-app-region: drag`) and non-draggable interactive bounds (`-webkit-app-region: no-drag`) to prevent drag interference with menus, search inputs, tabs, or canvas interactions.
  - Supported native double-click-to-maximize behavior across Wayland (Mutter) and X11 compositors.
  - Verified responsive layouts across 1520×940, 1280×800, and minimum 1024×680 dimensions in both dark and light desktop themes.
- **Inline Text Box Editor**:
  - Replaced unsupported browser `prompt()` dialog in "Add Text Box" with a WYSIWYG interactive `.inline-textbox-overlay` directly on the PDF canvas stage.
  - Floating toolbar with `Insert` (`Ctrl+Enter`), `Cancel` (`Esc`), and keyboard hints.
  - Right Context-Sensitive Properties Inspector (`right-inspector`) for live modification of font family (Helvetica, Times Roman, Courier, DejaVu Sans), font size, hex color, text alignment (Left, Center, Right, Justify), bold, italic, and point coordinates (X, Y, Width, Height).
  - Word-wrapping support using PyMuPDF `page.insert_textbox` with automatic height overflow expansion.
  - Full coordinate space and rotation handling for 0°, 90°, 180°, and 270° rotated PDF pages.
- **Native Hyperlink Creation Modal**:
  - Replaced browser `prompt()` dialog for "Add Hyperlink" with non-blocking React modal dialog with keyboard shortcuts (`Enter` / `Esc`) and URL validation.
- **Unified Single Desktop Menu Bar**:
  - Eliminated redundant native GTK menu bar on Linux desktop (`mainWindow.setMenuBarVisibility(false)`).
  - Preserved native accelerator event routing and added standard desktop clipboard roles (Cut, Copy, Paste, Select All).
  - Polished in-app React menu bar as the single primary navigation header across File, Edit, View, Document, Tools, Window, and Help.

### Fixed
- **About Dialog Bundled Asset Resolution & Transparency**:
  - Fixed broken image icon and `ERR_FILE_NOT_FOUND` in About Vellum PDF Pro modal caused by root-relative web path (`/branding/vellum-app-icon.png`) when loading under Electron's `file://` protocol.
  - Converted logo reference to a Vite-bundled module asset import (`import vellumAppIcon from './assets/branding/vellum-app-icon.png'`), generating reliable relative asset paths across both development and packaged production environments.
  - Replaced bounding box shadow with CSS `filter: drop-shadow(0 4px 8px rgba(0, 0, 0, 0.25))` and `objectFit: 'contain'`, properly preserving squircle corner transparency without rectangular box-shadow clipping.
- **Ubuntu Desktop Launcher & Dock Integration**:
  - Added `StartupWMClass=vellum-pdf-pro` to the desktop entry file for both Debian and AppImage packages, ensuring instant window-to-launcher matching in Ubuntu dock and GNOME Shell.
  - Added Debian maintainer scripts (`DEBIAN/postinst` and `DEBIAN/postrm`) executing `gtk-update-icon-cache` and `update-desktop-database` on install and removal, ensuring Ubuntu displays updated cobalt-navy branding rather than stale cached icons.
  - Configured `app.setName('vellum-pdf-pro')` and runtime `mainWindow.setIcon()` in Electron main process.
- **Packaging Robustness**:
  - Added atomic unlinking (`rm -f "$APPIMAGE_OUT"`) prior to binary concatenation in `scripts/build_packages.sh` to prevent `Text file busy` (`ETXTBSY`) errors when building packages while an AppImage is active.
- **Automated Regression Coverage**:
  - Added comprehensive test suite in `tests/test_pdf_engine_and_api.py` validating multiline text wrapping, font styling, overflow expansion, margin notes, rotated pages, undo/redo, cancel immutability, and zero `prompt()`/`confirm()`/`alert()` browser dialog usage in `src/`.

### Fixed
- **Backend Startup Race Condition**:
  - Resolved `"Backend initialization warning: Failed to fetch"` and permanent `"Engine: Connecting..."` hang during cold application launch.
  - Extended Electron health polling timeout from 8 seconds to 45 seconds to accommodate cold-mount Squashfs module decompression.
  - Implemented 60-attempt frontend auto-retry loop with live connection status progress and interactive "Retry" / "Diagnostics" buttons.
- **Dynamic Port Selection & Multi-Instance Isolation**:
  - Implemented dynamic loopback port allocation (`isPortAvailable` / `findFreePort`) in Electron. Multiple running Vellum instances now allocate separate ports without port collisions or address conflicts.
- **Process Lifecycle & Orphan Prevention**:
  - Added Linux kernel `PR_SET_PDEATHSIG` parent-death signal monitoring in Python backend. If the parent process exits for any reason, the backend terminates immediately.
  - Multi-tier process termination with `SIGTERM` and `SIGKILL` watchdog in Electron.
- **Packaging Portability & CI Pipeline**:
  - Fixed `scripts/build_packages.sh` to dynamically resolve Python environments and runtime libraries (`PYTHON_BASE_PREFIX`, `PYTHON_PURELIB`).
  - Added automatic on-demand AppImage Type-2 runtime discovery and curl fallback for non-cached build environments.
  - Resolved tmpfs ramdisk quota exhaustion using hardlink payload staging and phased intermediate directory cleanup.
  - Added automated backend lifecycle and port isolation regression test suite (`tests/test_backend_startup_lifecycle.py`).

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

