# Form Detection Accuracy, Navigation, Performance & Document Lifecycle Refinement Report

**Project:** Vellum PDF Pro (`/home/zk/workspace/pdfedit`)  
**Branch:** `feat/interactive-forms`  
**Primary Regression Fixture:** `tests/fixtures/NNSDFILLABLEAPP (1).pdf` (16-page NSD Independent Service Provider Application, SHA-256 `a7a56cc0536e4476b6a3e7c27bb81a6bcb4deb09f7c77c19252759f70bd9973e`, untouched)  
**Retained Regression Fixtures:**  
- `tests/fixtures/PROVIDER APP REQ FORM (2).pdf` (GEICO Application Request, SHA-256 `5a5610e843eac0c59823fbf45af47238ca0d1c694173d3cc2bcc227f29caea46`, untouched)  
- `tests/fixtures/W9 Form - March 2024 (1) (3) (1).pdf` (IRS W-9, SHA-256 `2d420cbb4123dcf1fb82595b2359cfbb5d81f00b9df9d359fcc7af361d093f53`, untouched)

---

## 1. Page 2 Missing Checkbox Root-Cause Analysis & Engine Fixes

Manual inspection of `nsd-page2-before-audit.png` (`65` candidates) identified 6 missed controls and 4 misclassified Yes/No pairs on Page 2. OpenCV contour diagnostics confirmed all 6 missing boxes were detected geometrically (`16.5×16.5 pt`, `approx=4`, `fill=0.00`), but were silently dropped or mislabeled in `cb_infos` (`backend/engine/forms_signatures.py`):

| Missing / Misclassified Control | Root Cause | Engine-Level Fix (`backend/engine/forms_signatures.py`) |
| --- | --- | --- |
| **Do you sell tires? (Yes)** | RapidOCR merged border noise with `"Yes"` (`IYes`/`JYesL`) and `"Do you sell tires?"` overlapped the left box edge (`> 2 pt`), leaving `opt_lbl=""` and `stem_lbl=""` so `cb_infos` dropped the box. | Expanded `right_hits` (`-10..+38 pt`) and `left_hits` (`x1 <= cb_r.x0 + 12 pt`); normalized border-merged Yes/No OCR artifacts (`[ijl\|1]?yes[ijl\|1]?`). |
| **If yes, for: Motorcycle (tire row)** | RapidOCR missed `"Motorcycle"` completely on the tire row and `left_hits` stopped at the preceding `"RV"` checkbox, leaving `opt_lbl=""` and `stem_lbl=""`. | Added `unblocked_left` fallback to inherit row stem (`"If yes, for:"`) when intermediate checkboxes sit between the stem and box. |
| **Do you sell batteries? (Yes)** | RapidOCR returned `"IYes"` overlapping the right border of the checkbox and `"Do you sell batteries?"` touching the left border. | Relaxed `right_hits` / `left_hits` border tolerances and added Yes/No border-noise normalization. |
| **Do you have a secure storage lot? (Yes & No)** | RapidOCR missed both `"Do you have a secure storage lot?"` and `"Yes"`, while `"No"` was read as `"INo"`. | Kept verified `12.5..22 pt` hollow squares below the header/logo band (`y >= 55 pt`), blocked `right_hits` from jumping across an adjacent checkbox, and added directional Yes/No partner pairing (`dx` `20..64 pt`). |
| **Do you provide accident scene towing? (Yes)** | `"Do you provide accident scene towing?"` overlapped the left edge (`> 2 pt`) and RapidOCR missed `"Yes"`. | Relaxed `left_hits` edge tolerance and paired with its `"No"` partner (`radiobutton`). |
| **Page 1 & 2 Yes/No Pairs** | When OCR truncated `"No"` to `"N"`/`"IN"` or merged it with the next question (`"If not, are you interested..."`), the pair stayed independent checkboxes. | Added second-pass directional Yes/No partner inference for adjacent boxes (`20..64 pt` apart on the same row) right of `?` questions. |

---

## 2. Independent Expected-Field Evaluation (Page 2 & Page-by-Page Audit)

Evaluated via `tests/nsd_expected_manifest.py` (`evaluate_page_against_expected`) against manually verified expected controls:

### Page 2 Precision & Recall (`PAGE_2_EXPECTED`)

| Metric | Value |
| --- | --- |
| **Expected field count** | `71` (`18` radiobuttons = `9` Yes/No pairs, `40` checkboxes, `13` text fields) |
| **Detected field count** | `71` (`18` radiobuttons, `40` checkboxes, `13` text fields) |
| **True positives (location + type)** | `71` |
| **False negatives (missed)** | `0` |
| **False positives (spurious)** | `0` |
| **Incorrect field types** | `0` |
| **Duplicate fields** | `0` |
| **Precision** | `1.0000` (`100%`) |
| **Recall** | `1.0000` (`100%`) |

### All 16 Pages of `NNSDFILLABLEAPP (1).pdf`

| Page | Content Type | Cold Time | Expected | Detected | Types | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| **1** | Scanned Application | `7.45 s` | `39` | `39` | `25 text, 14 radiobutton` | All 7 Yes/No pairs grouped cleanly; 0 logo false positives |
| **2** | Scanned Capabilities & Yes/No | `6.96 s` | `71` | `71` | `18 radiobutton, 40 checkbox, 13 text` | `TP=71, FN=0, FP=0, Precision=1.0, Recall=1.0` |
| **3** | Scanned/Mixed Service Area | `4.14 s` | `10` | `10` | `6 checkbox, 2 text, 1 multiline, 1 date` | All 6 distance/Other checkboxes + Comments + Name/Date |
| **4** | Scanned Agreement Opening | `5.01 s` | `4` | `4` | `4 text` | `effective_day`, `effective_month`, `effective_year`, `provider_name` |
| **5–6** | Scanned Agreement Prose | `0.37–0.39 s` | `0` | `0` | — | RapidOCR skipped via OpenCV pre-pass |
| **7** | Vector-Outlined Signatures | `2.84 s` | `6` | `6` | `2 signature, 4 text` | `COMPANY` & `PROVIDER` (`By`, `Name`, `Title`) |
| **8–11** | Scanned Attachment 1 Prose | `0.35–3.85 s` | `0` | `0` | — | `1. Services.` false positive eliminated |
| **12** | Scanned Clause 20 Initials | `6.37 s` | `5` | `5` | `5 text` | All 5 `(Initial)` fields detected, filled, persisted |
| **13** | Scanned Clause 21 & Signatures | `4.63 s` | `4` | `4` | `2 signature, 2 text` | `iv.` false positive eliminated |
| **14** | Scanned ACH Direct Deposit | `7.43 s` | `13` | `13` | `10 text, 1 checkbox, 1 date, 1 signature` | `Text Field 1` artifact eliminated |
| **15** | ACORD 25 Example Thumbnail | `4.84 s` | `0` | `0` | — | Sample certificate graphic guarded cleanly |
| **16** | Landscape Vector Rate Table | `0.33 s` | `121` | `121` | `121 text` | `Name of Business` (`[138.1, 104.4, 496.5, 120.3]`) + `110` rate cells + `10` Initials; `logo_hits=[]`, `pair_overlaps=0` |
| **Total** | **16 pages** | **`55.72 s` cold / `0.3080 s` warm** | **`273`** | **`273`** | — | Baseline was `180.75 s` cold, `167` candidates |

---

## 3. Before-and-After Screenshots

- **Before (65 candidates on Page 2, missing 6 boxes & 4 Yes/No pairs):** [`docs/screenshots/nsd-page2-before-audit.png`](docs/screenshots/nsd-page2-before-audit.png)
- **After (71/71 candidates on Page 2, all checkboxes & Yes/No pairs highlighted):** [`docs/screenshots/nsd-page2-nav-and-yesno.png`](docs/screenshots/nsd-page2-nav-and-yesno.png)
- **Page 4 (4 blanks, 0 prose false positives):** [`docs/screenshots/nsd-p4-clean.png`](docs/screenshots/nsd-p4-clean.png)
- **Page 12 (5 Initials):** [`docs/screenshots/nsd-p12-initials.png`](docs/screenshots/nsd-p12-initials.png)
- **Page 16 (121 clean table/Initial cells, no logo overlap):** [`docs/screenshots/nsd-p16-table.png`](docs/screenshots/nsd-p16-table.png)
- **All Tabs Closed (clean welcome state):** [`docs/screenshots/nsd-closed-welcome.png`](docs/screenshots/nsd-closed-welcome.png)

---

## 4. Verification Results (Post-Final Edit)

- **TypeScript & Production Bundle:** `npx tsc --noEmit && npm run build` — **exited 0** (`1745` modules).
- **Full Backend/API & Regression Suite:** `.venv/bin/pytest -q tests/` — **37 passed, 0 failed** in `98.25 s` (includes `PAGE_2_EXPECTED` 71-field precision/recall = `1.0/1.0`, `NSD_EXPECTED_PAGE_SUMMARY` across all 16 pages, W-9, GEICO, and dialog/engine tests).
- **Linux Packaging:** `npm run package:linux` — **exited 0** (`release/Vellum_PDF_Pro-1.0.0-x86_64.AppImage`, `release/vellum-pdf-pro_1.0.0_amd64.deb`).
- **Packaged AppImage GUI — NSD Multi-Page, Tab/Shift+Tab & Persistence (`scripts/verify_scanned_form_detection_gui.cjs`):** **exited 0**:
  - Page 2: `71` candidates accepted (`18` radios, `40` checkboxes, `13` text), `Tab` / `Shift+Tab` focus navigation verified, newly detected Yes/No radios toggled (`r0: false, r1: true, r2: true, r6: false, r7: true`) and checkboxes checked (`c0: true, c2: true` including tire `Motorcycle`), saved, and persisted on reopen.
  - Page 4 (`4` blanks) and Page 12 (`5` Initials) filled, saved, and persisted on reopen; Page 16 (`121` cells) verified; tab close cleared all viewer/thumbnail state (`thumbs: 0`).
- **Packaged AppImage GUI — GEICO Form Regression (`scripts/verify_geico_form_gui.cjs`):** **exited 0** (`34/34` widgets, filled values & `7` checkboxes persisted).

---

## 5. Honest Remaining Limitations

- **Fallback Labels When OCR Misses Small Adjacent Option Text:** When RapidOCR misses a small printed option word (such as `"Motorcycle"` on the tire row of Page 2), OpenCV still detects the checkbox geometry cleanly and inherits the row stem (`"If yes, for"`), so the control is interactive and fillable, though its tooltip/slug is generic unless edited in the Inspector.
- **Cold Scan CPU Time (~55.7 s on 16 Pages):** Cached re-detection is sub-second (`0.3080 s`), while a cold full-document scan of dense multi-field scanned pages (Pages 1, 2, 14) takes ~`55.7 s` on CPU due to RapidOCR inference.
