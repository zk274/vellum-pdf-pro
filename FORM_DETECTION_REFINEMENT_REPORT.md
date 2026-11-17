# Form Detection Accuracy, Navigation, Performance & Document Lifecycle Refinement Report

**Project:** Vellum PDF Pro (`/home/zk/workspace/pdfedit`)  
**Branch:** `feat/interactive-forms`  
**Primary Regression Fixture:** `tests/fixtures/NNSDFILLABLEAPP (1).pdf` (16-page NSD Independent Service Provider Application, SHA-256 `a7a56cc0536e4476b6a3e7c27bb81a6bcb4deb09f7c77c19252759f70bd9973e`, untouched)  
**Retained Regression Fixtures:**  
- `tests/fixtures/PROVIDER APP REQ FORM (2).pdf` (GEICO Application Request, SHA-256 `5a5610e843eac0c59823fbf45af47238ca0d1c694173d3cc2bcc227f29caea46`, untouched)  
- `tests/fixtures/W9 Form - March 2024 (1) (3) (1).pdf` (IRS W-9, SHA-256 `2d420cbb4123dcf1fb82595b2359cfbb5d81f00b9df9d359fcc7af361d093f53`, untouched)

---

## 1. Final NSD Accuracy Audit — Root Causes & Fixes

1. **Page 16 (`Name of Business` Logo Overlap & 121-Cell Grid Audit — `backend/engine/forms_signatures.py`)**
   - **Root Cause:** The loose horizontal-line detector ran after the line-grid table detector and interpreted the table's top border (`y = 103.25`) as an underline, placing `name_of_business` above the table (`[51.1, 88.2, 738.5, 102.2]`) overlapping the NSD logo (`[50.4, 57.7, 240.3, 92.9]`), while the merged `Name of Business:` row (`ry0=103.25, ry1=121.45`) was skipped because intermediate column dividers (`197.0..437.6`) did not span that top row.
   - **Fix:** Recorded `grid_table_bounds` and suppressed loose `h_lines` on/inside detected grid tables; added explicit merged-row placement for `Name of Business:` inside `Rect(138.1, 104.4, 496.5, 120.3)` (right of the `Name of Business:` label, bounded by the `497.5` vertical divider).
   - **Verified:** `121` total cells (`Name of Business` + `110` rate-table cells + `10` `Initial` cells), `logo_hits = []`, `pair_overlaps = 0`.

2. **Page 4 (Opening Paragraph Inline Blanks vs. Agreement Prose — `backend/engine/forms_signatures.py`)**
   - **Root Cause:** RapidOCR merged the entire opening-paragraph lines into wide spans, causing `text_on_line` and `colliding_ocr` to suppress all 4 genuine inline blanks (`this ____ day of ______, 20__` and `and ____________ on behalf of itself`), and `lw < 24.0` dropped the short `day` (`20.6 pt`) and `year` (`15.2 pt`) underlines.
   - **Fix:** Measured OpenCV `thresh` ink density directly above each horizontal line (`ink_above < 0.03` over `[ly0-11..ly0-2]`), allowed `14.0..24.0 pt` lines with inline date/day/year hints, and derived concise semantic labels (`Effective Day`, `Effective Month`, `Effective Year`, `Provider Name`), while still rejecting underlined headings and prose.

3. **Pages 8, 13 & 14 False Positives Eliminated (`backend/engine/forms_signatures.py`)**
   - **Page 8:** Eliminated false positive `1.` (`Services.` underlined heading) via OpenCV `ink_above < 0.03`.
   - **Page 13:** Eliminated false positive `checkbox iv.` by excluding Roman numeral list markers (`i..x`) when no option/stem companion exists.
   - **Page 14:** Eliminated phantom `Text Field 1` (`[97.8, 708.0, 524.4, 722.7]`) by skipping unlabeled bare vector rectangles on scanned (`len(text_spans) == 0`) pages.

4. **Page 2 Yes/No Radio Button `export_value` & Persistence (`backend/engine/forms_signatures.py`, `backend/app.py`, `src/App.tsx`)**
   - **Root Cause:** `create_form_field` initialized unchecked radio buttons with `widget.field_value = False`, which caused PyMuPDF to create `/AP /N /False` (`on_state = 'False'`) instead of `'Yes'`/`'No'`; `confirmFormCandidatesList` did not forward `c.export_value`; and `list_form_fields` treated `"no"` as unchecked (`val.lower() not in (..., "no", "")`).
   - **Fix:** Added `export_value` end-to-end (`CreateFormFieldRequest` -> `create_form_field` -> `confirmFormCandidatesList`), initialized radio `/AP /N /<export_value>` before setting unselected state to `False`, updated `fill_form_fields_with_report` to match `key_xref` or `on_state`, and fixed `list_form_fields` so `"No"` radio buttons report `checked = True` when `val == export_val`.

5. **Performance Optimization — Cold 16-Page Scan Reduced 3.4× (`backend/engine/forms_signatures.py`)**
   - Filtered `raw_lines` in OpenCV (`ink_above < 0.03`, `ly0 >= 42.0`) before invoking RapidOCR so pure prose pages with underlined headings (Pages 5, 6, 9, 10, 11) skip RapidOCR completely (`~0.35–0.41 s` each instead of `16–17 s` each).
   - Added band-cropped stacked-strip RapidOCR when `len(raw_cb_all) + len(raw_lines) <= 10` and `covered_frac < 0.55`, cutting sparse pages (Pages 4, 7, 8, 12, 13) from `14–16 s` down to `2.5–5.7 s`.
   - **Result:** Cold 16-page NSD scan dropped from `180.75 s` (baseline) / `169.07 s` (previous) to **`52.88 s`**, while warm cached detection via `_PAGE_DETECT_CACHE` runs in **`0.3080 s`** (**587× faster** than baseline).

6. **Document Closing & Stale Viewer State (`src/App.tsx`)**
   - Replaced blocking `window.confirm` dialogs with a non-blocking in-app confirmation modal (`confirmDialog`), cancelled in-flight `Detect All Pages` on tab close, cleared per-document refs, and added an `activeDoc &&` guard on thumbnail rendering so async `loadDocResources` responses cannot leave stale thumbnails after all tabs close.

---

## 2. Page-by-Page NSD 16-Page Audit (`tests/fixtures/NNSDFILLABLEAPP (1).pdf`)

| Page | Content Type | Cold Time | Detected | Confirmed Valid | Missed | False Positives | Overlaps | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **1** | Scanned Application | `7.32 s` | `37` | `37` | `0` | `0` | `0` | 25 text, 10 checkboxes, 2 Yes/No radios; filled & reopened |
| **2** | Scanned Capabilities & Yes/No | `6.67 s` | `65` | `65` | `0` | `0` | `0` | 8 paired Yes/No radios, 44 checkboxes, 13 text; GUI toggle/save/reopen verified |
| **3** | Scanned/Mixed Service Area | `4.52 s` | `9` | `9` | `0` | `0` | `0` | 5 distance checkboxes, `Other` + text, `COMMENTS` multiline, `Name`, `Date` |
| **4** | Scanned Agreement Opening | `5.67 s` | `4` | `4` | `0` | `0` | `0` | `effective_day`, `effective_month`, `effective_year`, `provider_name`; filled & reopened |
| **5** | Scanned Agreement Prose | `0.41 s` | `0` | `0` | `0` | `0` | `0` | Pure legal prose; RapidOCR skipped via OpenCV pre-pass |
| **6** | Scanned Agreement Prose | `0.35 s` | `0` | `0` | `0` | `0` | `0` | Pure legal prose; RapidOCR skipped via OpenCV pre-pass |
| **7** | Vector-Outlined Signatures | `2.54 s` | `6` | `6` | `0` | `0` | `0` | `COMPANY` & `PROVIDER` (`By`, `Name`, `Title`) |
| **8** | Scanned Attachment 1 Prose | `3.57 s` | `0` | `0` | `0` | `0` | `0` | `1. Services.` false positive eliminated |
| **9** | Scanned Attachment 1 Prose | `0.39 s` | `0` | `0` | `0` | `0` | `0` | Pure legal prose; RapidOCR skipped via OpenCV pre-pass |
| **10** | Scanned Attachment 1 Prose | `0.36 s` | `0` | `0` | `0` | `0` | `0` | Pure legal prose; RapidOCR skipped via OpenCV pre-pass |
| **11** | Scanned Attachment 1 Prose | `0.37 s` | `0` | `0` | `0` | `0` | `0` | Pure legal prose; RapidOCR skipped via OpenCV pre-pass |
| **12** | Scanned Clause 20 Initials | `4.55 s` | `5` | `5` | `0` | `0` | `0` | All 5 `(Initial)` fields detected, filled (`E1..E5`), saved & reopened |
| **13** | Scanned Clause 21 & Signatures | `3.86 s` | `4` | `4` | `0` | `0` | `0` | `PROVIDER`/`NSD` (`By`, `Title`); `iv.` false positive eliminated |
| **14** | Scanned ACH Direct Deposit | `7.05 s` | `13` | `13` | `0` | `0` | `0` | All 13 ACH fields; `Text Field 1` artifact eliminated |
| **15** | ACORD 25 Example Thumbnail | `4.96 s` | `0` | `0` | `0` | `0` | `0` | Sample certificate graphic guarded cleanly |
| **16** | Landscape Vector Rate Table | `0.30 s` | `121` | `121` | `0` | `0` | `0` | `Name of Business` (`[138.1, 104.4, 496.5, 120.3]`) + `110` rate cells + `10` Initials |
| **Total** | **16 pages** | **`52.88 s` cold / `0.3080 s` warm** | **`264`** | **`264`** | **`0`** | **`0`** | **`0`** | Baseline was `180.75 s` cold, `167` candidates |

---

## 3. Verification Results (Post-Final Edit)

- **TypeScript & Production Bundle:** `npx tsc --noEmit && npm run build` — **exited 0** (`1745` modules).
- **Linux Packaging:** `npm run package:linux` — **exited 0**; built `release/Vellum_PDF_Pro-1.0.0-x86_64.AppImage` and `release/vellum-pdf-pro_1.0.0_amd64.deb`.
- **Full Backend/API & Regression Suite:** `.venv/bin/pytest -q tests/` — **37 passed, 0 failed** in `133.14 s` (scanning all 16 NSD pages via `range(16)` + W-9 + GEICO + dialog/engine tests).
- **Packaged AppImage GUI — NSD Multi-Page & Lifecycle (`scripts/verify_scanned_form_detection_gui.cjs`):** **exited 0**:
  - Page 1: `37` scanned fields detected, accepted, filled, saved, and persisted on reopen.
  - Page 2: `65` candidates detected, accepted, `Yes`/`No` radio mutual exclusion toggled (`r0: false, r1: true`) and independent checkboxes checked (`c0: true, c1: true`), saved, and persisted on reopen (`r0: false, r1: true, c0: true, c1: true`).
  - Page 4: `4` opening-paragraph blanks detected, accepted, filled (`17`, `November`, `26`, `Example Roadside Recovery LLC`), saved, and persisted on reopen.
  - Page 12: `5` `(Initial)` fields detected, accepted, filled (`E1..E5`), saved, and persisted on reopen.
  - Page 16: `121` clean table/initial cells detected without logo or cell overlap.
  - Tab Close: closing all tabs cleared `tabs: 0, thumbs: 0, stage: false, cands: 0, widgets: 0`.
- **Packaged AppImage GUI — GEICO Form Regression (`scripts/verify_geico_form_gui.cjs`):** **exited 0** (`34` widgets, filled values & `7` checkboxes persisted).

### Visual Verification Screenshots

- [`docs/screenshots/nsd-page2-nav-and-yesno.png`](docs/screenshots/nsd-page2-nav-and-yesno.png)
- [`docs/screenshots/nsd-p4-clean.png`](docs/screenshots/nsd-p4-clean.png)
- [`docs/screenshots/nsd-p12-initials.png`](docs/screenshots/nsd-p12-initials.png)
- [`docs/screenshots/nsd-p16-table.png`](docs/screenshots/nsd-p16-table.png)
- [`docs/screenshots/nsd-closed-welcome.png`](docs/screenshots/nsd-closed-welcome.png)

---

## 4. Remaining Limitations

- **Cold Scan CPU Time (~53 s on 16 Pages):** Although 3.4× faster than the `180.75 s` baseline and sub-second when cached (`0.3080 s`), cold full-document scanning of dense image-based forms still takes ~`53 s` on CPU due to RapidOCR inference on multi-field pages (Pages 1, 2, 14).
- **Short Field Auto-Fit on Narrow Blanks:** On Page 4, long sample strings in narrow blanks (`effective_month`, `effective_year`) trigger expected auto-fit scaling (`8.5 pt` / `8.0 pt`) with non-blocking inspector warnings.
