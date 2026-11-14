# Vellum PDF Pro — Interactive PDF Form Support Report

## Executive Summary

Vellum PDF Pro now supports end-to-end **AcroForm detection, interactive form filling, form authoring (Prepare Form), tab-order management, text fitting/overflow warnings, and XFA detection** on Linux, backed by PyMuPDF + pikepdf and verified across both backend API tests and live Electron GUI tests.

---

## 1. Interactive PDF Form Detection (Phase 1)

- **AcroForm & Widget Inspection (`backend/engine/forms_signatures.py`)**:
  - `inspect_form_fields()` and `list_form_fields()` inspect `/AcroForm` and `/XFA` via `pikepdf` alongside PyMuPDF widget extraction.
  - Detects and normalizes **Text** (single-line & multiline), **Checkbox**, **Radio Button** (including grouped export values), **Dropdown (ComboBox)**, **List Box**, and **Signature** fields.
  - Extracts `xref`, `page_index`, `field_name`, `field_label`, `field_type`, `value`, `checked`, `export_value`, `choices`, normalized display `bbox`, `text_fontsize`, `text_font`, `text_color`, `fill_color`, `border_color`, `required`, `read_only`, `multiline`, `password_field`, `text_maxlen`, `align` (`/Q`), `tab_order`, and `has_appearance`.
  - **Static Graphics Separation**: Interactive form widgets are read strictly from PDF `/Annot` `/Widget` / `/AcroForm` dictionaries; static stroked rectangles or checkboxes drawn in content streams are never misclassified as interactive fields.
- **XFA Detection**:
  - `_detect_xfa_and_acroform()` checks `/AcroForm` for `/XFA` without mutating the PDF. When XFA is present, `GET /api/docs/{doc_id}/forms/inspect` returns `is_xfa: true` and an explicit `xfa_notice` banner displayed in the Forms UI.
- **Typed Backend Endpoint**:
  - `GET /api/docs/{doc_id}/forms/inspect` returns `acroform_present`, `is_xfa`, `xfa_notice`, `field_count`, and `fields`.

---

## 2. Direct Form Filling & Appearance Preservation (Phase 2)

- **On-Canvas Interactive Filling (`src/App.tsx`)**:
  - Clicking **Forms → Fill / Select** (or filling directly in **View** mode) renders interactive `<input>`, `<textarea>` (multiline), `<input type="checkbox">`, `<input type="radio">` (radio groups), `<select>` (dropdown), and `<select size={...}>` (list box) overlays aligned to widget coordinates.
  - **Keyboard Navigation**: `Tab` and `Shift+Tab` cycle through page widgets sorted by `tab_order`.
  - **Radio & Checkbox Persistence**: `fill_form_fields_with_report()` (`POST /api/docs/{doc_id}/forms/fill`) updates values by `field_name` or `xref`, calls `widget.update()` to regenerate PDF appearance streams, and records an atomic undo/redo snapshot.
- **Dual-Renderer Verification**:
  - Automated tests in `tests/test_forms_and_textbox_defaults.py` verify saved form values via both **PyMuPDF** widget inspection and **pypdfium2** independent rendering/extraction after save and reopen.

---

## 3. Text Fitting, Constraints & Warnings (Phase 3)

- `fill_form_fields_with_report()` enforces and reports:
  - `read_only`: Skips modification and emits a structured warning.
  - `max_length_exceeded`: Truncates input to `text_maxlen` and emits a warning.
  - `auto_fitted`: When `auto_fit=True` and text exceeds field width, scales font size down (to a `6.0 pt` minimum) to fit cleanly inside the widget bounds.
  - `text_overflow`: Warns when text still exceeds the widget bounding box even at minimum font size.
- The frontend displays fitting warnings in the Forms Inspector banner.

---

## 4. Form Authoring ("Prepare Form") & Field Candidate Assistant (Phase 4)

- **Authoring Tools (`src/App.tsx` + `backend/app.py`)**:
  - Toolbar tools for **+ Text**, **+ Multiline**, **+ Checkbox**, **+ Radio**, **+ Dropdown**, **+ List Box**, and **+ Signature** (`POST /api/docs/{doc_id}/forms/create`).
  - **Field Properties Inspector**: Edit `field_name`, `field_label`, `text_fontsize`, `align` (`left` / `center` / `right`), `required`, `read_only`, `multiline`, `max_length`, `choices`, and `bbox` (`PUT /api/docs/{doc_id}/forms/{xref}`), plus **Duplicate** (`POST /api/docs/{doc_id}/forms/{xref}/duplicate`) and **Delete** (`DELETE /api/docs/{doc_id}/forms/{xref}`).
  - **Tab Order Editor**: Move fields Up/Down per page (`POST /api/docs/{doc_id}/forms/tab-order`).
  - **Form Field Detection Assistant**: `POST /api/docs/{doc_id}/forms/detect-candidates` scans static vector drawings for candidate text boxes and checkboxes **without modifying PDF bytes** (SHA-256 invariant), letting the user review and convert individual candidates into real AcroForm fields.

---

## 5. Verification & Screenshots

- **Backend & API Tests**: `.venv/bin/pytest -v tests/test_forms_and_textbox_defaults.py` (**6 passed**) and full suite `.venv/bin/pytest -q tests/` (**33 passed, 0 failed**).
- **Electron GUI Verification**: `DISPLAY=:0 node scripts/verify_forms_and_textbox_defaults_gui.cjs` verified opening `test_docs/02_interactive_form.pdf`, detecting all 5 widgets, typing into text inputs, `Tab` navigation, toggling checkboxes, saving filled values, and capturing:
  - `docs/screenshots/forms-before-fill.png`
  - `docs/screenshots/forms-after-fill.png`

---

## 6. Known Limitations (Honest Scope)

- **Dynamic XFA Forms**: XFA packets are detected and preserved untouched with a non-destructive user warning (`is_xfa: true`), but Vellum PDF Pro does **not** execute XFA JavaScript/FormCalc scripts or render dynamic XFA XML templates.
- **Form Flattening & AcroForm Calculation Scripts**: Automatic AcroForm JavaScript calculation/validation scripts (`/AA` / `/CO`) and dedicated one-click "Flatten Form Fields" export are not yet implemented.

