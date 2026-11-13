# Vellum PDF Pro — Real-World PDF Compatibility & Non-Destructive Regression Report

**Branch:** `feat/paragraph-editor`  
**Date:** 2026-11-13  

---

## 1. Source Control Resolution (`MIXED_FORMAT_EDITING_REPORT.md`)

- Inspected `git diff MIXED_FORMAT_EDITING_REPORT.md`: the only uncommitted modification was a single trailing blank line (`+` at line 75). No uncommitted content was present.
- Resolved safely via `git checkout -- MIXED_FORMAT_EDITING_REPORT.md`, returning the working tree to clean state before testing.

---

## 2. Reproducible Compatibility Corpus & Provenance

Implemented in `tests/compat_fixtures.py` and `tests/compat_runner.py`, executed via `tests/test_pdf_compatibility_matrix.py`, with full machine-readable output in `docs/compatibility_matrix.json`.

Every fixture records explicit provenance (`origin`):
- **Real External Tool Exports**:
  - `lo_writer_real` (`real_libreoffice_writer`): Exported via `soffice --headless --convert-to pdf` from HTML containing headings, bold/italic/colored inline runs, a `/Link` URI, and a bordered table.
  - `lo_calc_real` (`real_libreoffice_calc`): Exported via `soffice --headless --convert-to pdf` from a multi-row CSV spreadsheet.
  - `chrome_headless_real` (`real_chrome_headless`): Exported via `google-chrome --headless=new --print-to-pdf` from a multi-column flexbox HTML/CSS page with styled spans and a hyperlink.
- **Native Microsoft Office PDFs**: **`NOT TESTED`** — Microsoft Word/Excel binaries are not installed on this Linux host, and third-party files were not fabricated. A clearly-labeled synthetic Office-style fixture (`msoffice_style_synthetic`, `synthetic_pymupdf`) was tested instead.
- **Synthetic Fixtures (`synthetic_pymupdf` / `synthetic_pikepdf` / `synthetic_malformed`)**:
  - `msoffice_style_synthetic`, `scanned_page_synthetic`, `invoice_synthetic`, `acroform_synthetic`, `multicolumn_synthetic`, `mixed_links_annots_redact_synthetic`, `subset_unicode_synthetic`, `rotation_90_synthetic`, `rotation_180_synthetic`, `rotation_270_synthetic`, `images_vectors_synthetic`, `large_40p_synthetic` (40 pages), `encrypted_aes256_synthetic` (AES-256), `malformed_truncated_synthetic`, and `hostile_js_openaction_synthetic` (`/OpenAction /JavaScript`).

---

## 3. Compatibility Matrix

| Fixture ID | Category | Origin | Status | Unedited Raster Diff (`changed_pixel_pct`) | `pdftotext` | `gs` | Undo/Redo & Save/Reopen | Notes |
|---|---|---|---|---:|---|---|---|---|
| `lo_writer_real` | LibreOffice Writer | `real_libreoffice_writer` | **PASS** | `0.0%` | PASS | PASS | PASS | Mixed runs, table & `/Link` preserved; `shrink_font` handled tight neighbor collision |
| `lo_calc_real` | LibreOffice Calc | `real_libreoffice_calc` | **PASS** | `0.0%` | PASS | PASS | PASS | Tight 11.2pt cell safely refused overflowing wrap (`tight_cell_overflow_refused_safely=True`), cell-fit edit passed |
| `chrome_headless_real` | Browser-Exported PDF (Chrome) | `real_chrome_headless` | **PASS** | `0.0%` | PASS | PASS | PASS | Multi-column flexbox layout isolated; left-column edit left right column untouched |
| — | Native Microsoft Word / Excel Exports | N/A | **NOT TESTED** | — | — | — | — | Native MS Office not available on Linux; not fabricated |
| `msoffice_style_synthetic` | Microsoft Office-Style (Synthetic) | `synthetic_pymupdf` | **PASS** | `0.0%` | PASS | PASS | PASS | Multi-clause contract layout |
| `scanned_page_synthetic` | Scanned Page (Image-Only) | `synthetic_pymupdf` | **PASS** | — | — | — | — | Raster image detected (`image_count >= 1`), `0` false text spans |
| `invoice_synthetic` | Invoice | `synthetic_pymupdf` | **PASS** | `0.0%` | PASS | PASS | PASS | Colored vector header + bordered table preserved |
| `acroform_synthetic` | Complex Forms (AcroForm) | `synthetic_pymupdf` | **PASS** | `0.0%` | PASS | PASS | PASS | Text & checkbox widgets preserved; neighbor collision protected |
| `multicolumn_synthetic` | Multi-Column Layout | `synthetic_pymupdf` | **PASS** | `0.0%` | PASS | PASS | PASS | Column isolation verified |
| `mixed_links_annots_redact_synthetic` | Mixed Runs, Links, Annots & Redaction | `synthetic_pymupdf` | **PASS** | `0.0%` | PASS | PASS | PASS | Permanent redaction purged `999-42-8174` from text, `pdftotext`, and all raw PDF streams |
| `subset_unicode_synthetic` | Embedded/Subset Fonts & Unicode | `synthetic_pymupdf` | **PASS** | `0.0%` | PASS | PASS | PASS | Subset DejaVuSans + `Café — €100 ﬁle` |
| `rotation_90_synthetic` | Page Rotation (90°) | `synthetic_pymupdf` | **PASS** | `0.0167%` | PASS | PASS | PASS | Within `< 1.5%` raster tolerance |
| `rotation_180_synthetic` | Page Rotation (180°) | `synthetic_pymupdf` | **PASS** | `0.0176%` | PASS | PASS | PASS | Within `< 1.5%` raster tolerance |
| `rotation_270_synthetic` | Page Rotation (270°) | `synthetic_pymupdf` | **PASS** | `0.0203%` | PASS | PASS | PASS | Within `< 1.5%` raster tolerance |
| `images_vectors_synthetic` | Images & Vector Backgrounds | `synthetic_pymupdf` | **PASS** | `0.0%` | PASS | PASS | PASS | No whiteout rectangle over tinted vector fill; PNG preserved |
| `large_40p_synthetic` | Large Document (40 Pages) | `synthetic_pymupdf` | **PASS** | `0.0%` | PASS | PASS | PASS | Mid-document page 20 edit & reopen verified |
| `encrypted_aes256_synthetic` | Encrypted PDF (AES-256) | `synthetic_pymupdf` | **PASS** | `0.0%` | — | — | PASS | Rejected missing/wrong password (`401`); unlocked & edited with correct password |
| `malformed_truncated_synthetic` | Malformed / Truncated PDF | `synthetic_malformed` | **PASS** | — | — | — | — | Rejected cleanly with HTTP `400` without crash |
| `hostile_js_openaction_synthetic` | Hostile PDF (`/OpenAction /JavaScript`) | `synthetic_pikepdf` | **PASS** | `0.0%` | PASS | PASS | PASS | Passive handling; embedded JS never executed |

---

## 4. Security & Integrity Verification

1. **Permanent Redaction**: `POST /api/docs/{doc_id}/security/redact` with `{"page_redactions": [{"page_index": 0, "bbox": [68, 225, 420, 248]}]}` permanently removed `999-42-8174` from PyMuPDF `get_text()`, external `pdftotext`, and every `xref_stream()` in the PDF (`permanent_redaction_verified = true`).
2. **Atomic Rollback & Unchanged Bytes on Rejected Edits**: Intentionally mismatched `expected_orig_text` edits, `font_fallback_policy="refuse"`, and unauthenticated encrypted opens left `session.pdf_bytes` SHA-256 checksums identical (`rejected_edit_unchanged_bytes = true`).
3. **Hostile & Malformed PDFs**: Truncated PDFs returned HTTP `400`; `/OpenAction /JavaScript` payloads were parsed passively without execution.

---

## 5. Ranked Engineering Findings & Recommendations

1. **P2 — Tight Spreadsheet Cell Wrapping (`lo_calc_real`)**:
   - *Observation*: When editing a single-line LibreOffice Calc cell (`11.2pt` tall, `1pt` row spacing) with text that wraps onto 2 lines, `expand_box` refuses to overlap the row below and `shrink_font` hits its minimum readable font floor (`6.5pt`), returning `status: "overflow"`.
   - *Recommendation*: Offer a "Compact single-line horizontal scale" or clear UI guidance ("Text exceeds single-row cell height; shorten text or widen column") in the overflow banner for table cells.
2. **P3 — Redaction API Schema Clarity (`RedactRequest`)**:
   - *Observation*: `RedactRequest.page_redactions` expects `[{"page_index": 0, "bbox": [x0, y0, x1, y1]}]` (`bbox`, not `rects`). Passing `rects` silently yields `redacted_regions_count: 0` because extra dict keys are ignored.
   - *Recommendation*: Validate `page_redactions` items with a typed Pydantic model (`PageRedactionItem`) so malformed keys fail fast with HTTP `422` instead of a 0-region no-op.
3. **P3 — Pre-existing TypeScript Debt in `src/App.tsx`**:
   - *Observation*: `npx tsc --noEmit` still reports 16 pre-existing type errors in older handlers of `src/App.tsx` (lines 521–3045), though all new code (`src/richTextUtils.ts`, `src/types.ts`, and mixed-format/paragraph sections) has `0` TS errors and `vite build` succeeds cleanly.

---

## 6. Test & Build Summary

- **Full Backend/API & Compatibility Suite** (`.venv/bin/pytest -v tests/`): **25 passed, 0 failed** in `83.12s` (includes `test_real_world_and_synthetic_compatibility_matrix`, `test_crash_recovery_journal`, `test_object_selection_moving_resizing_and_persistence`, `test_mixed_format_paragraph_runs_unicode_and_safety`, etc.).
- **Frontend Production Build** (`npm run build`): Exited `0` (`dist/assets/index-B_azhT9j.js`, `dist/assets/index-Ct1vFAN5.css`).
- **Packaged AppImage GUI Smoke Test** (`DISPLAY=:0 node scripts/verify_mixed_format_gui.cjs`): **ALL MIXED-FORMAT GUI CHECKS PASSED!** (exited `0`).

