# Vellum PDF Pro — Form Save Integrity & Safe Save Workflow Report

## Root Cause Analysis

1. **BUG 1 (`Save PDF` discarded unsaved form field values)**:
   - User keystrokes and checkbox/radio/select changes in `.form-widget-box` updated React's in-memory `formDraftValues` state only.
   - `handleSave()` called `pdfApi.saveDoc(...)` directly without committing `formDraftValues` to the backend PDF document first, writing the stale/empty backend PDF bytes and then overwriting `formDraftValues` during `refreshDocState()`.
2. **BUG 2 (`Apply Field Changes` erased entered data)**:
   - Clicking **Apply Field Changes** (or moving/resizing/duplicating/deleting a widget) called `pdfApi.updateFormField(...)` and `refreshDocState(...)` without committing `formDraftValues` first, overwriting `formDraftValues` from the stale backend state.
   - Additionally, PyMuPDF's `widget.field_name = ...; widget.update()` did not update `/T` or `/TU` when the widget referenced a separate `/Parent` field dictionary, causing field renames to revert on save.
3. **BUG 3 (`Save PDF` lacked a safe first-save `_filled.pdf` workflow)**:
   - When a PDF had an existing `file_path`, `handleSave(false)` bypassed the native Save As dialog and overwrote the original file (with `.bak`).

---

## Implemented Architecture & Fixes

1. **Authoritative Form State Synchronization (`src/App.tsx`)**:
   - Added synchronous refs (`formDraftValuesRef`, `formDirtyRef`, `savedTargetDocsRef`) alongside reactive `formDirtyByDoc` state so rapid edits followed immediately by `Save PDF` never read stale React closures.
   - Added `commitPendingFormValues(docId)` and invoked it automatically before:
     - `handleSave()` (if committing fails, the save aborts safely without touching disk or discarding user input)
     - `Apply Field Changes`, widget drag-move, widget resize, `Duplicate`, `Delete`, and mode switches (`Fill Form` ↔ `Prepare Form` ↔ `Edit PDF`)
   - Updated `refreshDocState()` so uncommitted `formDraftValues` are never clobbered while `formDirtyRef.current[docId]` is true.
   - Added `formDirtyByDoc[doc.doc_id]` to the tab `.dirty-dot` indicator for immediate unsaved-changes feedback.
2. **Field Rename & Property Persistence (`backend/engine/forms_signatures.py`)**:
   - Updated `update_form_field()` to resolve `/Parent` when present and write `/T`, `/TU`, and `/Ff` directly onto the owning field dictionary while preserving `widget.field_value` and regenerating appearance streams (`w.update()`).
3. **Safe Save / Save As Workflow (`src/App.tsx`, `electron/main.cjs`)**:
   - On first save (or explicit **Save As** / `Ctrl+Shift+S`), `handleSave()` opens Electron's native Save As dialog (`showOverwriteConfirmation`) defaulting to the original directory and `<stem>_filled.pdf` (e.g., `PROVIDER APP REQ FORM (2)_filled.pdf`).
   - Canceling the Save As dialog preserves all in-memory edits and leaves the source PDF untouched.
   - Subsequent **Save** (`Ctrl+S` / `Save PDF`) writes atomically via temp file + `fsync` + `os.replace` to the chosen destination without re-prompting, and updates the active tab/window title to the saved filename.
   - Added a **Save As** button alongside **Save PDF** in the top header.

---

## Verification Results

- **Backend & Cross-Viewer Suite (`.venv/bin/pytest -q tests/`)**: **35 passed, 0 failed** (including `test_apply_field_changes_preserves_values_and_undo_redo` and `test_geico_real_world_detection_creation_fill_and_cross_viewer` in [test_geico_form_validation.py](file:///home/zk/workspace/pdfedit/tests/test_geico_form_validation.py)).
- **TypeScript & Frontend Build (`npx tsc --noEmit && npm run build`)**: Exited `0`.
- **Packaged Linux AppImage GUI Verification (`DISPLAY=:0 node scripts/verify_form_save_integrity_gui.cjs`)**:
  - Tested against `release/Vellum_PDF_Pro-1.0.0-x86_64.AppImage`:
    - Verified `.dirty-dot` appears immediately on form input.
    - Verified **Apply Field Changes** preserves all 10 text/multiline values and 7 checkboxes without clicking **Save Filled Values**.
    - Verified mode switching (`Fill Form` → `Edit PDF` → `Forms`) preserves entered values.
    - Verified first **Save PDF** suggests `PROVIDER APP REQ FORM (2)_filled.pdf`, **Cancel** preserves edits without writing, **Save PDF** writes `_filled.pdf` without touching **Save Filled Values**, rapid edit + second **Save PDF** writes directly without re-prompting, **Save As** prompts and writes custom path, and reopening `_filled.pdf` retains every entered value.
    - Verified original fixture SHA-256 unchanged (`5a5610e843eac0c59823fbf45af47238ca0d1c694173d3cc2bcc227f29caea46`).
- **Screenshots**:
  - `docs/screenshots/geico-save-fix-before-apply.png`
  - `docs/screenshots/geico-save-fix-after-apply.png`
  - `docs/screenshots/geico-save-fix-after-save.png`
  - `docs/screenshots/geico-save-fix-reopened.png`

