# Vellum PDF Pro — Scanned & Hybrid Form Detection Report

## 1. Root Cause

Previously, `detect_form_field_candidates()` in `backend/engine/forms_signatures.py` relied exclusively on native PDF vector rectangles (`page.get_drawings()`) and native text (`page.get_text("dict")`). On image-based / scanned PDFs (such as Pages 1–6 and 8–14 of `NNSDFILLABLEAPP (1).pdf`, which contain raster images and `0` extractable text characters) or vector-outlined forms (Page 7), `get_text("dict")` returned zero spans and `get_drawings()` returned only page-frame clips, causing Prepare Form to report *"No static box/checkbox candidates detected"*.

---

## 2. Hybrid Stage A / B / C Architecture

Implemented in `backend/engine/forms_signatures.py` (`detect_form_field_candidates_detailed` / `_detect_scanned_page_candidates`) and exposed via `POST /api/docs/{doc_id}/forms/detect-candidates`:

- **Stage A — Existing AcroForm Widgets**: Inspects `page.widgets()` first, records `existing_widgets_count`, and seeds `existing_rects` + `used_names` so no duplicate candidates are proposed over existing widgets (e.g., W-9 Page 1).
- **Stage B — Native PDF Geometry**: Detects shaded boxes, table matrices (with `N/A` exclusion), horizontal answer underlines (skipping underlined headings/prose), and empty stroke grids (e.g., NSD Page 16 landscape rate table).
- **Stage C — Offline Scanned / Outlined Page Vision + RapidOCR**:
  - Renders non-text / image-based pages locally at `175 DPI`.
  - Runs offline neural OCR via existing `rapidocr_onnxruntime` (`_get_rapid_ocr()`).
  - Extracts printed square checkboxes via OpenCV contour analysis (`cv2.findContours`, aspect ratio & hollow-interior filtering) and groups `Yes`/`No` pairs into mutually exclusive `radiobutton` groups.
  - Extracts horizontal answer underlines via OpenCV morphological opening (`cv2.morphologyEx`, `MORPH_OPEN`), excluding underlined headings/titles and full-width section dividers, placing fields cleanly above each line without covering labels.
  - Detects open writing areas (`COMMENTS` / `NOTES`) as `multiline` fields and classifies `signature`, `date`, `multiline`, `checkbox`, `radiobutton`, and `text`.

All processing runs 100% locally offline with zero external uploads.

---

## 3. Libraries Reused

- `pymupdf` (`fitz`) — PDF inspection, rendering, widget creation & AP stream generation
- `pikepdf` — AcroForm / XFA / tab-order structural operations
- `rapidocr_onnxruntime` — Offline PP-OCRv4 text recognition
- `opencv-python-headless` (`cv2`) + `numpy` — Morphological line extraction & hollow-square checkbox detection

---

## 4. Fixture Inspection & Detection Results

### Original Fixtures (Unchanged SHA-256)
- **NSD Application**: `tests/fixtures/NNSDFILLABLEAPP (1).pdf` (16 pages, SHA-256: `a7a56cc0536e4476b6a3e7c27bb81a6bcb4deb09f7c77c19252759f70bd9973e`)
- **IRS W-9 Comparison**: `tests/fixtures/W9 Form - March 2024 (1) (3) (1).pdf` (6 pages, SHA-256: `2d420cbb4123dcf1fb82595b2359cfbb5d81f00b9df9d359fcc7af361d093f53`)

### NSD Application Page Summary (Representative Verified Pages)
| Page(s) | Content Type | Detection Stage | Candidates | Notes |
| :--- | :--- | :--- | :--- | :--- |
| **Page 1** | Scanned/Image (0 native chars) | Stage C (`ocr`) | **37** | Business info underlines (`legal_business_name`, `doing_business_as_dba`, `business_address`, `city`, `state`, `zip`, phones, fax, email, website, years, tax ID, license, mailing, owner/manager) + checkboxes |
| **Page 2** | Scanned/Image (0 native chars) | Stage C (`ocr`) | **70** | Yes/No radio/checkboxes, payment methods, towing & service capabilities, fleet unit underlines |
| **Page 3** | Scanned/Image (9 native chars) | Stage C (`ocr`) | **9** | Service area checkboxes, `COMMENTS`, acknowledgement `Name` / `Date` |
| **Page 5–6** | Contract Prose | `none` | **0** | Dense contract paragraphs cleanly ignored (0 false positives) |
| **Page 7** | Vector-Outlined Signatures | Stage C (`ocr`) | **6** | `COMPANY` & `PROVIDER` `By` (signature), `Name`, `Title` |
| **Page 14** | ACH Direct Deposit Form | Stage B/C (`hybrid`) | **14** | Company, ISP #, Email, Checking checkbox, Depository, Branch, City, State, ABA Routing, Account, Owner Name, Date, Signature |
| **Page 15** | Example ACORD 25 Thumbnail | `none` | **0** | Sample certificate image guarded against false-positive extraction |
| **Page 16** | Landscape Rate Table (native) | Stage B (`geometry`) | **17** | `Name of Business`, rate table cells, `Signature` |

### W-9 Regression Results
- **Page 1**: `existing_widgets_count = 23`, `detection_mode = "existing_acroform"`, `0` duplicate candidates proposed.
- **Pages 2–6**: `0` false-positive candidates on dense IRS instruction pages.

---

## 5. Verification & Screenshots

- **Scanned & W-9 Backend Suite**: `.venv/bin/pytest -v tests/test_scanned_form_detection.py` (**2 passed** — PyMuPDF + `pypdfium2` dual verification, separate `NNSDFILLABLEAPP_fillable.pdf` save/reopen, unchanged SHA-256).
- **Packaged AppImage GUI Verification**: `DISPLAY=:0 node scripts/verify_scanned_form_detection_gui.cjs` exited `0` (`ALL SCANNED NSD FORM DETECTION & FILLING GUI CHECKS PASSED!`).
- **Screenshots**:
  - `docs/screenshots/nsd-original.png`
  - `docs/screenshots/nsd-detected-candidates.png`
  - `docs/screenshots/nsd-accepted-fields.png`
  - `docs/screenshots/nsd-filled.png`
  - `docs/screenshots/nsd-reopened.png`

---

## 6. Remaining Limitations & Unsupported Types

- **Dynamic XFA Forms**: Detected and preserved non-destructively with a warning banner, but dynamic XFA script execution/rendering is not supported.
- **Radio Button Export Values on Newly Created Widgets**: PyMuPDF assigns default `/Yes` / `/Off` widget states on newly added radio buttons; grouping multiple radio widgets under the same `field_name` works, while custom `/On` state names may require AcroForm dictionary tuning in external viewers.
- **Multi-Page CPU OCR Latency**: Scanning all 16 image-based pages sequentially runs RapidOCR locally on CPU (~3–4s per scanned page); users can monitor progress and cancel at any time via **Detect All Pages** → **Cancel Detection**.

