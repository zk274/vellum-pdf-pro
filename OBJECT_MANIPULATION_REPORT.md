# Vellum PDF Pro — Object Selection, Moving, Resizing, and Manipulation Report

**Date:** November 11, 2026  
**Application:** Vellum PDF Pro  
**Module:** Interactive Canvas, Object Transformation Engine & Metadata Persistence  

---

## Executive Summary

Vellum PDF Pro has been enhanced with a complete, professional **Object Manipulation System** comparable in usability and precision to Adobe Acrobat Pro. Users can now select, move, resize, format, duplicate, and delete text boxes, vector shapes, embedded images, and native PDF text spans directly on the interactive document canvas.

The system features:
1. **Single-click Selection**: Immediate selection of text boxes, vector shapes, images, and text spans with high-contrast selection frames.
2. **Eight-direction Resizing**: Visible bounding box with 8 resize handles (`nw`, `n`, `ne`, `e`, `se`, `s`, `sw`, `w`) and live dimensions badge (`Width × Height pt` and `X, Y`).
3. **Fluid Drag-to-Move**: Smooth mouse drag repositioning with live coordinate feedback, page boundary safeguards, and intelligent center-axis snapping guides.
4. **Direct Inline Editing**: Double-click on any text box to edit its text and typography inline without recreating the object or losing formatting.
5. **Precision Keyboard Nudging**: Arrow keys nudge by 1 pt; Shift + Arrow keys nudge by 10 pt. `Escape` cancels active transformations or deselects; `Delete` / `Backspace` removes objects.
6. **Desktop Clipboard & Context Menu**: Full support for Cut (`Ctrl+X`), Copy (`Ctrl+C`), Paste (`Ctrl+V`), Duplicate (`Ctrl+D`), and right-click floating context menu.
7. **Properties Inspector Synchronization**: Two-way synchronization between canvas gestures and the right Properties Inspector (numeric X, Y, Width, Height fields and styling controls).
8. **Round-Trip Metadata Persistence**: Document page dictionary persistence (`VellumData` on `page.xref`) ensuring editable text boxes and vector shapes remain fully manipulable across export, save, and reopen cycles while rendering normally in standard third-party PDF viewers.
9. **Clean Content Stream Hygiene**: Glyphs and vector line art are removed without destructive whiteout boxes or ghost text artifacts.
10. **Full Undo / Redo Tracking**: Every move, resize, duplicate, and delete operation is captured in the document history session for instant undo and redo.

---

## Visual Verification & Screenshots

Three high-resolution screenshots were captured from the packaged Linux application running the automated CDP test harness:

1. **Object Selection & Eight Resize Handles**  
   File: `docs/screenshots/object-selected-handles.png`  
   Demonstrates the single-click selection frame, 8 resize handles, dimensions badge (`226 × 70 pt (X: 87, Y: 87)`), and active Properties Inspector.

2. **Fluid Drag-to-Move & Live Snapping Preview**  
   File: `docs/screenshots/object-drag-move.png`  
   Demonstrates mouse dragging of the selected object with live coordinate updates and dashed alignment guide snapping.

3. **Resized, Repositioned, and Saved Document State**  
   File: `docs/screenshots/object-resized-saved.png`  
   Demonstrates the committed transformation after resizing and repositioning, reflecting clean PDF content stream rendering and persistent object metadata.

---

## Architecture & Implementation Details

### 1. Object Model & Representation

| Object Type | Representation in PDF | Storage & Persistence | Transformation Strategy |
| :--- | :--- | :--- | :--- |
| **Vellum Text Box** (`textbox`) | Content stream text block (`BT...ET` via `page.insert_textbox`) | Private `VellumData["boxes"]` JSON metadata dictionary stored on `page.xref` | `_remove_glyphs` strips previous glyphs; redraws text at `new_bbox`; updates `VellumData["boxes"]` |
| **Vellum Vector Shape** (`shape`) | Direct PDF vector drawing commands (`re`, `c`, `l`, `f`, `s`) | Private `VellumData["shapes"]` JSON metadata dictionary stored on `page.xref` | `page.apply_redactions(graphics=PDF_REDACT_LINE_ART_REMOVE_IF_COVERED)` removes previous line art; redraws shape; updates `VellumData` |
| **Embedded Image** (`image`) | XObject image stream (`/Do`) | Native PDF resource dictionary XObject | `page.clean_contents()`, content stream transformation matrix repositioning or delete |
| **Direct Text Span** (`text_span`) | Native content stream text run | Native PDF content stream | Clean mid-x-height glyph removal (`_remove_glyphs`) without whiteout rectangles, re-inserted at updated position |

### 2. PDF Page Metadata Persistence (`VellumData`)

To enable text boxes and shapes created in Vellum to remain first-class movable and resizable objects across session reopens and external saves, the backend engine attaches a private PDF string to the page object dictionary:

```python
def _get_page_vellum_data(doc: pymupdf.Document, page: pymupdf.Page) -> Dict[str, Any]:
    raw = doc.xref_get_key(page.xref, "VellumData")[1]
    # Parse structured JSON dictionary containing "boxes" and "shapes" lists
    ...

def _set_page_vellum_data(doc: pymupdf.Document, page: pymupdf.Page, data: Dict[str, Any]) -> None:
    json_str = json.dumps(data)
    doc.xref_set_key(page.xref, "VellumData", pymupdf.get_pdf_str(json_str))
```

**Key Advantages:**
- **Zero Third-Party Disruption:** Standard PDF viewers (Acrobat, Evince, PDF.js, Preview, Chrome) ignore non-standard dictionary keys and render the native content stream text and line art perfectly.
- **Permanent Round-Trip Fidelity:** Upon reopening a saved PDF in Vellum PDF Pro, `inspect_page_objects()` reads `VellumData` and immediately surfaces all boxes and shapes with selection handles, exact font names, colors, and border widths.
- **Safe Fallback:** If a PDF was edited in a third-party application that stripped page metadata, Vellum falls back to direct text span selection and glyph-level stream editing.

### 3. Unified Transformation API Endpoint

`POST /api/docs/{doc_id}/pages/{page_index}/transform-object`

**Request Schema (`TransformObjectRequest`):**
```json
{
  "object_id": "vbox_1731384000123_456",
  "object_type": "textbox",
  "action": "move",
  "orig_bbox": [100.0, 150.0, 300.0, 210.0],
  "new_bbox": [150.0, 250.0, 350.0, 310.0],
  "text": "Executive Summary",
  "font_name": "helv",
  "font_size": 14.0,
  "color_hex": "#1d4ed8",
  "bold": true,
  "italic": false,
  "align": "left"
}
```

**Actions Supported:**
- `move` / `transform`: Update bounding box and/or styling.
- `duplicate`: Clones the object with a +20 pt offset and assigns a fresh ID.
- `delete`: Cleanly removes the object from both the content stream and page metadata.
- `update_style`: Updates typography, colors, or stroke properties.

Each transformation automatically registers an undo/redo checkpoint in the `SessionManager`.

### 4. Interactive Frontend Gesture System

- **Active Gesture Tracking:** A global `mousemove` and `mouseup` listener is dynamically attached only while dragging or resizing, calculating accurate PostScript point deltas (`(clientX - startClientX) / zoom`).
- **Snapping Guides:** When dragging objects within 5 pt of page horizontal or vertical center axes, coordinates automatically snap and render red dashed alignment guide lines (`.alignment-guide-line.guide-x` and `.guide-y`).
- **Keyboard Handling:** Arrow keys nudge the active selection (1 pt standard, 10 pt with Shift). `Escape` cancels active transformations or deselects. `Delete` / `Backspace` removes the object. `Ctrl+C`, `Ctrl+X`, `Ctrl+V`, and `Ctrl+D` manage desktop clipboard workflows.

---

## Technical Limitations & Trade-Offs

1. **Non-Vellum Flattened Documents:** Text in third-party PDFs where characters are rendered as individual disconnected spans or outlined curves cannot always be grouped into a single multiline paragraph box without heuristic OCR / layout reconstruction. For such text, Vellum's direct text span editor operates on the individual span.
2. **Complex Embedded Graphics:** Grouped compound paths containing intertwined clipping masks, shading patterns, or raster image masks cannot always be individually moved without affecting the overall layer clipping. Vellum isolates standalone vector shapes and standalone raster images cleanly.
3. **Minimum Dimensions Safeguard:** To prevent bounding box inversion during rapid corner resizing, minimum constraints of 15 pt width and 10 pt height are enforced.

---

## Verification & Test Results

### Automated Backend Tests
Full pytest execution in `.venv/bin/pytest -v tests/`:
```
tests/test_backend_startup_lifecycle.py::test_health_endpoints_and_caching PASSED
tests/test_backend_startup_lifecycle.py::test_custom_port_and_cli_flag PASSED
tests/test_backend_startup_lifecycle.py::test_multi_instance_backend_isolation PASSED
tests/test_backend_startup_lifecycle.py::test_packaged_runtime_path_resolution PASSED
tests/test_backend_startup_lifecycle.py::test_clean_process_shutdown PASSED
tests/test_pdf_engine_and_api.py::test_health_and_showcase_lifecycle PASSED
tests/test_pdf_engine_and_api.py::test_crash_recovery_journal PASSED
tests/test_pdf_engine_and_api.py::test_direct_text_editing_preserves_background_without_white_rectangle PASSED
tests/test_pdf_engine_and_api.py::test_subset_font_fallback_detection PASSED
tests/test_pdf_engine_and_api.py::test_direct_image_shapes_and_hyperlinks_editing PASSED
tests/test_pdf_engine_and_api.py::test_page_management_operations PASSED
tests/test_pdf_engine_and_api.py::test_annotations_and_review_workflow PASSED
tests/test_pdf_engine_and_api.py::test_forms_and_cryptographic_digital_signatures PASSED
tests/test_pdf_engine_and_api.py::test_offline_ocr_and_all_document_conversions PASSED
tests/test_pdf_engine_and_api.py::test_security_encryption_permanent_redaction_and_optimization PASSED
tests/test_pdf_engine_and_api.py::test_pro_features_compare_watermarks_bates_bookmarks_attachments_and_pdfa PASSED
tests/test_pdf_engine_and_api.py::test_direct_edit_embedded_and_subsetted_fonts_deep_verification PASSED
tests/test_pdf_engine_and_api.py::test_session_encryption_persistence_and_export_get PASSED
tests/test_pdf_engine_and_api.py::test_corrupted_pdf_graceful_recovery_and_repair PASSED
tests/test_pdf_engine_and_api.py::test_textbox_inline_editing_wrapping_coordinates_and_lifecycle PASSED
tests/test_pdf_engine_and_api.py::test_object_selection_moving_resizing_and_persistence PASSED

21 passed in 24.32s
```

### End-to-End GUI Testing (CDP Automation)
`scripts/test_object_manipulation_gui.cjs`:
- Launched packaged Electron desktop application on Ubuntu.
- Verified backend reached `Ready (Offline)` status.
- Opened Showcase PDF and created an inline multiline text box.
- Verified single-click selection and presence of all 8 resize handles.
- Executed drag-to-move gesture and verified coordinate movement.
- Executed resize gesture via `.handle-se` and verified expanded dimensions.
- Verified Arrow nudging.
- Successfully captured all three required visual verification screenshots.

### Packaging Verification
`scripts/build_packages.sh`:
- Frontend build: `vite build` completed cleanly (362 kB JS, 16 kB CSS).
- Debian installer: `release/vellum-pdf-pro_1.0.0_amd64.deb` (450 MB).
- AppImage installer: `release/Vellum_PDF_Pro-1.0.0-x86_64.AppImage` (389 MB).
- Checksums: `release/SHA256SUMS` verified.

---

## Files Modified & Created

| File | Change Summary |
| :--- | :--- |
| `backend/engine/direct_edit.py` | Added `_get_page_vellum_data`, `_set_page_vellum_data`, `transform_object()`, and updated `add_text_object`, `add_shape_object`, `inspect_page_objects` for `VellumData` persistence. |
| `backend/app.py` | Added `TransformObjectRequest` schema and `@app.post("/api/docs/{doc_id}/pages/{page_index}/transform-object")` endpoint. |
| `src/types.ts` | Added `VellumBoxObject`, `VellumShapeObject`, `TransformObjectRequest`, `SelectedManipulableObject`, and updated `PageObjectsData`. |
| `src/api.ts` | Added `transformObject()` client method. |
| `src/styles.css` | Added styling for `.vellum-box-overlay`, `.vellum-shape-overlay`, `.object-selection-frame`, `.object-selection-body`, 8 `.resize-handle` classes, `.selection-dimension-badge`, `.alignment-guide-line`, and `.object-context-menu`. |
| `src/App.tsx` | Implemented selection, drag move, 8-handle resize, inline double-click editing, keyboard nudging/shortcuts, context menu, alignment guides, and Properties Inspector synchronization. |
| `tests/test_pdf_engine_and_api.py` | Added `test_object_selection_moving_resizing_and_persistence` validating move, resize, duplicate, delete, undo, redo, and round-trip export/reopen persistence. |
| `scripts/test_object_manipulation_gui.cjs` | CDP test script verifying GUI selection, dragging, resizing, and screenshot capture. |
| `docs/screenshots/` | Generated `object-selected-handles.png`, `object-drag-move.png`, and `object-resized-saved.png`. |
| `CHANGELOG.md` | Documented the Object Selection, Moving, Resizing, and Manipulation feature set. |
| `OBJECT_MANIPULATION_REPORT.md` | Comprehensive architectural report and verification summary. |

---

*Report prepared and verified on Linux desktop.*
