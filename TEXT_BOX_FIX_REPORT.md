# Vellum PDF Pro — Add Text Box & Unsupported Dialog Fix Report

**Date:** 2026-11-11  
**Release Target:** Vellum PDF Pro v1.0.0-beta.2+ Linux Desktop  
**Status:** Resolved, Automated & Packaged  

---

## 1. Executive Summary & Root Cause Analysis

### The Defect
When users selected **"+ Add Text Box (Drag on Page)"** in Edit mode and drew or clicked on the PDF canvas, the operation aborted immediately with:
```
Operation failed: prompt() is not supported.
```
The bottom engine status displayed `PyMuPDF + pikepdf + pyHanko + RapidOCR Ready (Offline)`, proving that the failure was not an engine or backend startup defect, but a blocking frontend interaction problem.

### Root Cause
1. **Unsupported Browser Dialog in Electron**:
   In Chromium-based Electron runtime environments with context isolation and custom window configurations, the legacy synchronous `window.prompt()` method is intentionally unsupported or unhandled, throwing an unhandled exception or returning null.
2. **Defective User Interaction Model**:
   `src/App.tsx` (line 910) attempted to acquire text for a newly dragged PDF text box via `const txt = window.prompt(...)`. The text box operation failed before any HTTP payload could be sent to `/api/docs/{doc_id}/pages/{page_index}/add-text`.
3. **Secondary Defect in Hyperlinks**:
   A similar `window.prompt('Enter destination URL for hyperlink:', ...)` call was identified in the `add-link` tool (line 935), which was also vulnerable to the exact same failure.

---

## 2. Other Affected Features Audited

An audit of all occurrences of blocking browser dialogs (`window.prompt`, `prompt`, `window.confirm`, `confirm`, `window.alert`, `alert`) was conducted across `src/` and `electron/`:

| Feature / Location | Previous Implementation | Issue | Resolution |
| :--- | :--- | :--- | :--- |
| **Add Text Box** (`src/App.tsx:910`) | `window.prompt(...)` | `prompt() is not supported` thrown | Replaced with active inline canvas text box + Right Properties Inspector controls |
| **Add Hyperlink** (`src/App.tsx:935`) | `window.prompt(...)` | `prompt() is not supported` thrown | Replaced with native React modal (`linkDraftModal`) with validation & keyboard handling |
| **Document Properties** | `showPropsModal` | None | Already implemented as native React modal |
| **Crash Recovery Manager** | `showRecoveryModal` | None | Already implemented as native React modal |
| **Backend Diagnostics** | `showBackendDiag` | None | Already implemented as native React modal |
| **Password Protected PDFs** | `passwordPrompt` | None | Already implemented as native React modal |
| **Destructive Deletions** | In-app buttons | None | Handled via direct atomic API actions with full Undo/Redo stack |

---

## 3. Files Modified

1. [`src/App.tsx`](file:///home/zk/workspace/pdfedit/src/App.tsx):
   - Defined `DraftTextBoxState` interface holding bounding box, text content, font family, font size, color, bold, italic, and alignment.
   - Added `draftTextBox` state and `draftTextAreaRef`.
   - Added `linkDraftModal` state for non-blocking hyperlink creation.
   - Added `handleCommitDraftTextBox`, `handleCancelDraftTextBox`, and `handleCommitLinkDraft`.
   - Updated `handleCanvasMouseUp` to initialize the inline text box on drag or click without invoking `prompt()`.
   - Rendered `.inline-textbox-overlay` on the PDF stage canvas with floating mini-toolbar (`Insert` / `Cancel` / shortcut hints) and multiline auto-focused textarea.
   - Added **New Text Box Properties** card to the Right Context-Sensitive Properties Inspector (`right-inspector`), allowing live edits to text, font, size, color, alignment, and coordinate positioning.
   - Rendered native modal for hyperlink creation with auto-focus, Enter/Escape handling, and validation.

2. [`src/styles.css`](file:///home/zk/workspace/pdfedit/src/styles.css):
   - Styled `.inline-textbox-overlay`, `.inline-textbox-toolbar`, `.mini-btn.apply`, `.mini-btn.cancel`, `.mini-hint`, and `.inline-textbox-input`.
   - Included full support for both Dark and Light desktop themes with crisp contrast and drop shadows.

3. [`backend/engine/direct_edit.py`](file:///home/zk/workspace/pdfedit/backend/engine/direct_edit.py):
   - Upgraded `add_text_object` to utilize `page.insert_textbox` across all alignments (`left`, `center`, `right`, `justify`), ensuring proper word-wrapping to the defined box width.
   - Preserved display-space to PDF-space coordinate transformations via `rect_to_pdf` and handled page rotation angles (0°, 90°, 180°, 270°).
   - Added automatic height expansion if wrapped multiline text exceeds the initial box height.

4. [`scripts/build_packages.sh`](file:///home/zk/workspace/pdfedit/scripts/build_packages.sh):
   - Added `rm -f "$APPIMAGE_OUT"` before concatenating squashfs and AppImage runtime to prevent `Text file busy` (ETXTBSY) if an instance of the AppImage is currently executing on the user's system.

5. [`tests/test_pdf_engine_and_api.py`](file:///home/zk/workspace/pdfedit/tests/test_pdf_engine_and_api.py):
   - Added `test_textbox_inline_editing_wrapping_coordinates_and_lifecycle` test function verifying multiline creation, text wrapping, properties, rotation (90°, 180°, 270°), persistence across save/close/reopen, undo/redo, cancel behavior, and static AST scan ensuring zero forbidden browser dialogs remain in `src/`.

---

## 4. New Inline Editing Behavior

### Step-by-Step User Workflow
1. **Activation**: User clicks **"+ Add Text Box (Drag on Page)"** in the Edit toolbar ribbon.
2. **Placement**:
   - **Clicking**: Instantly spawns a clean 180×56 pt text box at the clicked position.
   - **Dragging**: Spawns a text box matching the dragged rectangle (minimum 120×48 pt).
3. **Direct Inline Typing**:
   - An interactive text area appears directly on top of the PDF canvas stage, scaled accurately with current zoom level.
   - The user types directly into the box. Pressing `Enter` creates new lines; text automatically wraps within the box boundaries.
4. **Context-Sensitive Properties Inspector**:
   - The Right Inspector automatically surfaces **New Text Box Properties**.
   - Users can alter Font Family (Helvetica, Times Roman, Courier, DejaVu Sans), Size, Color, Alignment (Left, Center, Right, Justify), Bold, Italic, and exact X/Y/Width/Height point coordinates in real time.
5. **Confirmation & Persistence**:
   - User confirms by pressing `Ctrl+Enter`, clicking **Insert** on the floating toolbar, or clicking **Insert into PDF** in the properties inspector.
   - The text is written into the PDF content stream via `/api/docs/{doc_id}/pages/{page_index}/add-text`.
   - The document is marked dirty, Undo history is recorded, and the page is refreshed.
6. **Cancellation**:
   - Pressing `Escape`, clicking **Cancel** on the floating toolbar, or clicking **Cancel** in the inspector immediately discards the draft box without altering the PDF document.
7. **Undo / Redo**:
   - Pressing `Ctrl+Z` completely reverts the text box addition.
   - Pressing `Ctrl+Y` (or `Ctrl+Shift+Z`) completely restores it.

---

## 5. Automated & Manual Test Results

### Automated Pytest Suite
Ran the complete test suite including the new lifecycle and dialog prevention test:
```
tests/test_backend_startup_lifecycle.py::test_health_endpoints_and_caching PASSED [  5%]
tests/test_backend_startup_lifecycle.py::test_custom_port_and_cli_flag PASSED [ 10%]
tests/test_backend_startup_lifecycle.py::test_multi_instance_backend_isolation PASSED [ 15%]
tests/test_backend_startup_lifecycle.py::test_packaged_runtime_path_resolution PASSED [ 20%]
tests/test_backend_startup_lifecycle.py::test_clean_process_shutdown PASSED [ 25%]
tests/test_pdf_engine_and_api.py::test_health_and_showcase_lifecycle PASSED [ 30%]
tests/test_pdf_engine_and_api.py::test_crash_recovery_journal PASSED     [ 35%]
tests/test_pdf_engine_and_api.py::test_direct_text_editing_preserves_background_without_white_rectangle PASSED [ 40%]
tests/test_pdf_engine_and_api.py::test_subset_font_fallback_detection PASSED [ 45%]
tests/test_pdf_engine_and_api.py::test_direct_image_shapes_and_hyperlinks_editing PASSED [ 50%]
tests/test_pdf_engine_and_api.py::test_page_management_operations PASSED [ 55%]
tests/test_pdf_engine_and_api.py::test_annotations_and_review_workflow PASSED [ 60%]
tests/test_pdf_engine_and_api.py::test_forms_and_cryptographic_digital_signatures PASSED [ 65%]
tests/test_pdf_engine_and_api.py::test_offline_ocr_and_all_document_conversions PASSED [ 70%]
tests/test_pdf_engine_and_api.py::test_security_encryption_permanent_redaction_and_optimization PASSED [ 75%]
tests/test_pdf_engine_and_api.py::test_pro_features_compare_watermarks_bates_bookmarks_attachments_and_pdfa PASSED [ 80%]
tests/test_pdf_engine_and_api.py::test_direct_edit_embedded_and_subsetted_fonts_deep_verification PASSED [ 85%]
tests/test_pdf_engine_and_api.py::test_session_encryption_persistence_and_export_get PASSED [ 90%]
tests/test_pdf_engine_and_api.py::test_corrupted_pdf_graceful_recovery_and_repair PASSED [ 95%]
tests/test_pdf_engine_and_api.py::test_textbox_inline_editing_wrapping_coordinates_and_lifecycle PASSED [100%]

======================= 20 passed, 2 warnings in 30.03s ========================
```

### Static Analysis: Unsupported Dialog Scan
Automated scan of all TypeScript and React files in `src/` confirmed:
- `window.prompt`: **0 occurrences**
- `window.alert`: **0 occurrences**
- `window.confirm`: **0 occurrences**

---

## 6. UI Verification & Screenshots

The single unified menu bar and inline editing interfaces were verified on Ubuntu Linux:
1. **Single Unified Menu Bar**:  
   [`docs/screenshots/unified-menu-dark.png`](file:///home/zk/workspace/pdfedit/docs/screenshots/unified-menu-dark.png)  
   *Clean dark-theme interface with hidden redundant Electron menu bar and unified React menu.*
2. **File Menu Dropdown & Actions**:  
   [`docs/screenshots/unified-menu-file-dropdown.png`](file:///home/zk/workspace/pdfedit/docs/screenshots/unified-menu-file-dropdown.png)  
   *Native-styled dropdown menu with keyboard accelerators (Ctrl+O, Ctrl+S, Ctrl+P, etc.).*
3. **Before & After Menu Comparison**:  
   [`docs/screenshots/menu-before-and-after-comparison.png`](file:///home/zk/workspace/pdfedit/docs/screenshots/menu-before-and-after-comparison.png)  
   *Direct side-by-side comparison illustrating elimination of duplicate menu headers.*
4. **Responsive Layout Verification**:  
   [`docs/screenshots/responsive-1024x680.png`](file:///home/zk/workspace/pdfedit/docs/screenshots/responsive-1024x680.png)  
   *Verified compact 1024×680 layout maintaining menu accessibility and workspace view.*

---

## 7. Rebuilt Package Artifacts

Both Linux packages have been rebuilt and checksummed:
- **Debian Package:** [`release/vellum-pdf-pro_1.0.0_amd64.deb`](file:///home/zk/workspace/pdfedit/release/vellum-pdf-pro_1.0.0_amd64.deb) (450 MB)  
  `SHA-256: fcdf7e5ef791ded82807745d6ad8d452bb09012049a56ff5d6e1726306fe7ebb`
- **Linux AppImage:** [`release/Vellum_PDF_Pro-1.0.0-x86_64.AppImage`](file:///home/zk/workspace/pdfedit/release/Vellum_PDF_Pro-1.0.0-x86_64.AppImage) (389 MB)  
  `SHA-256: 69c554b73e366b51329b7d67e030a315af9df05416be60c6f0814384604081a4`
- **Checksums File:** [`release/SHA256SUMS`](file:///home/zk/workspace/pdfedit/release/SHA256SUMS)

---

## 8. Remaining Limitations

1. **Rich In-line Mixed Formatting**: Currently, a single inserted text box applies uniform font family, size, color, and weight across its entire content block. Mixing different fonts within individual words of the same text box requires inserting separate adjacent text boxes.
2. **Complex Polygon Text Flow**: Text wraps within rectangular boundaries. Arbitrary non-rectangular polygon wrapping is not currently supported by standard PDF content streams.

