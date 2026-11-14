# Vellum PDF Pro — Real-World GEICO Form Validation Report

## 1. Original Fixture Audit & Integrity

- **Source Fixture**: `tests/fixtures/PROVIDER APP REQ FORM (2).pdf`
- **Recorded SHA-256 Checksum**:
  `5a5610e843eac0c59823fbf45af47238ca0d1c694173d3cc2bcc227f29caea46`
- **Byte-for-Byte Preservation**: Verified before and after all automated API, rendering, and GUI tests.
- **Structural Inspection (PyMuPDF + pikepdf)**:
  - **Pages**: 1 (`612.0 × 792.0 pt`, US Letter, rotation `0°`)
  - **Existing AcroForm Widgets**: `0` (`pikepdf` `/AcroForm` absent)
  - **XFA**: `False`
  - **Annotations**: `0`
  - **Vector Drawings**: `75` (10 light-blue shaded entry boxes, thin black borders, 14-row/column grid lines for the `VEHICLE SERVICES PROVIDED` matrix, and 2 grey-shaded `N/A` regions)
  - **Fonts / Images**: `3` embedded fonts, `0` raster images

---

## 2. Static Field Detection & AcroForm Conversion (Scenario B)

- **Endpoint**: `POST /api/docs/{doc_id}/forms/detect-candidates` (verified SHA-256 non-mutating).
- **Detected Fields**: **34 out of 34** legitimate entry areas detected with unique, descriptive names and zero `N/A` or label false positives:
  - **10 Primary Entry Fields**:
    1. `business_name` (`text`)
    2. `business_address` (`text`)
    3. `mailing_address` (`text`)
    4. `telephone` (`text`)
    5. `email` (`text`)
    6. `contact_name` (`text`)
    7. `coverage_area` (`multiline`)
    8. `number_of_trucks` (`text`)
    9. `name_of_digital_software` (`text`)
    10. `other_office_locations` (`multiline`)
  - **24 Vehicle Services Matrix Checkboxes**:
    - Rows: `AUTO`, `AUTO-MEDIUM DUTY`, `MOTORCYCLE`, `RV-MEDIUM DUTY`, `RV-HEAVY DUTY` × Columns: `ROAD SERVICE`, `TOWING`, `ACCIDENT`, `SECONDARY` (`20` checkboxes)
    - Rows: `LONG HAUL TRUCKING-MEDIUM`, `LONG HAUL TRUCKING-HEAVY` × Columns: `ACCIDENT`, `SECONDARY` (`4` checkboxes)
    - **Excluded Cells (`N/A`)**: All 4 grey-shaded `N/A` cells under `ROAD SERVICE` and `TOWING` for Long Haul Trucking rows were preserved untouched and **not** converted into fields.
- **Fields Not Automatically Converted**: None — all 34 interactive entry areas on the GEICO form were detected and converted automatically. (Note: printed helper captions such as `STREET ADDRESS / UNIT / CITY / STATE / ZIP`, `(IF APPLICABLE)`, and footer submission instructions are static labels and were intentionally left untouched.)

---

## 3. Original vs. Finished Fillable & Completed PDFs

- **Generated Output Artifacts** (in git-ignored `tests/output/`):
  - Blank interactive AcroForm version: `tests/output/GEICO_Application_Fillable.pdf`
  - Fictional sample completed version: `tests/output/GEICO_Application_Completed_Sample.pdf`
  - GUI-saved & reopened version: `tests/output/GEICO_Application_GUI_Verified.pdf`
- **Comparison**:
  - **Original**: Static vector PDF (`0` interactive widgets, `0` `/AcroForm`).
  - **Fillable (`GEICO_Application_Fillable.pdf`)**: `34` standards-compliant AcroForm widgets (`#000000` Helvetica `11 pt` default text, transparent fill/border preserving original light-blue boxes and table borders), full `Tab`/`Shift+Tab` order, drag/resize handles in Prepare Form mode, and zero alteration to static text or vector lines.
  - **Completed (`GEICO_Application_Completed_Sample.pdf`)**: Filled with fictional test data (`Example Coastal Roadside LLC`, `123 Example Street...`, `555-0100`, `example@example.com`, `Test User`, multiline `coverage_area` & `other_office_locations`, and 7 vehicle-service checkboxes). Zero clipping, zero duplicated text, zero overlapping fields.

---

## 4. Cross-Viewer Compatibility Summary

| Viewer / Engine | Tested? | Result |
| :--- | :--- | :--- |
| **Vellum PDF Pro (Packaged Linux AppImage)** | Yes (`verify_geico_form_gui.cjs` on `release/Vellum_PDF_Pro-1.0.0-x86_64.AppImage`) | Switched to **Forms → Prepare Form → Detect Fields**, verified **Accept All (34)** / **Confirm Selected (34)** / **Cancel** toolbar controls & 34 `.form-candidate-box` overlays, converted all 34 widgets, filled directly in **Fill Form** mode, saved, and reopened cleanly. |
| **PyMuPDF (`fitz`)** | Yes (`test_geico_form_validation.py`) | Verified 34 widgets, saved field values, checkbox states, and preserved static labels/footer. |
| **pypdfium2** | Yes (`test_geico_form_validation.py`) | Rendered completed form at `1.5×` scale cleanly (`>800×1000 px`). |
| **Poppler (`pdftotext` & `pdftoppm`)** | Yes (`test_geico_form_validation.py`) | `pdftotext` preserved all static text; `pdftoppm -png -r 120` rendered all filled text and checkbox marks cleanly with zero clipping. |
| **GNOME Document Viewer (`evince`)** | Not installed | Not available in this environment (`which evince` empty). |
| **Adobe Acrobat Reader** | Not installed | Not available on Linux in this environment. Manual check: open `tests/output/GEICO_Application_Completed_Sample.pdf` in Acrobat Reader on Windows/macOS to confirm `/NeedAppearances` & widget AP streams render identically. |

---

## 5. Screenshots

- Original GEICO form: `docs/screenshots/geico-original.png`
- Detected candidate overlays (34 green dashed overlays): `docs/screenshots/geico-detected-candidates.png`
- Accepted interactive AcroForm fields: `docs/screenshots/geico-accepted-fields.png`
- Filled form in Vellum PDF Pro: `docs/screenshots/geico-filled.png`
- Saved & reopened form verifying persistence: `docs/screenshots/geico-reopened.png`

---

## 6. Remaining Limitations

- **Dynamic XFA Forms**: Detected and preserved non-destructively with a user warning, but XFA JavaScript/FormCalc execution and dynamic XFA template rendering remain unsupported.
- **AcroForm Calculation Scripts & Flattening**: `/AA` / `/CO` JavaScript calculation actions and one-click form flattening are not yet implemented.
- **External Desktop Viewers**: `evince` and Adobe Acrobat Reader were not installed in this Linux test environment and were not directly executed.

