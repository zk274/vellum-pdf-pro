# Mixed-Format PDF Text Editing & Per-Run Style Preservation Report

**Branch:** `feat/paragraph-editor`  
**Date:** 2026-11-13  

---

## 1. Summary of Changes

### Backend (`backend/engine/direct_edit.py`, `backend/app.py`)
- **Ordered Style Run Extraction (`inspect_page_objects` / `_build_paragraph_blocks`)**:
  - Preserves ordered `runs` on every detected `text_block` so that `"".join(r["text"] for r in runs) == reflow_text`.
  - Each run captures `text`, `font`, `family`, `size`, `color`, `bold`, `italic`, `is_embedded_font`, `is_subset_font`, `char_spacing`, `baseline`, and `link_uri`.
- **Mixed-Style Reflow & Proportional Fit (`_resolve_run_font_and_metrics`, `_wrap_mixed_runs`, `edit_paragraph_block`)**:
  - Measures and wraps words across run boundaries without breaking styled words mid-word unless wider than the available line width.
  - Computes per-line heights from the tallest run on each wrapped line and scales all runs proportionally when `overflow_policy="shrink_font"`.
  - Preserves neighboring objects via collision checking and atomic post-mutation verification/rollback.
- **Transparent Embedded/Subset Font Handling & Hyperlink Restoration**:
  - Checks glyph encoding against original embedded/subset fonts per run, emits `font_warnings`, and supports `font_fallback_policy="warn_and_fallback"` or `"refuse"` (returns HTTP 400 without modifying the PDF).
  - Restores per-run `link_uri` annotations and `affected_links` across reflowed coordinates.
  - Updated `TextRunPayload` and `EditParagraphRequest` / `api_edit_paragraph_block` in `backend/app.py`.

### Frontend (`src/types.ts`, `src/richTextUtils.ts`, `src/App.tsx`, `src/styles.css`)
- Added `TextRun`, `FontWarningInfo`, and `runs` / `font_fallback_policy` / `font_warnings` types in `src/types.ts`.
- Created `src/richTextUtils.ts` with pure run manipulation (`coalesceRuns`, `applyStyleToRange`, `getSelectionStyle`, `replaceTextPreservingRuns`) and DOM serialization/offset helpers (`serializeRunsToDom`, `parseDomToRuns`, `getDomSelectionOffsets`, `setDomSelectionOffsets`).
- Upgraded `.inline-paragraph-overlay` in `src/App.tsx` to a `contentEditable` rich inline editor with:
  - Floating toolbar controls for **Bold** (`Ctrl+B`), **Italic** (`Ctrl+I`), **Font Size**, **Color**, and **Font Family**, plus `Save` (`Ctrl+Enter`) and `Cancel` (`Esc`).
  - Selection-scoped formatting: selecting a range of characters applies style changes only to that range without altering surrounding runs; editing in the right-hand **Paragraph Editor & Reflow** inspector stays synchronized and displays an active selection badge.
  - Subset/embedded font warning banner inside the inline editor when `hasSubsetFont` is true, plus `font_warnings` status notifications on commit.
- Styled `.inline-paragraph-richtext`, `.rich-fmt-*` controls, and `.paragraph-font-warning` in `src/styles.css` for both Light and Dark themes.

---

## 2. Known Limitations

1. **Subset Font Re-encoding**: When a PDF embeds a subset font that lacks glyphs for newly typed characters, Vellum PDF Pro cannot synthesize missing glyphs into the subsetted font stream; it warns the user and either falls back to a compatible font (`DejaVu Sans` / Base-14) or refuses the edit if `font_fallback_policy="refuse"`.
2. **Inspector Textarea Plain-Text Sync**: Typing directly in the right-hand Inspector's plain `<textarea>` uses `replaceTextPreservingRuns()` (minimal prefix/suffix diff) to retain surrounding run styles; for mid-run formatting changes on specific substrings, the inline `contentEditable` canvas editor provides exact character-range selection.

---

## 3. Verification Results

### Automated Backend & API Suite
- Command: `.venv/bin/pytest -v tests/`
- Result: **24 passed, 0 failed** in `57.83s`.
- New test `test_mixed_format_paragraph_runs_unicode_and_safety` verified:
  - Mixed bold/italic/regular/color/size extraction (`"".join(r["text"] for r in runs) == reflow_text`) and partial-range editing.
  - Unicode & ligatures (`Café — résumé €100 ﬁle ﬂow.`).
  - Overflow detection (`status == "overflow"`) and proportional `shrink_font` reflow.
  - Per-run hyperlink preservation, `90°` & `270°` rotated pages, Undo/Redo, and save-close-reopen persistence via PyMuPDF.
  - Subset font warning (`font_warnings`) and `font_fallback_policy="refuse"` (HTTP 400, original content preserved).

### Frontend Build & TypeScript
- Command: `npm run build` (Vite v6.4.3) -> **Exited 0** (`dist/index.html`, `dist/assets/index-Ct1vFAN5.css`, `dist/assets/index-B_azhT9j.js`).
- `npx tsc --noEmit`: **0 errors** in `src/richTextUtils.ts`, `src/types.ts`, and all added/modified lines in `src/App.tsx`.

### Packaged AppImage End-to-End GUI Verification
- Command: `DISPLAY=:0 node scripts/verify_mixed_format_gui.cjs`
- Result: **ALL MIXED-FORMAT GUI CHECKS PASSED!** (Exited 0)
  - Verified single-click selection (8 `.resize-handle` elements, inline editor closed).
  - Opened rich `contentEditable` inline editor, selected 8-character range (`"TER SOFT"`), toggled Bold and changed Color to `#d92626` while preserving surrounding `MAS` and `WARE SERVICES AGREEMENT` runs in bold navy (`rgb(20, 46, 107)`).
  - Verified Inspector selection badge (`Selection (8 chars) — styling applies only to selection`), overflow prompt handling (`Expand Box`), and Undo/Redo.
- Screenshots captured & inspected:
  - `docs/screenshots/mixed-format-dark-115.png`
  - `docs/screenshots/mixed-format-dark-150.png`
  - `docs/screenshots/mixed-format-light-150.png`

---

## 4. Packaging & SHA-256 Checksums

Built via `bash scripts/build_packages.sh`:
- `43a7c94c70954b282d5f76672d4175a6b1f4918f655a055d229fd623fbb2d0a7  release/vellum-pdf-pro_1.0.0_amd64.deb` (450M)
- `94cae77222d978e0b5bfeb5ee8a2244b8c1ee359f38d31a87f396eb174022c68  release/Vellum_PDF_Pro-1.0.0-x86_64.AppImage` (389M)
