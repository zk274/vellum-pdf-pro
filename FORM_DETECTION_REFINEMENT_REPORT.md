# Form Detection Accuracy, Navigation, Performance & Document Lifecycle Refinement Report

**Project:** Vellum PDF Pro (`/home/zk/workspace/pdfedit`)  
**Branch:** `feat/interactive-forms`  
**Primary Regression Fixture:** `tests/fixtures/NNSDFILLABLEAPP (1).pdf` (16-page NSD Independent Service Provider Application, SHA-256 `a7a56cc0536e4476b6a3e7c27bb81a6bcb4deb09f7c77c19252759f70bd9973e`, untouched)  
**Retained Regression Fixtures:**  
- `tests/fixtures/PROVIDER APP REQ FORM (2).pdf` (GEICO Application Request, SHA-256 `5a5610e843eac0c59823fbf45af47238ca0d1c694173d3cc2bcc227f29caea46`, untouched)  
- `tests/fixtures/W9 Form - March 2024 (1) (3) (1).pdf` (IRS W-9, SHA-256 `2d420cbb4123dcf1fb82595b2359cfbb5d81f00b9df9d359fcc7af361d093f53`, untouched)

---

## 1. Root Causes Identified & Resolved

1. **False Positives & Missed Fields in Scanned/Mixed Pages (`backend/engine/forms_signatures.py`)**
   - **Page 4 (Agreement Prose):** An underline/gap inside `"in which Company holds equity ownership."` triggered a false positive (`whichcompanyholdsequityownership`). Added strict OCR text-collision guarding and long-sentence exclusion.
   - **Page 12 (Criminal Background Check & Initials):** Small numbered list digits (`16.`, `17.`, `18.`, `19.`, `21.`) were misclassified as hollow square checkboxes, while 4 of 5 `(Initial)` lines were missed because the horizontal underline kernel was too wide for short initial lines and wrapped `(Initial)` labels sat directly beneath the line. Raised checkbox minimum size to `10.5..24.0 pt`, added OpenCV `approxPolyDP` rectangularity and numeric-only exclusion, lowered horizontal underline kernel to `14 pt`, and added `below_init` wrapped-line detection.
   - **Page 2 (Yes/No Questions & Capabilities):** RapidOCR typos (`jno`, `n0`, `ycs`, `ves`) caused missed Yes/No radio pairs. Added OCR typo normalization and paired Yes/No radio grouping.
   - **Page 16 (Vector Rate Table & Initials):** `vertical_dividers` (`min height`) and grid row height thresholds were too tall for the `8.5 pt` rate table rows, and loose `h_lines` ran before grid detection, merging the top header into an oversized `name_of_business` box. Lowered vertical divider min height to `9.0 pt`, lowered grid row height to `7.5 pt`, prioritized line-grid detection before loose `h_lines`, and suppressed loose horizontal lines overlapping grid rows.

2. **Detection Latency (`backend/engine/forms_signatures.py`)**
   - Running full `175 DPI` RapidOCR unconditionally on every page caused `16–20 s` per dense prose page. Added an OpenCV-first fast geometric pre-pass before RapidOCR (`150 DPI` RapidOCR, `175 DPI` OpenCV) and a per-`(sha256, page_index)` 128-entry LRU cache (`_PAGE_DETECT_CACHE`).

3. **Document Closing & Stale Viewer State (`src/App.tsx`)**
   - Closing a tab left stale thumbnails, canvas bitmap, page objects, annotations, form fields, draft values, and candidate overlays visible when no documents remained, and could leave in-flight `Detect All Pages` requests running. `performCloseTab` / `handleCloseTab` now cancel in-flight detection on the closed document, clear per-document caches (`formCandidatesByDocRef`, `formDirtyRef`, `savedTargetDocsRef`), reset all viewer/inspector state when the last tab closes, and prompt via a non-blocking in-app confirmation modal (`Discard & Close`) if unsaved edits exist.

4. **Persistent Page Navigation & Multi-Page Candidate Review (`src/App.tsx`)**
   - Added a persistent `.page-navigator-bar` (`< Previous | Page [input] of N | Next >`) in the canvas viewport synced with thumbnails, status bar, Inspector, and `PageUp`/`PageDown`/`Home`/`End` shortcuts.
   - Added page-aware candidate review (`This Page` / `All Pages`), `Low-Conf (<80%)` filter, accepted/rejected/low counts, `Accept Page` / `Reject Page` actions, click-to-jump to `cand.page_index`, and a non-blocking confirmation modal before bulk multi-page AcroForm insertion.

---

## 2. Before / After NSD 16-Page Detection Metrics

Measured against `tests/fixtures/NNSDFILLABLEAPP (1).pdf`:

| Metric | Before | After |
| --- | --- | --- |
| Total candidates across 16 pages | `167` | `264` |
| Cold full-document scan time | `180.75 s` | `169.07 s` |
| Warm / cached full-document time | — | `0.3330 s` (**508x faster**) |
| Page 2 (Yes/No + capabilities) | — | `65` candidates (paired Yes/No radios + checkboxes + text) |
| Page 4 (Agreement prose) | `1` false positive (`whichcompanyholdsequityownership`) | `0` false positives |
| Page 12 (`(Initial)` + numbered clauses) | `5` digit checkbox false positives + `1/5` Initials | `0` digit false positives + `5/5` `(Initial)` fields |
| Page 16 (Rate table + Initial row) | Oversized header + missed `8.5 pt` rows | `122` individual table cells & Initial fields |

---

## 3. Verification Results

All checks were executed after the final code edit (`src/App.tsx`, `scripts/verify_scanned_form_detection_gui.cjs`):

- **TypeScript & Production Bundle:** `npx tsc --noEmit && npm run build` — **exited 0** (`1745 modules transformed`).
- **Linux Packaging:** `npm run package:linux` — **exited 0**; built `release/Vellum_PDF_Pro-1.0.0-x86_64.AppImage` and `release/vellum-pdf-pro_1.0.0_amd64.deb`.
- **Full Backend/API & Regression Suite:** `.venv/bin/pytest -q tests/` — **37 passed, 0 failed** in `170.99 s` (including `test_w9_existing_acroform_preserved_and_zero_duplicates`, `test_nsd_16page_manifest_scoring_conversion_fill_save_reopen`, GEICO 34/34 validation, and `test_textbox_inline_editing_wrapping_coordinates_and_lifecycle`).
- **Packaged AppImage GUI — NSD Scanned Form, Navigation & Tab Close:** `DISPLAY=:0 node scripts/verify_scanned_form_detection_gui.cjs` — **exited 0**:
  - Detected `37` scanned candidates on Page 1, converted to interactive AcroForm widgets, filled values, saved `_fillable.pdf`, and verified persistence on reopen.
  - Verified Page Navigator jumping & status bar sync on Page 2 (`65` candidates), Page 4 (`0` candidates), Page 12 (`5` candidates), and Page 16 (`122` candidates).
  - Verified closing all tabs clears thumbnails, canvas stage, and overlays cleanly to the welcome screen.
- **Packaged AppImage GUI — GEICO Form Regression:** `DISPLAY=:0 node scripts/verify_geico_form_gui.cjs` — **exited 0** (`34` candidates, `34` converted widgets, filled values & `7` checkboxes persisted after reopen).

### Visual Verification Screenshots

- [`docs/screenshots/nsd-page2-nav-and-yesno.png`](docs/screenshots/nsd-page2-nav-and-yesno.png) — Page 2 navigator, paired Yes/No radios, and capability checkboxes.
- [`docs/screenshots/nsd-p4-clean.png`](docs/screenshots/nsd-p4-clean.png) — Page 4 agreement prose with `0` false positives.
- [`docs/screenshots/nsd-p12-initials.png`](docs/screenshots/nsd-p12-initials.png) — Page 12 with `5` `(Initial)` candidates and `0` digit false positives.
- [`docs/screenshots/nsd-p16-table.png`](docs/screenshots/nsd-p16-table.png) — Page 16 with `122` rate-table and `Initial` fields.
- [`docs/screenshots/nsd-closed-welcome.png`](docs/screenshots/nsd-closed-welcome.png) — Clean welcome screen after closing all tabs.

---

## 4. Known Limitations

- **Cold 16-Page Scanned OCR Time:** While cached re-detection is sub-second (`0.3330 s`), a cold full-document scan of all 16 mixed/scanned pages still takes ~`169 s` on CPU due to RapidOCR inference on image-based pages.
- **Page 16 Header Row Overlap:** On Page 16, the detected `Name of Business:` field spans the top row of the table grid and slightly overlaps the lower portion of the NSD logo graphic (`docs/screenshots/nsd-p16-table.png`).
