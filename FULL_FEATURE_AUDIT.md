# Vellum PDF Pro — Full Feature Audit

**Audit Date:** 2026-11-13  
**Repository:** `/home/zk/workspace/pdfedit`  
**Branch:** `feat/paragraph-editor` (`8437f47`, ahead of `origin/feat/paragraph-editor` by 3 commits; `main` at `ad7c595`)  
**Scope:** Code-level and runtime audit of Electron shell, React/TypeScript frontend, Python/FastAPI backend, packaging, CI, and test suites.

---

## Status Classification Key

| Status | Meaning |
|---|---|
| `COMPLETE` | Implemented and verified end-to-end |
| `PARTIAL` | Some functionality exists but important capabilities are missing |
| `BROKEN` | Implemented but fails verification |
| `UI ONLY` | Visible in the interface without a working backend workflow |
| `BACKEND ONLY` | Backend exists without a complete frontend workflow |
| `MISSING` | Not implemented |
| `NOT TESTED` | Implementation exists but verification is insufficient |
| `NOT APPLICABLE` | Outside the agreed product scope |

---

## Baseline Summary

- **Git Baseline:** `feat/paragraph-editor` adds 28 changed files (`+6,234 / -70` lines) over `main`, implementing paragraph reflow, double-click inline editing, mixed-format run editing, strict redaction validation, compatibility matrix testing, and TypeScript cleanup.
- **Automated Verification Observed:**
  - `.venv/bin/pytest -q tests/`: **27 passed, 0 failed** (2 warnings, 137.56s).
  - `npx tsc --noEmit`: **0 errors**.
  - `npm run build`: **passed**.
  - `scripts/verify_mixed_format_gui.cjs` (packaged AppImage): **passed** (prior to audit; no code changed during audit).
  - Direct runtime probes via `TestClient(app)`: confirmed `KeyError` -> HTTP 500 on missing `doc_id` across 45+ endpoints, `ValueError` -> HTTP 500 on `listbox` form creation, and `api_decrypt_pdf` ignoring `req.password`.
- **Important Note on Existing Reports:** Prior reports (`AUDIT_REPORT.md`, `RELEASE_READINESS.md`, `docs/FEATURE_MATRIX.md`) overstated completeness (e.g., marking all 27 rows `Complete` in `docs/FEATURE_MATRIX.md`). This audit overrides those claims with direct code and runtime evidence.

---

## Category A: Core PDF Editing

### A1. Editing Existing PDF Text (Single Span)
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (Direct Text Span Inspector, canvas span click/double-click)
3. **Relevant backend files:** `backend/engine/direct_edit.py` (`edit_text_span`, `_remove_glyphs`, `_encode_with_original_font`, lines 597–1066)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/pages/{page_index}/edit-text` (`backend/app.py:800–833`)
5. **User-facing workflow:** Select span -> edit text/font/size/color in Inspector or double-click inline -> commit -> content stream updated without whiteout boxes.
6. **Test coverage:** `test_direct_text_editing_preserves_background_without_white_rectangle`, `test_direct_edit_embedded_and_subsetted_fonts_deep_verification`, `test_text_span_manipulation_preservation_and_hyperlinks` (`tests/test_pdf_engine_and_api.py`).
7. **Actual verification evidence:** Pixel assertions confirm colored background preserved (not `(255,255,255)`), tight leading lines intact, and save/reopen persists changes.
8. **Missing functionality:** Non-orthogonal text angles (e.g., 45°), complex kerning (`TJ`) preservation.
9. **Known defects:** Mid-x-height redaction band (44%–56% in `_remove_glyphs`) can clip extreme ascenders/descenders or fail on non-90° rotations.
10. **Technical complexity:** High
11. **Dependencies:** PyMuPDF, `fontTools`
12. **Recommended next action:** Add handling/guards for non-orthogonal text matrices and expand test coverage for multi-byte CMap edge cases.

### A2. Double-Click Inline Text Editing
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (inline text box editor L3718, rich `contentEditable` paragraph editor L3936–3986), `src/richTextUtils.ts`
3. **Relevant backend files:** `backend/engine/direct_edit.py` (`edit_text_span`, `edit_paragraph_block`)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/pages/{page_index}/edit-text`, `POST /api/docs/{doc_id}/pages/{page_index}/edit-paragraph`
5. **User-facing workflow:** Double-click native text span, paragraph, or Vellum text box on canvas -> edit inline at zoom-matched coordinates -> `Ctrl+Enter` or Save button commits, `Escape` cancels.
6. **Test coverage:** `scripts/verify_inline_double_click_gui.cjs`, `scripts/verify_mixed_format_gui.cjs`, `test_textbox_inline_editing_wrapping_coordinates_and_lifecycle`.
7. **Actual verification evidence:** GUI scripts pass against packaged AppImage; screenshots verified in `docs/screenshots/inline-edit-*.png`.
8. **Missing functionality:** Inline editing for rotated text at arbitrary non-90° angles.
9. **Known defects:** Inspector plain `<textarea>` uses diff-matching (`replaceTextPreservingRuns`), which cannot apply character-range styles to substrings (requires canvas `contentEditable`).
10. **Technical complexity:** High
11. **Dependencies:** `src/richTextUtils.ts`, `edit_paragraph_block`
12. **Recommended next action:** Document Inspector vs inline editor distinction or add rich toolbar parity in Inspector.

### A3. Paragraph Editing and Automatic Text Reflow
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (Paragraph Editor & Reflow Inspector, overflow banner `.paragraph-overflow-msg`), `src/types.ts` (`TextBlockObject`, `ParagraphOverflowInfo`)
3. **Relevant backend files:** `backend/engine/direct_edit.py` (`_build_paragraph_blocks`, `_wrap_paragraph_lines`, `edit_paragraph_block`, lines 181–438, 1749–2601)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/pages/{page_index}/edit-paragraph` (`backend/app.py:835–882`)
5. **User-facing workflow:** Double-click or select detected paragraph -> edit text -> auto-wraps within bounding box -> warns on overflow/neighbor collision with `expand_box`, `shrink_font` (6.0pt floor), or `force` options.
6. **Test coverage:** `test_intelligent_paragraph_editing_reflow_overflow_and_safety`, `test_tight_spreadsheet_cell_overflow_readability_guard`, `scripts/verify_paragraph_editor_gui.cjs`.
7. **Actual verification evidence:** Verified heading/column/table-cell isolation, overflow refusal leaving SHA-256 unchanged, 6.0pt readability floor, and 90°/180°/270° rotation support.
8. **Missing functionality:** Multi-page paragraph reflow (flowing overflow onto the next page).
9. **Known defects:** Heuristic paragraph grouping may occasionally split or merge unusual layouts in complex third-party PDFs.
10. **Technical complexity:** Very High
11. **Dependencies:** PyMuPDF, `fontTools`
12. **Recommended next action:** Keep single-page reflow stable; scope multi-page flow to Phase 4 if needed.

### A4. Mixed-Font and Mixed-Style Paragraph Editing
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/richTextUtils.ts` (`coalesceRuns`, `applyStyleToRange`, `serializeRunsToDom`, `parseDomToRuns`), `src/App.tsx` (floating formatting toolbar)
3. **Relevant backend files:** `backend/engine/direct_edit.py` (`_resolve_run_font_and_metrics`, `_wrap_mixed_runs`, `edit_paragraph_block`)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/pages/{page_index}/edit-paragraph`
5. **User-facing workflow:** Select character range in inline paragraph editor -> toggle bold/italic, font, size, color -> wrap preserves per-run styles and embedded hyperlinks.
6. **Test coverage:** `test_mixed_format_paragraph_runs_unicode_and_safety`, `scripts/verify_mixed_format_gui.cjs`.
7. **Actual verification evidence:** 27/27 pytest pass + packaged AppImage GUI script pass.
8. **Missing functionality:** Underline/strikethrough run styling, subscript/superscript, bulleted/numbered list auto-formatting.
9. **Known defects:** None blocking; falls back on missing subset glyphs with warning.
10. **Technical complexity:** Very High
11. **Dependencies:** `src/richTextUtils.ts`, `direct_edit.py`
12. **Recommended next action:** Add underline/strikethrough run attributes in Phase 2.

### A5. Font Replacement and Embedding
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (font selector in Inspector/toolbar, `LeftSidebarTab` `'fonts'`)
3. **Relevant backend files:** `backend/engine/utils.py` (`resolve_pdf_font`, lines 153–242), `backend/engine/direct_edit.py`, `backend/engine/security_optimize.py` (`inspect_embedded_fonts`, lines 362–394)
4. **Existing API endpoints:** `GET /api/docs/{doc_id}/fonts`, `POST /api/docs/{doc_id}/pages/{page_index}/edit-text`, `edit-paragraph`
5. **User-facing workflow:** Inspect document fonts in sidebar; select replacement font when editing text; PyMuPDF embeds TTF when inserting text.
6. **Test coverage:** `test_direct_edit_embedded_and_subsetted_fonts_deep_verification`.
7. **Actual verification evidence:** Embedded `DejaVuSans.ttf` edits losslessly (`fallback_used is False`).
8. **Missing functionality:** Cross-distro font discovery (paths in `utils.py:128–150` hardcode `/usr/share/fonts/truetype/...`), global "replace font across entire document" tool.
9. **Known defects:** Hardcoded Debian/Ubuntu font paths fail on Fedora/Arch/non-Debian distros without `fontconfig` (`fc-match`).
10. **Technical complexity:** Medium
11. **Dependencies:** System fonts / `fontconfig`
12. **Recommended next action:** Replace hardcoded font paths in `utils.py` with `fc-match` / `fontconfig` lookup + bundled fallback fonts.

### A6. Embedded and Subset Font Handling
1. **Current status:** `PARTIAL`
2. **Relevant frontend files:** `src/App.tsx` (subset font warning banner), `src/types.ts` (`FontWarningInfo`, `is_subset_font`)
3. **Relevant backend files:** `backend/engine/direct_edit.py` (`_glyph_inventory`, `_embedded_ttf_has_gids`, `_parse_tounicode`, `_encode_with_original_font`, lines 597–772)
4. **Existing API endpoints:** `GET /api/docs/{doc_id}/pages/{page_index}/objects`, `edit-text`, `edit-paragraph`
5. **User-facing workflow:** Editing subsetted font text with existing glyphs succeeds losslessly; entering missing glyphs triggers warning and metric-compatible fallback (or refuses if policy is `refuse`).
6. **Test coverage:** `test_subset_font_fallback_detection`, `test_direct_edit_embedded_and_subsetted_fonts_deep_verification`, `test_mixed_format_paragraph_runs_unicode_and_safety`.
7. **Actual verification evidence:** Verified lossless edit when glyphs exist in subset, and `fallback_used=True` / HTTP 400 refusal when glyphs are absent.
8. **Missing functionality:** Merging/synthesizing new glyph outlines into an existing embedded subset font (`fontTools.subset` re-embedding).
9. **Known defects:** Cannot add new characters absent from the original subset without switching fonts.
10. **Technical complexity:** Very High
11. **Dependencies:** `fontTools`, PyMuPDF
12. **Recommended next action:** Document as known technical boundary for v1.0; evaluate `fontTools` subset merging for Post-v1.0.

### A7. Unicode and Multilingual Text
1. **Current status:** `PARTIAL`
2. **Relevant frontend files:** `src/App.tsx`, `src/richTextUtils.ts`
3. **Relevant backend files:** `backend/engine/utils.py` (`resolve_pdf_font`), `backend/engine/direct_edit.py` (`_parse_tounicode`)
4. **Existing API endpoints:** `edit-text`, `edit-paragraph`, `add-text`
5. **User-facing workflow:** Latin Unicode and ligatures (`Café — résumé €100 ﬁle ﬂow.`) render and wrap cleanly using DejaVu Sans fallback.
6. **Test coverage:** `test_mixed_format_paragraph_runs_unicode_and_safety`.
7. **Actual verification evidence:** Latin accented chars, Euro symbol, em-dash, and `ﬁ`/`ﬂ` ligatures verified in pytest.
8. **Missing functionality:** Complex text shaping (HarfBuzz/FriBidi) for RTL scripts (Arabic, Hebrew), Indic scripts (Devanagari), and vertical CJK text.
9. **Known defects:** If `needs_unicode` is True and hardcoded TTF paths are missing on host, `utils.py` falls back to Base-14 `helv`, dropping non-ASCII glyphs.
10. **Technical complexity:** Very High
11. **Dependencies:** `fontconfig`, HarfBuzz/Pango or PyMuPDF `insert_htmlbox`
12. **Recommended next action:** Add `fontconfig` resolution in `utils.py` and test CJK/Cyrillic/Greek in Phase 2; RTL/complex shaping in Phase 4.

### A8. Text Box Creation and Deletion
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (rubber-band draw, New Text Box Inspector, `Delete` key / context menu)
3. **Relevant backend files:** `backend/engine/direct_edit.py` (`add_text_object`, `transform_object(action="delete")`, `/VellumData` page dict)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/pages/{page_index}/add-text`, `POST /api/docs/{doc_id}/pages/{page_index}/transform-object`
5. **User-facing workflow:** Select Add Text Box tool -> drag on page -> type text, set border/fill/font -> commit; select and press `Delete` to remove.
6. **Test coverage:** `test_textbox_inline_editing_wrapping_coordinates_and_lifecycle`, `test_object_selection_moving_resizing_and_persistence`.
7. **Actual verification evidence:** Verified word wrap, auto-expansion, deletion, undo/redo, and save/reopen persistence.
8. **Missing functionality:** None for basic text boxes.
9. **Known defects:** None critical.
10. **Technical complexity:** Medium
11. **Dependencies:** `direct_edit.py`
12. **Recommended next action:** Maintain regression coverage.

### A9. Moving and Resizing Text
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (8-handle transform frame, drag-to-move, live preview, arrow nudging, `Escape` cancel, Inspector X/Y/W/H)
3. **Relevant backend files:** `backend/engine/direct_edit.py` (`transform_object`, `edit_text_span`)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/pages/{page_index}/transform-object`
5. **User-facing workflow:** Single-click text span or Vellum text box -> drag body or 8 handles, or edit X/Y/W/H in Inspector, or arrow-nudge -> undoable.
6. **Test coverage:** `test_object_selection_moving_resizing_and_persistence`, `test_text_span_manipulation_preservation_and_hyperlinks`, `scripts/test_object_manipulation_gui.cjs`, `scripts/verify_text_span_manipulation_gui.cjs`.
7. **Actual verification evidence:** Verified resizing bbox does NOT scale font, hyperlinks move in sync, and undo restores exact text.
8. **Missing functionality:** Drag-moving/resizing an entire detected paragraph as a single block (currently moves individual spans or Vellum boxes).
9. **Known defects:** None critical.
10. **Technical complexity:** High
11. **Dependencies:** `direct_edit.py`
12. **Recommended next action:** Add paragraph-level drag-move/resize support in Phase 2.

### A10. Text Alignment and Formatting
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx`, `src/richTextUtils.ts`
3. **Relevant backend files:** `backend/engine/direct_edit.py` (`align`: `left`, `center`, `right`, `justify`; bold, italic, size, color, line spacing)
4. **Existing API endpoints:** `add-text`, `edit-text`, `edit-paragraph`, `transform-object`
5. **User-facing workflow:** Select alignment, font, size, color, bold, italic in Inspector or floating inline toolbar.
6. **Test coverage:** `test_mixed_format_paragraph_runs_unicode_and_safety`, `test_textbox_inline_editing_wrapping_coordinates_and_lifecycle`.
7. **Actual verification evidence:** Verified in pytest and GUI tests.
8. **Missing functionality:** Underline, strikethrough, letter-spacing UI control, paragraph spacing before/after, bullet/numbered lists.
9. **Known defects:** None critical.
10. **Technical complexity:** Medium
11. **Dependencies:** `direct_edit.py`, `richTextUtils.ts`
12. **Recommended next action:** Add underline/strikethrough and list formatting in Phase 2.

### A11. Copy, Cut, Paste, and Duplicate
1. **Current status:** `PARTIAL`
2. **Relevant frontend files:** `src/App.tsx` (context menu + `Ctrl+C`/`X`/`V`/`D` at lines 1388–1414, 4087–4173)
3. **Relevant backend files:** `backend/engine/direct_edit.py` (`transform_object(action="duplicate")` only)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/pages/{page_index}/transform-object`
5. **User-facing workflow:** `Ctrl+D` duplicates selected object (+20pt); `Ctrl+C`/`X`/`V` copies/cuts/pastes Vellum objects within app memory.
6. **Test coverage:** `test_object_selection_moving_resizing_and_persistence` (tests `duplicate`).
7. **Actual verification evidence:** `duplicate` tested in pytest; client-side `Ctrl+C`/`X`/`V` not covered by dedicated pytest/GUI assertions.
8. **Missing functionality:** Cross-document object copy/paste, pasting images/rich text from OS system clipboard (`navigator.clipboard` / Electron `clipboard`), pasting native PDF spans cleanly via clipboard.
9. **Known defects:** Copy/paste is purely in-memory React state for single objects; cannot paste an image from system clipboard.
10. **Technical complexity:** Medium
11. **Dependencies:** Electron `clipboard` API, `direct_edit.py`
12. **Recommended next action:** Wire Electron clipboard image/text paste and cross-tab object paste in Phase 2.

### A12. Image Insertion and Replacement
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (Insert Image tool, Image Object Inspector Replace button)
3. **Relevant backend files:** `backend/engine/direct_edit.py` (`insert_image_object`, `edit_image_object(action="replace")`, lines 1188–1286)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/pages/{page_index}/insert-image`, `POST /api/docs/{doc_id}/pages/{page_index}/edit-image`
5. **User-facing workflow:** Upload PNG/JPEG/etc. into drawn bounding box; select existing image -> Replace with new file.
6. **Test coverage:** `test_direct_image_shapes_and_hyperlinks_editing`.
7. **Actual verification evidence:** Verified multipart image insertion, replacement, and deletion by xref.
8. **Missing functionality:** Direct drag-and-drop image file onto canvas, WebP/SVG vector image import.
9. **Known defects:** None critical.
10. **Technical complexity:** Low
11. **Dependencies:** PyMuPDF, Pillow
12. **Recommended next action:** Support dragging image files onto page canvas in Phase 2.

### A13. Moving, Cropping, Rotating, and Resizing Images
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (8-handle frame on images, Image Object Inspector crop/rotate controls)
3. **Relevant backend files:** `backend/engine/direct_edit.py` (`edit_image_object`, `transform_object`, lines 1225–1286, 1398–1746)
4. **Existing API endpoints:** `edit-image`, `transform-object`
5. **User-facing workflow:** Select image -> drag/resize via handles, or enter crop ratios / 90° rotation in Inspector.
6. **Test coverage:** `test_direct_image_shapes_and_hyperlinks_editing`.
7. **Actual verification evidence:** Verified move, resize, crop ratios, and 90° rotation in pytest.
8. **Missing functionality:** Interactive visual crop-handles directly on the image (currently numeric crop ratios in Inspector), arbitrary-angle image rotation, flip horizontal/vertical, opacity control.
9. **Known defects:** None critical.
10. **Technical complexity:** Medium
11. **Dependencies:** Pillow, PyMuPDF
12. **Recommended next action:** Add interactive crop overlay and flip/opacity controls in Phase 2.

### A14. Vector Shapes and Drawing Tools
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (sub-tools for `rect`, `ellipse`, `line`, `arrow`; stroke/fill/width/opacity Inspector)
3. **Relevant backend files:** `backend/engine/direct_edit.py` (`add_shape_object`, `transform_object`, lines 1294–1366)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/pages/{page_index}/add-shape`, `transform-object`
5. **User-facing workflow:** Select shape tool -> rubber-band draw on canvas -> select/move/resize/duplicate/delete via handles.
6. **Test coverage:** `test_direct_image_shapes_and_hyperlinks_editing`, `test_object_selection_moving_resizing_and_persistence`.
7. **Actual verification evidence:** Verified arrow and rect creation, move, resize, duplicate, delete, and persistence.
8. **Missing functionality:** Editing existing native PDF vector paths/curves not created by Vellum, polygon/polyline/cloud tools, dashed stroke styles.
9. **Known defects:** Deleting a shape via `transform_object` uses `PDF_REDACT_LINE_ART_REMOVE_IF_COVERED`, which can erase underlying page drawings intersecting the shape border (`direct_edit.py`).
10. **Technical complexity:** Medium
11. **Dependencies:** PyMuPDF
12. **Recommended next action:** Fix shape deletion so it doesn't damage underlying native vector art, and add dashed/polygon styles in Phase 2.

### A15. Hyperlink Insertion and Editing
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (Add Hyperlink modal L5625–5668, rubber-band link draw)
3. **Relevant backend files:** `backend/engine/direct_edit.py` (`manage_hyperlink`, lines 1369–1395; automatic link preservation in `edit_text_span` & `edit_paragraph_block`)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/pages/{page_index}/hyperlink`
5. **User-facing workflow:** Draw link box -> enter URL or internal target page -> link saved as PDF `LINK_URI`/`LINK_GOTO` annotation; text moves/reflows keep links synced.
6. **Test coverage:** `test_direct_image_shapes_and_hyperlinks_editing`, `test_text_span_manipulation_preservation_and_hyperlinks`, `test_mixed_format_paragraph_runs_unicode_and_safety`.
7. **Actual verification evidence:** Verified adding `https://kernel.org`, moving linked spans updates link bbox, mixed-format links preserved.
8. **Missing functionality:** Dedicated UI to edit/delete an existing standalone link annotation directly by clicking it.
9. **Known defects:** None critical.
10. **Technical complexity:** Low
11. **Dependencies:** PyMuPDF
12. **Recommended next action:** Add link selection/edit/delete UI in Phase 2.

### A16. Multi-Object Selection and Manipulation
1. **Current status:** `MISSING`
2. **Relevant frontend files:** `src/App.tsx` (`selectedObject` is singular)
3. **Relevant backend files:** `backend/engine/direct_edit.py` (`transform_object` accepts single `object_id` and `object_type`)
4. **Existing API endpoints:** None for batch/multi-object transforms
5. **User-facing workflow:** Not available; Shift+Click or marquee selection of multiple objects does not exist.
6. **Test coverage:** None
7. **Actual verification evidence:** Confirmed via code inspection of `src/App.tsx` and `direct_edit.py`.
8. **Missing functionality:** Marquee/Shift+Click multi-selection, group move, group resize, group delete, group copy/paste.
9. **Known defects:** N/A
10. **Technical complexity:** High
11. **Dependencies:** Frontend selection state refactor, batch `transform_object` endpoint
12. **Recommended next action:** Implement multi-object selection & batch transform in Phase 2.

### A17. Object Alignment, Distribution, and Layering (Z-Order)
1. **Current status:** `MISSING`
2. **Relevant frontend files:** `src/App.tsx` (magnetic center-axis snap guides exist during single-object drag, but no alignment/distribution/Z-order actions)
3. **Relevant backend files:** `backend/engine/direct_edit.py` (strictly appends new objects to top of content stream)
4. **Existing API endpoints:** None
5. **User-facing workflow:** Not available (no Align Left/Center/Right, Distribute Horizontally/Vertically, Bring to Front, Send to Back).
6. **Test coverage:** None
7. **Actual verification evidence:** Confirmed via code inspection of `direct_edit.py` and `src/App.tsx`.
8. **Missing functionality:** Object-to-object alignment, even distribution, Z-order/layer stacking manipulation.
9. **Known defects:** N/A
10. **Technical complexity:** High
11. **Dependencies:** Multi-object selection (A16), content stream / `/VellumData` layer ordering
12. **Recommended next action:** Implement Z-order tracking and multi-object align/distribute in Phase 2.

### A18. Undo and Redo
1. **Current status:** `PARTIAL`
2. **Relevant frontend files:** `src/App.tsx` (`Ctrl+Z`/`Ctrl+Y`/`Ctrl+Shift+Z`, toolbar buttons)
3. **Relevant backend files:** `backend/engine/session.py` (`HistoryEntry`, `push_mutation`, `undo`, `redo`, lines 20–107)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/undo`, `POST /api/docs/{doc_id}/redo`
5. **User-facing workflow:** Undo/Redo reverts or reapplies document mutations.
6. **Test coverage:** `test_health_and_showcase_lifecycle`, `test_textbox_inline_editing_wrapping_coordinates_and_lifecycle`, `test_object_selection_moving_resizing_and_persistence`, `test_text_span_manipulation_preservation_and_hyperlinks`.
7. **Actual verification evidence:** Verified across text, pages, objects, and spans.
8. **Missing functionality:** Efficient delta/command history instead of full PDF byte snapshots.
9. **Known defects:**
   - **Memory bloat:** Each `HistoryEntry` stores full `pdf_bytes` (up to 35 undo entries + uncapped `redo_stack`, meaning ~1.75 GB RAM for a 50MB PDF).
   - **State loss on security undo:** `HistoryEntry` does not snapshot `encryption_config`/`is_encrypted`, so undoing `Encrypt PDF` or `Decrypt PDF` does not revert encryption settings.
10. **Technical complexity:** High
11. **Dependencies:** `backend/engine/session.py`
12. **Recommended next action:** Cap `redo_stack`, include `encryption_config` in `HistoryEntry`, and move large snapshot storage to disk/temp-backed store in Phase 1.

### A19. Editing Rotated PDF Pages
1. **Current status:** `PARTIAL`
2. **Relevant frontend files:** `src/App.tsx`
3. **Relevant backend files:** `backend/engine/utils.py` (`rect_to_display`, `rect_to_pdf`, `point_to_display`, `point_to_pdf`), `backend/engine/direct_edit.py` (`_detect_span_dir`, `_dir_to_rotate_angle`), `backend/engine/annotations.py`
4. **Existing API endpoints:** All page/edit/annotation endpoints
5. **User-facing workflow:** Editing text spans, paragraphs, mixed-format runs, and text boxes on 90°/180°/270° rotated pages works accurately.
6. **Test coverage:** `test_textbox_inline_editing_wrapping_coordinates_and_lifecycle`, `test_text_span_manipulation_preservation_and_hyperlinks`, `test_intelligent_paragraph_editing_reflow_overflow_and_safety`, `test_mixed_format_paragraph_runs_unicode_and_safety`, `tests/compat_fixtures.py` (`rotation_90/180/270_synthetic`).
7. **Actual verification evidence:** Direct editing on 90°/180°/270° pages passes in pytest.
8. **Missing functionality:** Coordinate normalization in `annotations.py`.
9. **Known defects:** **`annotations.py` does NOT convert coordinates on rotated pages** (`list_annotations` reads raw `annot.rect`, `add_annotation` passes raw `bbox` without `rect_to_pdf()`), causing annotations on rotated pages to appear in the wrong position.
10. **Technical complexity:** Medium
11. **Dependencies:** `backend/engine/utils.py`, `backend/engine/annotations.py`
12. **Recommended next action:** Fix `annotations.py` to use `rect_to_display` / `rect_to_pdf` and add rotated-page annotation tests in Phase 1.

### A20. Preservation of Unedited Document Content
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx`
3. **Relevant backend files:** `backend/engine/direct_edit.py`, `backend/engine/session.py`
4. **Existing API endpoints:** All editing endpoints
5. **User-facing workflow:** Editing one span/paragraph leaves surrounding content, colored backgrounds, vector lines, images, and other pages intact.
6. **Test coverage:** `test_direct_text_editing_preserves_background_without_white_rectangle`, `tests/compat_runner.py` (`raster_diff_excluding_bbox`).
7. **Actual verification evidence:** Compatibility matrix shows `0.0%`–`0.02%` unedited-region raster diff across 16 fixtures; `100.0%` unrelated page similarity.
8. **Missing functionality:** Preservation of existing cryptographic signatures when editing (inherently invalidates `/ByteRange`, which is standard PDF behavior, though UI should warn before editing a signed PDF).
9. **Known defects:** None in direct editing; note `SessionManager.open_document()` silently strips encryption on save (see F2).
10. **Technical complexity:** High
11. **Dependencies:** `direct_edit.py`, `compat_runner.py`
12. **Recommended next action:** Add "Document is digitally signed — editing will invalidate signatures" warning banner in Phase 2.

---

## Category B: Page Management

### B1. Insert Blank Pages
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (Pages toolbar, sidebar)
3. **Relevant backend files:** `backend/engine/page_ops.py` (`insert_blank_page`, lines 36–57)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/pages/insert-blank`
5. **User-facing workflow:** Insert blank page at index with custom/current page size.
6. **Test coverage:** `test_health_and_showcase_lifecycle`
7. **Actual verification evidence:** Verified page count increment, undo/redo, save/reopen.
8. **Missing functionality:** UI dialog to pick custom page dimensions/orientation when inserting.
9. **Known defects:** None
10. **Technical complexity:** Low
11. **Dependencies:** PyMuPDF
12. **Recommended next action:** Add page size preset picker on insert in Phase 2.

### B2. Delete Pages
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx`
3. **Relevant backend files:** `backend/engine/page_ops.py` (`delete_pages`, lines 59–72)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/pages/delete`
5. **User-facing workflow:** Delete current page or range spec from document.
6. **Test coverage:** `test_page_management_operations`
7. **Actual verification evidence:** Verified in pytest; refuses deleting all pages.
8. **Missing functionality:** Multi-select thumbnails in sidebar for bulk deletion.
9. **Known defects:** `parse_page_range_spec` raises unhandled `ValueError` (HTTP 500) on malformed range strings like `"1-3, 5-"`.
10. **Technical complexity:** Low
11. **Dependencies:** PyMuPDF
12. **Recommended next action:** Add range-parser error handling (HTTP 400/422) in Phase 1.

### B3. Reorder Pages
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (thumbnail drag-and-drop L3189–3205)
3. **Relevant backend files:** `backend/engine/page_ops.py` (`reorder_pages`, lines 102–115)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/pages/reorder`
5. **User-facing workflow:** Drag page thumbnails in left sidebar to reorder.
6. **Test coverage:** `test_page_management_operations`
7. **Actual verification evidence:** Verified `[2, 0, 1]` reordering in pytest.
8. **Missing functionality:** Validation in `reorder_pages` to ensure permutation completeness.
9. **Known defects:** **Data loss bug:** `reorder_pages` passes `valid` directly to `doc.select(valid)`; a partial index list silently deletes omitted pages without error.
10. **Technical complexity:** Low
11. **Dependencies:** PyMuPDF
12. **Recommended next action:** Validate `sorted(new_order) == list(range(len(doc)))` in `reorder_pages` in Phase 1.

### B4. Extract Pages
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx`
3. **Relevant backend files:** `backend/engine/page_ops.py` (`extract_pages`, lines 86–100)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/pages/extract`
5. **User-facing workflow:** Extract page(s) into a new document tab.
6. **Test coverage:** `test_page_management_operations`
7. **Actual verification evidence:** Verified extracting page 1 into new tab.
8. **Missing functionality:** Option to "Delete pages after extracting" or "Extract each page as separate file".
9. **Known defects:** None
10. **Technical complexity:** Low
11. **Dependencies:** PyMuPDF
12. **Recommended next action:** Add extract-and-delete option in Phase 2.

### B5. Duplicate Pages
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx`
3. **Relevant backend files:** `backend/engine/page_ops.py` (`duplicate_page`, lines 74–84)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/pages/duplicate`
5. **User-facing workflow:** Duplicate current page immediately after itself.
6. **Test coverage:** `test_page_management_operations`
7. **Actual verification evidence:** Verified page count increment in pytest.
8. **Missing functionality:** Duplicate N times.
9. **Known defects:** None
10. **Technical complexity:** Low
11. **Dependencies:** PyMuPDF
12. **Recommended next action:** None required for v1.0.

### B6. Rotate Pages
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (toolbar + `Ctrl+Shift+R`)
3. **Relevant backend files:** `backend/engine/page_ops.py` (`rotate_pages`, lines 117–129)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/pages/rotate`
5. **User-facing workflow:** Rotate selected pages 90°/180°/270°.
6. **Test coverage:** `test_page_management_operations`, `scripts/run_gui_tests.cjs`
7. **Actual verification evidence:** Verified in pytest and GUI screenshot `06_organize_pages_rotated.png`.
8. **Missing functionality:** Rotation angle validation.
9. **Known defects:** `rotate_pages` does not validate `delta_degrees % 90 == 0`.
10. **Technical complexity:** Low
11. **Dependencies:** PyMuPDF
12. **Recommended next action:** Enforce 90° increment validation in Phase 1.

### B7. Crop Pages
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (Page Org Inspector margins/cropbox)
3. **Relevant backend files:** `backend/engine/page_ops.py` (`crop_page`, lines 131–166)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/pages/crop`
5. **User-facing workflow:** Specify margins or crop box, optionally apply to all pages.
6. **Test coverage:** `test_page_management_operations`
7. **Actual verification evidence:** Verified margin cropping in pytest.
8. **Missing functionality:** Interactive visual crop-rectangle drag UI on the page canvas.
9. **Known defects:** None critical.
10. **Technical complexity:** Medium
11. **Dependencies:** PyMuPDF
12. **Recommended next action:** Add interactive canvas crop tool in Phase 2.

### B8. Split PDF
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (Page Org Inspector split controls)
3. **Relevant backend files:** `backend/engine/page_ops.py` (`split_pdf`, lines 242–281)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/pages/split`
5. **User-facing workflow:** Split by page ranges or every N pages into new tabs.
6. **Test coverage:** `test_page_management_operations`
7. **Actual verification evidence:** Verified splitting into 2 range-based documents.
8. **Missing functionality:** Split by file size (e.g., max 10 MB per part) or by top-level bookmarks, direct export to folder/ZIP.
9. **Known defects:** None critical.
10. **Technical complexity:** Medium
11. **Dependencies:** PyMuPDF
12. **Recommended next action:** Add split-by-bookmarks / ZIP export in Phase 3.

### B9. Merge PDFs
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (Merge open tabs + Insert pages from PDF file)
3. **Relevant backend files:** `backend/engine/page_ops.py` (`merge_pdfs`, `insert_pages_from_pdf`, lines 204–240)
4. **Existing API endpoints:** `POST /api/docs/merge`, `POST /api/docs/{doc_id}/pages/insert-from-pdf`
5. **User-facing workflow:** Merge open document tabs or upload another PDF to insert pages at index.
6. **Test coverage:** `test_page_management_operations`
7. **Actual verification evidence:** Verified merging 2 tabs into a 4-page PDF.
8. **Missing functionality:** Multi-file merge wizard from disk (without opening each as a tab first) with per-file page range selection.
9. **Known defects:** None critical.
10. **Technical complexity:** Low
11. **Dependencies:** PyMuPDF
12. **Recommended next action:** Add multi-file merge dialog in Phase 2.

### B10. Replace Pages
1. **Current status:** `MISSING`
2. **Relevant frontend files:** None
3. **Relevant backend files:** None (`page_ops.py` has no `replace_pages` function)
4. **Existing API endpoints:** None
5. **User-facing workflow:** Not available (users must manually insert from PDF and delete old pages).
6. **Test coverage:** None
7. **Actual verification evidence:** Verified absent in `page_ops.py` and `app.py`.
8. **Missing functionality:** Replace page(s) in target PDF with pages from source PDF while optionally preserving annotations/links/form fields.
9. **Known defects:** N/A
10. **Technical complexity:** Medium
11. **Dependencies:** `page_ops.py`
12. **Recommended next action:** Implement `replace_pages` endpoint and UI in Phase 2.

### B11. Resize Pages
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (Page Org Inspector)
3. **Relevant backend files:** `backend/engine/page_ops.py` (`resize_pages`, lines 168–202)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/pages/resize`
5. **User-facing workflow:** Resize selected/all pages to target pt dimensions with optional content scaling.
6. **Test coverage:** `test_page_management_operations`
7. **Actual verification evidence:** Verified resizing page 1 to Letter (612x792 pt).
8. **Missing functionality:** Standard paper-size presets dropdown (A4, Letter, Legal, A3) if not already exhaustive.
9. **Known defects:** None
10. **Technical complexity:** Low
11. **Dependencies:** PyMuPDF
12. **Recommended next action:** Ensure paper-size presets are available in UI.

### B12. Page Numbering and Bates Numbering
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (Pro Tools Inspector)
3. **Relevant backend files:** `backend/engine/pro_features.py` (`apply_bates_numbering`, `apply_header_footer` `{page}/{total}`, lines 116–201, 252–309)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/pro/bates`, `POST /api/docs/{doc_id}/pro/header-footer`
5. **User-facing workflow:** Configure prefix, suffix, start number, padding, position -> stamp across pages; returns `next_number`.
6. **Test coverage:** `test_pro_features_compare_watermarks_bates_bookmarks_attachments_and_pdfa`
7. **Actual verification evidence:** Verified `LGL-00101` to `LGL-00103` in pytest.
8. **Missing functionality:** Multi-document batch Bates sequencing UI, Bates removal/update tool.
9. **Known defects:** None critical.
10. **Technical complexity:** Low
11. **Dependencies:** PyMuPDF
12. **Recommended next action:** Add Bates removal/batch sequencing in Phase 4.

### B13. Headers, Footers, and Watermarks
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (Pro Tools Inspector)
3. **Relevant backend files:** `backend/engine/pro_features.py` (`apply_header_footer`, `apply_watermark`, lines 116–249)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/pro/header-footer`, `POST /api/docs/{doc_id}/pro/watermark`
5. **User-facing workflow:** Enter header/footer templates with `{page}`, `{total}`, `{date}`, `{title}` macros, or watermark text/opacity/angle.
6. **Test coverage:** `test_pro_features_compare_watermarks_bates_bookmarks_attachments_and_pdfa`
7. **Actual verification evidence:** Verified in pytest.
8. **Missing functionality:** Image watermarks, update/remove existing headers/footers/watermarks cleanly.
9. **Known defects:** None critical.
10. **Technical complexity:** Medium
11. **Dependencies:** PyMuPDF
12. **Recommended next action:** Add image watermark support in Phase 3.

### B14. Background Editing
1. **Current status:** `MISSING`
2. **Relevant frontend files:** None
3. **Relevant backend files:** None (`page_ops.py` and `pro_features.py` have no page background color/image tool; only text-box fill exists in `direct_edit.py`).
4. **Existing API endpoints:** None
5. **User-facing workflow:** Not available.
6. **Test coverage:** None
7. **Actual verification evidence:** Verified absent across `page_ops.py`, `pro_features.py`, and `app.py`.
8. **Missing functionality:** Add/update/remove page-level solid color or image backgrounds behind page content (`overlay=False`).
9. **Known defects:** N/A
10. **Technical complexity:** Low
11. **Dependencies:** PyMuPDF
12. **Recommended next action:** Implement page background tool in Phase 2.

### B15. Organizing Large Documents
1. **Current status:** `PARTIAL`
2. **Relevant frontend files:** `src/App.tsx` (`getThumbnails` loads all thumbnails at once)
3. **Relevant backend files:** `backend/app.py:738–764` (`render_thumbnails` renders every page of the document synchronously into a single JSON response as base64 PNGs)
4. **Existing API endpoints:** `GET /api/docs/{doc_id}/thumbnails`
5. **User-facing workflow:** Thumbnails appear in left sidebar; drag-to-reorder.
6. **Test coverage:** `compat_fixtures.py` tests a 40-page synthetic PDF (`large_40p_synthetic`).
7. **Actual verification evidence:** 40 pages tested; 200+–1,000+ page documents are NOT tested.
8. **Missing functionality:** Full-screen Grid/Organize Pages view with multi-select, lazy/paginated thumbnail loading, virtualized list.
9. **Known defects:** Rendering all pages synchronously into a single base64 JSON payload in `render_thumbnails` will cause high latency and memory spikes on 200+ page PDFs; full-PDF byte snapshots in `SessionManager` multiply memory usage.
10. **Technical complexity:** High
11. **Dependencies:** Virtualized thumbnail grid, paginated `/thumbnails?offset=&limit=` endpoint
12. **Recommended next action:** Paginate `/thumbnails` and add virtualized full-screen Organize Pages grid in Phase 2/5.

---

## Category C: OCR and Scanned Documents

### C1. OCR on Scanned PDFs & Multi-Page OCR
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (OCR mode toolbar/panel)
3. **Relevant backend files:** `backend/engine/ocr_convert.py` (`ocr_pdf_pages`, lines 48–192)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/ocr`
5. **User-facing workflow:** Open scanned PDF -> OCR mode -> Run OCR across all or selected pages.
6. **Test coverage:** `test_offline_ocr_and_all_document_conversions`, `compat_fixtures.py` (`scanned_page_synthetic`).
7. **Actual verification evidence:** Verified offline RapidOCR recognizes text (`PURCHASE` / `7741`) on pure raster PDF.
8. **Missing functionality:** Progress streaming for large multi-page OCR jobs (currently synchronous blocking HTTP request).
9. **Known defects:** Synchronous execution can hit frontend/proxy timeouts on 50+ page scans.
10. **Technical complexity:** Medium
11. **Dependencies:** `rapidocr-onnxruntime`, `pytesseract` (optional)
12. **Recommended next action:** Add background job progress reporting for multi-page OCR in Phase 3.

### C2. Searchable PDF Generation
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx`
3. **Relevant backend files:** `backend/engine/ocr_convert.py` (injects invisible text layer with `render_mode=3`)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/ocr`
5. **User-facing workflow:** Running OCR embeds searchable invisible text aligned to bounding boxes.
6. **Test coverage:** `test_offline_ocr_and_all_document_conversions`
7. **Actual verification evidence:** Asserted text extraction empty before OCR and populated after OCR.
8. **Missing functionality:** Font-width scaling (`horizontal_scaling`) per word box so selection highlights match scanned glyphs precisely.
9. **Known defects:** None critical for searchability.
10. **Technical complexity:** Medium
11. **Dependencies:** PyMuPDF, RapidOCR
12. **Recommended next action:** Tune word-box width alignment in Phase 3.

### C3. OCR Text Correction
1. **Current status:** `PARTIAL`
2. **Relevant frontend files:** `src/App.tsx` (can inspect/edit spans if switched to Edit mode)
3. **Relevant backend files:** `backend/engine/ocr_convert.py` (no dedicated suspect-word review/correction workflow)
4. **Existing API endpoints:** None specific to OCR suspect correction
5. **User-facing workflow:** No "Review OCR Suspects" workflow; user must manually find and edit invisible text layer spans.
6. **Test coverage:** None
7. **Actual verification evidence:** Verified absent in `ocr_convert.py` and `App.tsx`.
8. **Missing functionality:** Low-confidence OCR word highlighting and side-by-side suspect correction UI.
9. **Known defects:** N/A
10. **Technical complexity:** Medium
11. **Dependencies:** OCR confidence scores from RapidOCR
12. **Recommended next action:** Add low-confidence OCR suspect review UI in Phase 3.

### C4. OCR Language Support
1. **Current status:** `BROKEN` (for RapidOCR) / `PARTIAL` (with external Tesseract)
2. **Relevant frontend files:** `src/App.tsx:2898` (hardcoded `<select>` with `eng`, `deu`, `fra`, `spa`, `chi_sim`, `multi`; does not call `GET /api/ocr/languages`)
3. **Relevant backend files:** `backend/engine/ocr_convert.py:48–192` (`SUPPORTED_OCR_LANGUAGES` lists 8 languages, but `language` is only passed to `pytesseract` at line 102; RapidOCR ignores `language` completely)
4. **Existing API endpoints:** `GET /api/ocr/languages`, `POST /api/docs/{doc_id}/ocr`
5. **User-facing workflow:** User selects French/German/Spanish in UI, but if `tesseract` is not installed (as on this system and default minimal installs), RapidOCR silently runs default English/Chinese model regardless of selection.
6. **Test coverage:** Only English tested (`test_offline_ocr_and_all_document_conversions`).
7. **Actual verification evidence:** Verified in `ocr_convert.py` lines 27–33 & 102, and confirmed `tesseract` is absent on host.
8. **Missing functionality:** Multi-language ONNX/Tesseract model management and wiring `/api/ocr/languages` to frontend.
9. **Known defects:** RapidOCR silently ignores `language` parameter; `GET /api/ocr/languages` is unwired in `App.tsx`.
10. **Technical complexity:** Medium
11. **Dependencies:** RapidOCR language models or `tesseract-ocr` language packs
12. **Recommended next action:** Wire `/api/ocr/languages` to UI, warn when selected language lacks an installed Tesseract/ONNX model, and bundle/manage language packs in Phase 3.

### C5. OCR Orientation Detection & Deskew
1. **Current status:** `MISSING`
2. **Relevant frontend files:** None
3. **Relevant backend files:** `backend/engine/ocr_convert.py` (no OSD or deskew; assumes upright pages)
4. **Existing API endpoints:** None
5. **User-facing workflow:** Rotated/skewed scans are OCR'd without auto-rotation or deskew, causing misoriented/garbled text boxes.
6. **Test coverage:** None
7. **Actual verification evidence:** Confirmed absent in `ocr_convert.py`.
8. **Missing functionality:** Automatic orientation detection (0°/90°/180°/270°) and OpenCV deskewing before OCR.
9. **Known defects:** Rotated scans produce misaligned invisible text boxes.
10. **Technical complexity:** Medium
11. **Dependencies:** OpenCV (already in `requirements.txt`), Tesseract OSD or RapidOCR angle classifier (`cls`)
12. **Recommended next action:** Enable RapidOCR angle classifier (`use_angle_cls=True`) and OpenCV deskew in Phase 3.

### C6. OCR Accuracy & Low-Quality Scan Preprocessing
1. **Current status:** `PARTIAL`
2. **Relevant frontend files:** `src/App.tsx`
3. **Relevant backend files:** `backend/engine/ocr_convert.py` (passes raw PNG bytes directly to RapidOCR without OpenCV preprocessing)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/ocr`
5. **User-facing workflow:** Works well on clean 180 DPI scans; degrades on noisy, shadowed, or low-contrast scans.
6. **Test coverage:** Clean synthetic scan only.
7. **Actual verification evidence:** `opencv-python` is in `requirements.txt` but unused in `ocr_convert.py`.
8. **Missing functionality:** Adaptive thresholding/binarization, denoising, contrast enhancement, bleed-through removal.
9. **Known defects:** No scan cleanup pipeline.
10. **Technical complexity:** Medium
11. **Dependencies:** `opencv-python`
12. **Recommended next action:** Add OpenCV preprocessing options (despeckle, adaptive threshold, deskew) in Phase 3.

### C7. OCR Preservation of Original Page Appearance
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx`
3. **Relevant backend files:** `backend/engine/ocr_convert.py` (`render_mode=3` invisible text overlay)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/ocr`
5. **User-facing workflow:** Visual raster of the scanned page remains untouched while text becomes selectable/searchable.
6. **Test coverage:** `test_offline_ocr_and_all_document_conversions`
7. **Actual verification evidence:** Verified in pytest.
8. **Missing functionality:** MRC (Mixed Raster Content) compression for smaller searchable PDFs.
9. **Known defects:** None critical.
10. **Technical complexity:** Low
11. **Dependencies:** PyMuPDF
12. **Recommended next action:** None for v1.0.

### C8. Editing Recognized Text & Mixed Image/Text Documents
1. **Current status:** `PARTIAL`
2. **Relevant frontend files:** `src/App.tsx`
3. **Relevant backend files:** `backend/engine/ocr_convert.py` (`force_ocr_on_existing_text=False` skips pages with existing text)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/ocr`
5. **User-facing workflow:** On mixed image+text pages, `force_ocr_on_existing_text=False` skips the page unless forced; editing invisible OCR text doesn't erase pixels in the underlying scan image (unlike Acrobat "Edit Scanned Text" with ClearScan/inpainting).
6. **Test coverage:** None for mixed image+text OCR or inpainting-based scanned text editing.
7. **Actual verification evidence:** Inspected `ocr_convert.py:48–192`.
8. **Missing functionality:** Per-image-region OCR on mixed pages; background inpainting when editing scanned raster text.
9. **Known defects:** Skipping any page that has >0 text chars misses embedded scanned images on pages with a header/footer.
10. **Technical complexity:** Very High
11. **Dependencies:** OpenCV inpainting, PyMuPDF image bbox detection
12. **Recommended next action:** Support region-level OCR on embedded images in Phase 3.

### C9. Batch OCR Processing
1. **Current status:** `BACKEND ONLY` (partial) / `MISSING` (multi-file batch OCR)
2. **Relevant frontend files:** None
3. **Relevant backend files:** `backend/engine/ocr_convert.py` (`ocr_pdf_pages` handles multi-page single PDF; `batch_convert_documents` does NOT support OCR)
4. **Existing API endpoints:** None for multi-file batch OCR
5. **User-facing workflow:** Cannot queue a folder/list of scanned PDFs for batch OCR.
6. **Test coverage:** None
7. **Actual verification evidence:** Confirmed in `ocr_convert.py:561–604`.
8. **Missing functionality:** Multi-file batch OCR endpoint and UI queue.
9. **Known defects:** N/A
10. **Technical complexity:** Medium
11. **Dependencies:** `ocr_pdf_pages`, background task queue
12. **Recommended next action:** Add batch OCR workflow in Phase 3.

---

## Category D: Forms

### D1. Existing AcroForm Detection & Filling (Text, Checkbox, Radio, Dropdown)
1. **Current status:** `COMPLETE` (for text, checkbox, radio, dropdown)
2. **Relevant frontend files:** `src/App.tsx` (Forms mode overlays & fill)
3. **Relevant backend files:** `backend/engine/forms_signatures.py` (`list_form_fields`, `fill_form_fields`, lines 37–78, 149–175)
4. **Existing API endpoints:** `GET /api/docs/{doc_id}/forms`, `POST /api/docs/{doc_id}/forms/fill`
5. **User-facing workflow:** Open form PDF -> interactive overlays allow filling text, checkboxes, radios, dropdowns -> saved to PDF.
6. **Test coverage:** `test_forms_and_cryptographic_digital_signatures`, `compat_fixtures.py` (`acroform_synthetic`).
7. **Actual verification evidence:** Verified inspecting, filling, saving, and reopening in pytest.
8. **Missing functionality:** Keyboard tab-order navigation across form fields.
9. **Known defects:** None critical for these 4 field types.
10. **Technical complexity:** Medium
11. **Dependencies:** PyMuPDF
12. **Recommended next action:** Add tab-order support in Phase 3.

### D2. Listboxes
1. **Current status:** `BROKEN`
2. **Relevant frontend files:** `src/App.tsx`
3. **Relevant backend files:** `backend/engine/forms_signatures.py:31, 120–139` (`WIDGET_TYPE_NAMES` includes `listbox`, but `create_form_field` raises `ValueError: Unsupported form field type: listbox`)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/forms/create`
5. **User-facing workflow:** Creating a listbox crashes with HTTP 500.
6. **Test coverage:** None
7. **Actual verification evidence:** Runtime probe via `TestClient(app)` confirmed `ValueError: Unsupported form field type: listbox`.
8. **Missing functionality:** `PDF_WIDGET_TYPE_LISTBOX` creation and choice updates in `forms_signatures.py`.
9. **Known defects:** Crashes with `ValueError` / HTTP 500.
10. **Technical complexity:** Low
11. **Dependencies:** PyMuPDF
12. **Recommended next action:** Implement `PDF_WIDGET_TYPE_LISTBOX` in `create_form_field` and `update_form_field` in Phase 1.

### D3. Creating and Editing Form Fields
1. **Current status:** `PARTIAL` (Creation works for 4 types; Editing/Deleting is `BACKEND ONLY`)
2. **Relevant frontend files:** `src/App.tsx` (creates fields, but **never calls** `pdfApi.updateFormField` or `pdfApi.deleteFormField`), `src/api.ts:344–356`
3. **Relevant backend files:** `backend/engine/forms_signatures.py` (`create_form_field`, `update_form_field`, `delete_form_field`, lines 81–146, 178–239)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/forms/create`, `PUT /api/docs/{doc_id}/forms/{xref}`, `DELETE /api/docs/{doc_id}/forms/{xref}`
5. **User-facing workflow:** Users can create fields on canvas, but cannot edit properties or delete existing form fields from the UI.
6. **Test coverage:** Creation tested; `update_form_field` and `delete_form_field` not exercised in UI.
7. **Actual verification evidence:** Confirmed `updateFormField` and `deleteFormField` in `src/api.ts` have zero callers in `src/App.tsx`.
8. **Missing functionality:** Form Field Properties Inspector (rename, options, tooltip, required/read-only toggle, delete button, drag/resize).
9. **Known defects:** `create_form_field` crashes on `listbox`.
10. **Technical complexity:** Medium
11. **Dependencies:** `forms_signatures.py`, `App.tsx`
12. **Recommended next action:** Wire `updateFormField` and `deleteFormField` into Forms Inspector in Phase 3.

### D4. Field Validation & Calculated Form Fields
1. **Current status:** `MISSING`
2. **Relevant frontend files:** None
3. **Relevant backend files:** `backend/engine/forms_signatures.py` (no regex, numeric range, required-field enforcement, or `/C`/`/CO` calculation actions)
4. **Existing API endpoints:** None
5. **User-facing workflow:** Not available.
6. **Test coverage:** None
7. **Actual verification evidence:** Verified absent in `forms_signatures.py`.
8. **Missing functionality:** Required-field validation, format masks (date/number/regex), arithmetic calculations (sum/product/average/custom).
9. **Known defects:** N/A
10. **Technical complexity:** High
11. **Dependencies:** Safe expression evaluator (without arbitrary JS execution risks)
12. **Recommended next action:** Implement safe declarative field validation and calculations in Phase 3.

### D5. Form Appearance Preservation
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx`
3. **Relevant backend files:** `backend/engine/forms_signatures.py` (calls `w.update()` to regenerate `/AP /N` streams)
4. **Existing API endpoints:** `forms/fill`, `PUT /forms/{xref}`
5. **User-facing workflow:** Filled values render reliably in external PDF viewers.
6. **Test coverage:** `test_forms_and_cryptographic_digital_signatures`
7. **Actual verification evidence:** Verified persisted form values after save/reopen.
8. **Missing functionality:** Custom border styles (beveled, dashed) and rich-text form fields.
9. **Known defects:** None critical.
10. **Technical complexity:** Low
11. **Dependencies:** PyMuPDF
12. **Recommended next action:** None for v1.0.

### D6. Flattening Forms
1. **Current status:** `MISSING`
2. **Relevant frontend files:** None
3. **Relevant backend files:** `backend/engine/forms_signatures.py` (no form flatten function)
4. **Existing API endpoints:** None
5. **User-facing workflow:** Not available.
6. **Test coverage:** None
7. **Actual verification evidence:** Verified absent in `forms_signatures.py`.
8. **Missing functionality:** Bake AcroForm `/AP` appearances into static page content and remove interactive widget annotations.
9. **Known defects:** N/A
10. **Technical complexity:** Medium
11. **Dependencies:** PyMuPDF (`bake()` or appearance stream copy)
12. **Recommended next action:** Implement `flatten_form_fields` endpoint and UI button in Phase 3.

### D7. Importing and Exporting Form Data (FDF / XFDF / JSON / CSV)
1. **Current status:** `MISSING`
2. **Relevant frontend files:** None
3. **Relevant backend files:** `backend/engine/forms_signatures.py` (no FDF/XFDF/JSON import/export)
4. **Existing API endpoints:** None
5. **User-facing workflow:** Not available.
6. **Test coverage:** None
7. **Actual verification evidence:** Verified absent in `forms_signatures.py` and `app.py`.
8. **Missing functionality:** Export form field values to JSON/CSV/FDF/XFDF and import data into matching fields.
9. **Known defects:** N/A
10. **Technical complexity:** Medium
11. **Dependencies:** `forms_signatures.py`, `xml.etree` / `pikepdf`
12. **Recommended next action:** Implement FDF/XFDF/JSON/CSV form data import/export in Phase 3.

### D8. Signature Fields (Form Widgets)
1. **Current status:** `PARTIAL`
2. **Relevant frontend files:** `src/App.tsx` (Sign mode uses freeform bbox rather than selecting existing empty `/FT /Sig` form fields)
3. **Relevant backend files:** `backend/engine/forms_signatures.py` (`list_form_fields` detects signature widgets; `sign_pdf_cryptographic` creates a new field rather than signing an existing empty signature widget)
4. **Existing API endpoints:** `GET /api/docs/{doc_id}/forms`, `POST /api/docs/{doc_id}/signatures/cryptographic`
5. **User-facing workflow:** Can sign at a drawn rectangle, but clicking an existing unsigned AcroForm signature field does not trigger signing into that specific field.
6. **Test coverage:** `test_forms_and_cryptographic_digital_signatures` (creates new field on sign).
7. **Actual verification evidence:** Inspected `forms_signatures.py:394–555`.
8. **Missing functionality:** Creating empty signature fields for others to sign; signing an existing `/FT /Sig` field in-place.
9. **Known defects:** None critical.
10. **Technical complexity:** Medium
11. **Dependencies:** `pyHanko`, `forms_signatures.py`
12. **Recommended next action:** Support creating empty signature fields and signing existing signature widgets in Phase 3.

### D9. XFA Compatibility and Limitations
1. **Current status:** `MISSING`
2. **Relevant frontend files:** None (no XFA detection warning banner)
3. **Relevant backend files:** `backend/engine/forms_signatures.py` (ignores `/AcroForm /XFA`)
4. **Existing API endpoints:** None
5. **User-facing workflow:** Dynamic/static XFA forms appear empty or non-editable without warning.
6. **Test coverage:** None
7. **Actual verification evidence:** Confirmed no `XFA` handling anywhere in `backend/`.
8. **Missing functionality:** XFA detection and clear user warning banner (full dynamic XFA rendering is proprietary/legacy Adobe technology, typically `NOT APPLICABLE` for full editing, but detection + warning is essential).
9. **Known defects:** Silent lack of form fields when opening XFA PDFs.
10. **Technical complexity:** Low (for detection/warning) / Very High (for XFA rendering, out of scope)
11. **Dependencies:** `pikepdf`
12. **Recommended next action:** Detect `/AcroForm /XFA` and show clear incompatibility notice in Phase 3.

---

## Category E: Digital Signatures

### E1. Digital Signing & Certificate-Based Signing (PKCS#12)
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (Sign mode: typed/drawn/image visual signature + PKCS#12 `.p12`/`.pfx` upload or self-signed cert generator)
3. **Relevant backend files:** `backend/engine/forms_signatures.py` (`apply_visual_signature`, `generate_pkcs12_certificate`, `sign_pdf_cryptographic`, lines 245–555)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/signatures/visual`, `POST /api/signatures/generate-cert`, `POST /api/docs/{doc_id}/signatures/cryptographic`
5. **User-facing workflow:** Clearly distinguishes visual ink/image signatures (`cryptographic: False`) from PKCS#12 X.509 CMS detached signatures (`cryptographic: True`).
6. **Test coverage:** `test_forms_and_cryptographic_digital_signatures`
7. **Actual verification evidence:** Verified RSA-2048 `.p12` generation, CMS `/ByteRange` signing, save, reopen, and digest verification.
8. **Missing functionality:** PKCS#11 hardware tokens / smartcards (YubiKey, OpenSC).
9. **Known defects:** Coordinate inversion risk in `sign_pdf_cryptographic` if `bbox` exceeds page mediabox.
10. **Technical complexity:** High
11. **Dependencies:** `pyHanko`, `cryptography`, `pikepdf`
12. **Recommended next action:** Clamp signature `bbox` to mediabox; add PKCS#11 smartcard support in Phase 4.

### E2. Signature Validation & Certificate-Chain Verification
1. **Current status:** `PARTIAL` (Integrity works; Chain Validation is `BROKEN` / self-trusting)
2. **Relevant frontend files:** `src/App.tsx` (Signatures Inspector)
3. **Relevant backend files:** `backend/engine/forms_signatures.py:558–636` (`verify_pdf_signatures`)
4. **Existing API endpoints:** `GET /api/docs/{doc_id}/signatures/verify`
5. **User-facing workflow:** Displays signature validity, byte-range coverage, and tampering detection.
6. **Test coverage:** `test_forms_and_cryptographic_digital_signatures`
7. **Actual verification evidence:** Inspected lines 587–590: sets `trust_roots=[signer_cert]` and `allow_fetching=False`.
8. **Missing functionality:** Real CA trust store validation (`/etc/ssl/certs` + user-imported trusted CAs), CRL/OCSP revocation checking.
9. **Known defects:** **Security defect:** Self-trusting `trust_roots=[signer_cert]` causes any forged or untrusted self-signed certificate to report as trusted/valid without distinguishing "cryptographically intact" from "trusted by CA".
10. **Technical complexity:** High
11. **Dependencies:** `pyhanko-certvalidator`, system/user CA store
12. **Recommended next action:** Separate `intact` (digest/byte-range) from `trusted` (CA chain verified against system/user trust store) in Phase 1/3.

### E3. Timestamp Support (RFC 3161 TSA)
1. **Current status:** `MISSING`
2. **Relevant frontend files:** None
3. **Relevant backend files:** `backend/engine/forms_signatures.py` (uses static ISO timestamp string in visual seal only; no RFC 3161 TSA client)
4. **Existing API endpoints:** None
5. **User-facing workflow:** No TSA URL configuration or cryptographic timestamp embedding.
6. **Test coverage:** None
7. **Actual verification evidence:** Confirmed absent in `forms_signatures.py`.
8. **Missing functionality:** `pyhanko.sign.timestamps.HTTPTimeStamper` integration.
9. **Known defects:** N/A
10. **Technical complexity:** Medium
11. **Dependencies:** `pyHanko`, optional network access for TSA
12. **Recommended next action:** Add optional RFC 3161 TSA URL field in cryptographic signing in Phase 3.

### E4. Visible Signature Appearance
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx`
3. **Relevant backend files:** `backend/engine/forms_signatures.py`
4. **Existing API endpoints:** `signatures/visual`, `signatures/cryptographic`
5. **User-facing workflow:** Renders typed name, drawn signature, or seal with signer/reason/date.
6. **Test coverage:** `test_forms_and_cryptographic_digital_signatures`
7. **Actual verification evidence:** Verified in pytest.
8. **Missing functionality:** Custom logo/image combined with cryptographic seal appearance.
9. **Known defects:** None critical.
10. **Technical complexity:** Low
11. **Dependencies:** PyMuPDF, `pyHanko`
12. **Recommended next action:** Allow attaching a drawn/image signature graphic to cryptographic seals in Phase 3.

### E5. Multiple Signatures, Preservation & Modification Detection
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx`
3. **Relevant backend files:** `backend/engine/forms_signatures.py` (`IncrementalPdfFileWriter`, unique field naming via `pikepdf`, `verify_pdf_signatures` loops over all signatures)
4. **Existing API endpoints:** `signatures/cryptographic`, `signatures/verify`
5. **User-facing workflow:** Multiple parties can sign sequentially using incremental updates without invalidating earlier signatures; post-sign edits are flagged by `verify_pdf_signatures`.
6. **Test coverage:** `test_forms_and_cryptographic_digital_signatures` (single sig verified; multi-sig loop implemented).
7. **Actual verification evidence:** Verified `IncrementalPdfFileWriter` usage in `forms_signatures.py`.
8. **Missing functionality:** Explicit multi-signature test in pytest; UI warning when user attempts to edit/save a signed PDF (which would break signatures if non-incremental save is used).
9. **Known defects:** Non-signing edits via `SessionManager` overwrite via `doc.tobytes()`, invalidating prior `/ByteRange` signatures without warning the user first.
10. **Technical complexity:** Medium
11. **Dependencies:** `pyHanko`, `SessionManager`
12. **Recommended next action:** Add multi-signature pytest and signed-document edit warning in Phase 2/3.

### E6. Long-Term Validation (LTV / DSS) & Viewer Compatibility
1. **Current status:** `PARTIAL` (Standard CMS compatibility works; LTV/DSS is `MISSING`)
2. **Relevant frontend files:** None
3. **Relevant backend files:** `backend/engine/forms_signatures.py` (no Document Security Store `/DSS` injection)
4. **Existing API endpoints:** None for LTV
5. **User-facing workflow:** Signatures open cleanly in standard viewers as standard CMS detached signatures, but lack embedded OCSP/CRL LTV validation data.
6. **Test coverage:** Tested via `pyHanko` verifier; not tested in Okular/Acrobat/Firefox PDF.js.
7. **Actual verification evidence:** Confirmed no `/DSS` or LTV logic in `forms_signatures.py`.
8. **Missing functionality:** DSS dictionary / VRI embedding for PAdES-B-LT / LTV.
9. **Known defects:** N/A
10. **Technical complexity:** High
11. **Dependencies:** `pyHanko` DSS support, TSA
12. **Recommended next action:** Implement PAdES-LTV / DSS embedding in Phase 4.

---

## Category F: Security and Redaction

### F1. Password Protection, Encryption & Permission Restrictions
1. **Current status:** `PARTIAL` (Broken edge cases in session lifecycle & owner password fallback)
2. **Relevant frontend files:** `src/App.tsx` (Security Inspector + Unlock Modal L6005–6051)
3. **Relevant backend files:** `backend/app.py:1546–1593`, `backend/engine/security_optimize.py:16–66`, `backend/engine/session.py:183–259`
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/security/encrypt`, `POST /api/docs/{doc_id}/security/decrypt`
5. **User-facing workflow:** Set user/owner passwords, AES-256/AES-128, and granular permissions (print, modify, extract, annotate, forms, assemble); prompt for password when opening encrypted PDFs.
6. **Test coverage:** `test_security_encryption_permanent_redaction_and_optimization`, `test_session_encryption_persistence_and_export_get`.
7. **Actual verification evidence:** Runtime probe + code inspection revealed 3 defects below.
8. **Missing functionality:** Preserving original encryption when saving an opened password-protected PDF; password verification in `api_decrypt_pdf`.
9. **Known defects:**
   - **Silent encryption stripping:** `SessionManager.open_document` decrypts opened PDFs in RAM (`working_bytes = doc.tobytes()`) with `encryption_config = None`, so saving an opened encrypted PDF without re-running Encrypt silently saves it **unencrypted**.
   - **Hardcoded/weak owner password:** `security_optimize.py:32` uses `owner_password or user_password or "vellum-owner-default"`, granting full owner bypass if only `user_password` is given, or a known default password if both are empty.
   - **`api_decrypt_pdf` ignores `req.password`** (`app.py:1585–1592`) and `HistoryEntry` does not snapshot `encryption_config` on undo/redo.
10. **Technical complexity:** Medium
11. **Dependencies:** `pikepdf`, `SessionManager`
12. **Recommended next action:** Fix all 3 encryption lifecycle defects in **Phase 1 (P0)**.

### F2. Permanent Redaction, Searchable Text Removal & Sensitive Content Purge
1. **Current status:** `COMPLETE` (with regex ReDoS/cross-line caveats)
2. **Relevant frontend files:** `src/App.tsx` (Security mode redaction box draw, search-term/regex input)
3. **Relevant backend files:** `backend/engine/security_optimize.py:68–170` (`apply_permanent_redaction`), `backend/app.py:410–443` (`PageRedactionItem`, `RedactRequest`)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/security/redact`
5. **User-facing workflow:** Draw redaction boxes or enter search terms/regex -> permanently purges text, underlying image pixels, vector line art, and raw xref streams; rejects malformed payloads with HTTP 422.
6. **Test coverage:** `test_security_encryption_permanent_redaction_and_optimization`, `test_strict_redaction_validation_and_permanent_purge`.
7. **Actual verification evidence:** Verified SSN `999-42-8174` and `123-45-6789` purged from `get_text()`, `pdftotext`, and all raw PDF xref streams.
8. **Missing functionality:** Mark-for-redaction staging/preview before irreversible apply (undoable via session, but no multi-page staging list UI), redacting metadata/annotations/bookmarks/form values simultaneously in redaction pass.
9. **Known defects:**
   - **ReDoS vulnerability:** `re.compile(regex_pattern.strip())` in `security_optimize.py:134` runs unvalidated user regexes without timeout/complexity guard.
   - **Flawed regex matching:** Re-searches matched text via `page.search_for(matched_str)`, which can over-redact identical substrings elsewhere on the page and miss multi-line regex matches.
10. **Technical complexity:** Medium
11. **Dependencies:** PyMuPDF
12. **Recommended next action:** Replace `search_for(matched_str)` with coordinate span mapping and add regex timeout/validation in Phase 1.

### F3. Metadata Removal
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (Sanitize button)
3. **Relevant backend files:** `backend/engine/security_optimize.py:172–218` (`sanitize_pdf_metadata`)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/security/sanitize`
5. **User-facing workflow:** One-click sanitize scrubs `/Info`, XMP `/Metadata`, annotations, thumbnails, and JS via MuPDF `scrub()` + `pikepdf`.
6. **Test coverage:** `test_security_encryption_permanent_redaction_and_optimization`
7. **Actual verification evidence:** Verified title cleared in pytest.
8. **Missing functionality:** Granular checkboxes (choose what to scrub vs keep).
9. **Known defects:** Hardcodes `attached_files=False, embedded_files=False`.
10. **Technical complexity:** Low
11. **Dependencies:** PyMuPDF, `pikepdf`
12. **Recommended next action:** Expose granular sanitize options including attachment removal in Phase 2.

### F4. Attachment Removal & JavaScript / Active-Content Handling
1. **Current status:** `PARTIAL`
2. **Relevant frontend files:** `src/App.tsx` (Attachments sidebar can delete individual attachments)
3. **Relevant backend files:** `backend/engine/security_optimize.py:182–210`, `backend/engine/pro_features.py:432–440`
4. **Existing API endpoints:** `DELETE /api/docs/{doc_id}/attachments/{name}`, `POST /api/docs/{doc_id}/security/sanitize`
5. **User-facing workflow:** Sanitize runs `doc.scrub(javascript=True)` and renders hostile JS PDFs passively without executing JS.
6. **Test coverage:** `compat_fixtures.py` (`hostile_js_openaction_synthetic`).
7. **Actual verification evidence:** Verified hostile JS payload renders safely without execution.
8. **Missing functionality:** Bulk attachment removal in `sanitize_pdf_metadata` (`attached_files=False` hardcoded); explicit `/OpenAction`, `/AA`, `/Launch`, `/RichMedia`, `/Names/JavaScript` purging in `pikepdf` pass.
9. **Known defects:** `sanitize_pdf_metadata` leaves embedded files intact and its `pikepdf` pass does not strip `/OpenAction` or `/AA`.
10. **Technical complexity:** Low
11. **Dependencies:** PyMuPDF, `pikepdf`
12. **Recommended next action:** Strip `/OpenAction`, `/AA`, `/Names/JavaScript`, and optionally `/EmbeddedFiles` in `sanitize_pdf_metadata` in Phase 1.

### F5. Malformed PDF Handling
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (Repair PDF button in Security mode)
3. **Relevant backend files:** `backend/engine/security_optimize.py:396–431` (`repair_pdf_document`), `backend/engine/session.py`
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/repair`
5. **User-facing workflow:** Malformed/truncated PDFs can be repaired via `pikepdf` xref rebuild + MuPDF stream clean; invalid non-PDF uploads return HTTP 400.
6. **Test coverage:** `test_corrupted_pdf_graceful_recovery_and_repair`, `compat_fixtures.py` (`malformed_truncated_synthetic`).
7. **Actual verification evidence:** Verified in pytest and compatibility matrix.
8. **Missing functionality:** Automatic prompt to repair if `open_document` encounters a damaged PDF.
9. **Known defects:** None critical.
10. **Technical complexity:** Medium
11. **Dependencies:** `pikepdf`, PyMuPDF
12. **Recommended next action:** Offer auto-repair prompt on open failure in Phase 2.

### F6. Security of Local API, Path Traversal, Temp Files & Dependencies
1. **Current status:** `BROKEN` (Security hardening gaps)
2. **Relevant frontend files:** `src/api.ts`, `electron/main.cjs`
3. **Relevant backend files:** `backend/app.py:102–108, 597–654`, `backend/engine/session.py:276–277, 402–417`, `backend/engine/ocr_convert.py`, `backend/engine/pro_features.py`
4. **Existing API endpoints:** All `/api/*` endpoints
5. **User-facing workflow:** Backend listens on `127.0.0.1:18420` without authentication.
6. **Test coverage:** None for local API security/CSRF/path traversal.
7. **Actual verification evidence:** Code inspection of `app.py` and `session.py`.
8. **Missing functionality:** Per-launch bearer token / IPC shared secret, strict CORS, `doc_id` UUID validation, path sanitization.
9. **Known defects:**
   - **CORS CSRF/DNS-rebinding risk:** `allow_origins=["*"]` with `allow_credentials=True` in `app.py:102–108` allows any local browser tab to make authenticated-like requests to `127.0.0.1:18420`.
   - **No API auth token:** Any local process or malicious webpage can call `/api/docs/open-path` (reading arbitrary files like `~/.ssh/id_rsa`) and `/api/docs/{id}/download` or `/save` (overwriting arbitrary files like `~/.bashrc`).
   - **Path traversal in `recover_session`:** `session.py:402–417` interpolates unvalidated `doc_id` into `self.recovery_dir / f"{doc_id}.json"`.
   - **Unbounded upload memory reads:** `await file.read()` with no max file size.
   - **Unchecked dependency CVEs:** `pip-audit` / `npm audit` not integrated into CI.
10. **Technical complexity:** Medium
11. **Dependencies:** `electron/main.cjs`, `backend/app.py`, `src/api.ts`
12. **Recommended next action:** Implement per-session Electron-generated `X-Vellum-Token`, restrict CORS to Electron/Vite origin, validate `doc_id` as UUID, and add `pip-audit`/`npm audit` in **Phase 1 (P0)**.

---

## Category G: Annotations and Review

### G1. Highlighting, Underlining, Strikethrough
1. **Current status:** `PARTIAL`
2. **Relevant frontend files:** `src/App.tsx` (Annotate mode rubber-band box)
3. **Relevant backend files:** `backend/engine/annotations.py:78–211`
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/annotations`
5. **User-facing workflow:** Draw rectangle over text to highlight/underline/strikeout.
6. **Test coverage:** `test_annotations_and_review_workflow`
7. **Actual verification evidence:** Created and listed in pytest.
8. **Missing functionality:** Multi-line `QuadPoints` support (uses single bounding rectangle instead of text-selection quads), text-selection-driven markup (clicking/dragging over text spans directly).
9. **Known defects:** Fails to align cleanly across multi-line selections; rotated-page coordinate inversion (see A19).
10. **Technical complexity:** Medium
11. **Dependencies:** PyMuPDF (`add_highlight_annot` with `quads`)
12. **Recommended next action:** Add text-selection markup with `QuadPoints` and fix rotated coordinates in Phase 1/2.

### G2. Sticky Notes, Free-Text Comments, Ink, Shapes & Stamps
1. **Current status:** `COMPLETE` (with rotated-page defect)
2. **Relevant frontend files:** `src/App.tsx` (Annotate mode + Comments sidebar)
3. **Relevant backend files:** `backend/engine/annotations.py:12–211` (`sticky_note`, `freetext`, `ink`, `rect`, `circle`, `line`, `arrow`, 15 `STAMP_CODES`)
4. **Existing API endpoints:** `GET/POST /api/docs/{doc_id}/annotations`, `DELETE /api/docs/{doc_id}/annotations/{xref}`
5. **User-facing workflow:** Create all 9+ annotation types, view in Comments sidebar, delete by xref.
6. **Test coverage:** `test_annotations_and_review_workflow`
7. **Actual verification evidence:** Verified all 9 types created and listed in pytest; GUI screenshot `05_annotations_mode.png`.
8. **Missing functionality:** Custom image stamps, dynamic date/user stamps, callout leader lines, `garbage > 0` cleanup on delete.
9. **Known defects:** Rotated-page coordinate mismatch; `delete_annotation` uses `garbage=0` leaving orphaned AP streams; silent no-op if `xref` not found.
10. **Technical complexity:** Medium
11. **Dependencies:** PyMuPDF
12. **Recommended next action:** Fix rotated-page coords and `garbage` cleanup in Phase 1; add custom stamps in Phase 3.

### G3. Annotation Editing & Author Information
1. **Current status:** `PARTIAL` (Editing is `BACKEND ONLY`; Author is `COMPLETE`)
2. **Relevant frontend files:** `src/App.tsx` (no caller for `pdfApi.updateAnnotation`), `src/api.ts:312–319`
3. **Relevant backend files:** `backend/engine/annotations.py:213–258` (`update_annotation`)
4. **Existing API endpoints:** `PUT /api/docs/{doc_id}/annotations/{xref}`
5. **User-facing workflow:** Can set author/content at creation and delete annotations, but cannot edit existing annotation text/color/opacity from the UI.
6. **Test coverage:** `test_annotations_and_review_workflow` tests backend `PUT`.
7. **Actual verification evidence:** Confirmed `pdfApi.updateAnnotation` has zero callers in `src/App.tsx`.
8. **Missing functionality:** UI edit form in Comments sidebar / canvas click-to-edit annotation.
9. **Known defects:** None in backend `update_annotation` (other than missing rotated coord conversion).
10. **Technical complexity:** Low
11. **Dependencies:** `App.tsx`, `annotations.py`
12. **Recommended next action:** Wire `updateAnnotation` into Comments sidebar in Phase 2.

### G4. Comment Threading, Review Workflows & Annotation Import/Export
1. **Current status:** `MISSING`
2. **Relevant frontend files:** None
3. **Relevant backend files:** `backend/engine/annotations.py` (no `/IRT` reply links, no review status like Accepted/Rejected/Completed, no FDF/XFDF/JSON import/export)
4. **Existing API endpoints:** None
5. **User-facing workflow:** Not available.
6. **Test coverage:** None
7. **Actual verification evidence:** Verified absent in `annotations.py`.
8. **Missing functionality:** Threaded replies (`/IRT`), review state filtering, FDF/XFDF/JSON comment export/import.
9. **Known defects:** N/A
10. **Technical complexity:** Medium
11. **Dependencies:** `annotations.py`, `App.tsx`
12. **Recommended next action:** Implement comment threading, status, and XFDF import/export in Phase 3.

### G5. Preservation of Third-Party Annotations
1. **Current status:** `PARTIAL`
2. **Relevant frontend files:** `src/App.tsx`
3. **Relevant backend files:** `backend/engine/annotations.py`, `tests/compat_fixtures.py` (`mixed_links_annots_redact_synthetic`)
4. **Existing API endpoints:** `GET /api/docs/{doc_id}/annotations`
5. **User-facing workflow:** Unedited pages preserve existing third-party annotations; `list_annotations` lists them.
6. **Test coverage:** `compat_fixtures.py` tests link/annot preservation during unrelated text edits.
7. **Actual verification evidence:** Verified in compatibility matrix.
8. **Missing functionality:** Rendering/preserving exotic annotation subtypes (RichMedia, 3D, Screen, Sound, Redact) without stripping appearances.
9. **Known defects:** Text edits overlapping an annotation area may trigger MuPDF redactions if not guarded.
10. **Technical complexity:** Medium
11. **Dependencies:** PyMuPDF
12. **Recommended next action:** Add preservation test with LibreOffice/Acrobat-generated annotations in Phase 3.

---

## Category H: PDF Conversion

### H1. PDF to Word (.docx)
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (OCR/Convert mode)
3. **Relevant backend files:** `backend/engine/ocr_convert.py:198–239` (`convert_pdf_to_docx` via `pdf2docx` + `python-docx` fallback)
4. **Existing API endpoints:** `GET/POST /api/docs/{doc_id}/export/docx`
5. **User-facing workflow:** Export active PDF to editable `.docx` preserving paragraphs, tables, and images.
6. **Test coverage:** `test_offline_ocr_and_all_document_conversions`, `test_session_encryption_persistence_and_export_get`
7. **Actual verification evidence:** Verified non-empty valid DOCX output in pytest.
8. **Missing functionality:** Page range selection in UI for DOCX export, OCR-first option for scanned PDFs before DOCX conversion.
9. **Known defects:** Complex multi-column layouts may lose exact positioning (inherent `pdf2docx` limitation).
10. **Technical complexity:** Medium
11. **Dependencies:** `pdf2docx`, `python-docx`
12. **Recommended next action:** Add optional "Run OCR before export" toggle for scanned PDFs in Phase 3.

### H2. PDF to Excel (.xlsx / .csv)
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (Extracted Tables Modal L5704–5743)
3. **Relevant backend files:** `backend/engine/ocr_convert.py:455–558` (`extract_tables_to_xlsx` via `pdfplumber` + PyMuPDF fallback + `openpyxl`)
4. **Existing API endpoints:** `GET/POST /api/docs/{doc_id}/export/xlsx`, `csv`, `tables-json`
5. **User-facing workflow:** Extract tables, preview in modal, download styled `.xlsx` or `.csv`.
6. **Test coverage:** `test_offline_ocr_and_all_document_conversions`, `test_session_encryption_persistence_and_export_get`
7. **Actual verification evidence:** Verified in pytest.
8. **Missing functionality:** Interactive manual table-grid region selector for borderless tables.
9. **Known defects:** Borderless tables without clear whitespace/line cues may not be detected automatically.
10. **Technical complexity:** Medium
11. **Dependencies:** `pdfplumber`, `openpyxl`
12. **Recommended next action:** Add manual table area selection in Phase 3.

### H3. PDF to PowerPoint (.pptx)
1. **Current status:** `MISSING`
2. **Relevant frontend files:** None
3. **Relevant backend files:** None (`python-pptx` is not installed in `.venv` or `requirements.txt`; no PPTX converter in `ocr_convert.py`)
4. **Existing API endpoints:** None
5. **User-facing workflow:** Not available.
6. **Test coverage:** None
7. **Actual verification evidence:** Confirmed `python-pptx` missing in `.venv` and `requirements.txt`.
8. **Missing functionality:** PDF-to-PPTX conversion (slide-per-page with editable text boxes and images).
9. **Known defects:** N/A
10. **Technical complexity:** Medium
11. **Dependencies:** `python-pptx`
12. **Recommended next action:** Implement PDF-to-PPTX in Phase 3.

### H4. PDF to HTML, Plain Text, and Images
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx`
3. **Relevant backend files:** `backend/engine/ocr_convert.py:326–370, 415–452`
4. **Existing API endpoints:** `GET/POST /api/docs/{doc_id}/export/{html|txt|png|jpg}`
5. **User-facing workflow:** Export to HTML, TXT, or PNG/JPEG archive.
6. **Test coverage:** `test_offline_ocr_and_all_document_conversions`, `test_session_encryption_persistence_and_export_get`
7. **Actual verification evidence:** Verified in pytest.
8. **Missing functionality:** Custom DPI/page-range selector in UI for image export; TIFF/WebP export.
9. **Known defects:** None
10. **Technical complexity:** Low
11. **Dependencies:** PyMuPDF, Pillow
12. **Recommended next action:** Expose DPI/range options in Phase 3.

### H5. Images to PDF
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (`convertImagesToPdf`)
3. **Relevant backend files:** `backend/engine/ocr_convert.py:373–412` (`convert_images_to_pdf`)
4. **Existing API endpoints:** `POST /api/convert/images-to-pdf`
5. **User-facing workflow:** Upload multiple images -> creates multi-page PDF (`fit_image`, A4, or Letter) and opens in tab.
6. **Test coverage:** `test_offline_ocr_and_all_document_conversions`
7. **Actual verification evidence:** Verified in pytest.
8. **Missing functionality:** Drag-and-drop image reordering before PDF creation.
9. **Known defects:** None
10. **Technical complexity:** Low
11. **Dependencies:** Pillow, PyMuPDF
12. **Recommended next action:** Add image ordering UI in Phase 3.

### H6. HTML to PDF & Office Documents to PDF
1. **Current status:** `PARTIAL` (DOCX to PDF works; HTML/XLSX/PPTX to PDF are `MISSING`)
2. **Relevant frontend files:** `src/App.tsx` (`convertDocxToPdf`)
3. **Relevant backend files:** `backend/engine/ocr_convert.py:242–323` (`convert_docx_to_pdf` via headless LibreOffice with `python-docx` fallback)
4. **Existing API endpoints:** `POST /api/convert/docx-to-pdf`
5. **User-facing workflow:** Upload `.docx` -> converts via LibreOffice (or basic text fallback if LibreOffice missing) -> opens PDF tab.
6. **Test coverage:** `test_offline_ocr_and_all_document_conversions`
7. **Actual verification evidence:** Verified in pytest (LibreOffice is installed on host).
8. **Missing functionality:** `.xlsx` to PDF, `.pptx` to PDF, `.html`/URL to PDF (can leverage LibreOffice or Chromium/Electron `printToPDF`).
9. **Known defects:** If LibreOffice is absent on user's machine, DOCX fallback strips complex formatting/images/styles.
10. **Technical complexity:** Medium
11. **Dependencies:** `libreoffice-core` (optional), Electron `webContents.printToPDF`
12. **Recommended next action:** Extend LibreOffice converter to `.xlsx`/`.pptx`/`.odt` and add HTML-to-PDF via Electron/PyMuPDF in Phase 3.

### H7. PDF/A Conversion
1. **Current status:** `PARTIAL`
2. **Relevant frontend files:** `src/App.tsx` (Pro Tools Inspector)
3. **Relevant backend files:** `backend/engine/pro_features.py:557–627` (`convert_to_pdfa`)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/pro/pdfa`
5. **User-facing workflow:** Convert document to PDF/A-2b with language and title.
6. **Test coverage:** `test_pro_features_compare_watermarks_bates_bookmarks_attachments_and_pdfa`
7. **Actual verification evidence:** Verified in pytest (`gs` is installed on host).
8. **Missing functionality:** True PDF/A conversion when `gs` (Ghostscript) is absent; PDF/A-1b / PDF/A-3b validation (e.g., veraPDF).
9. **Known defects:** **Pseudo-PDF/A fallback:** Without Ghostscript (`gs` is NOT in `.deb` Depends/Recommends!), `convert_to_pdfa` only stamps XMP `pdfaid` tags without embedding fonts, flattening transparency, or setting ICC output intent — producing non-compliant PDF/A files.
10. **Technical complexity:** High
11. **Dependencies:** Ghostscript (`gs`), `pikepdf`
12. **Recommended next action:** Bundle or declare `ghostscript` in packaging/warnings and return explicit `compliant_conversion: false` warning if `gs` is missing in Phase 1/4.

### H8. PDF Optimization and Compression
1. **Current status:** `PARTIAL`
2. **Relevant frontend files:** `src/App.tsx` (Security/Optimize Inspector)
3. **Relevant backend files:** `backend/engine/security_optimize.py:274–360` (`optimize_and_compress_pdf`)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/optimize`
5. **User-facing workflow:** Set JPEG quality, max image dimension, and linearization flag -> compresses PDF.
6. **Test coverage:** `test_security_encryption_permanent_redaction_and_optimization`
7. **Actual verification evidence:** Verified size reduction in pytest.
8. **Missing functionality:** Subset unused font glyphs, preserve alpha masks during image compression, detailed space-audit breakdown.
9. **Known defects:** **Alpha transparency corruption:** `optimize_and_compress_pdf` (lines 305–316) converts RGBA images with `.convert("RGB")` and saves as JPEG, turning transparent PNG backgrounds black.
10. **Technical complexity:** Medium
11. **Dependencies:** Pillow, PyMuPDF, `pikepdf`
12. **Recommended next action:** Preserve alpha/SMask channels (compress as PNG/Flate or separate SMask) in Phase 1.

### H9. Batch Conversions
1. **Current status:** `BACKEND ONLY`
2. **Relevant frontend files:** None (`batch_convert_documents` is not in `src/api.ts` or `src/App.tsx`)
3. **Relevant backend files:** `backend/engine/ocr_convert.py:561–604` (`batch_convert_documents`), `backend/app.py:1529–1541` (`POST /api/convert/batch`)
4. **Existing API endpoints:** `POST /api/convert/batch`
5. **User-facing workflow:** Backend supports multi-file conversion to ZIP, but no UI exists.
6. **Test coverage:** None (no pytest test calls `/api/convert/batch`!).
7. **Actual verification evidence:** Confirmed `/api/convert/batch` absent from `src/api.ts`, `src/App.tsx`, and `tests/`.
8. **Missing functionality:** Frontend Batch Processing modal/workflow and pytest test.
9. **Known defects:** Untested endpoint.
10. **Technical complexity:** Low
11. **Dependencies:** `ocr_convert.py`, `App.tsx`
12. **Recommended next action:** Add pytest coverage and wire Batch Convert UI in Phase 3.

---

## Category I: Advanced Features

### I1. PDF Document Comparison (Visual & Text)
1. **Current status:** `COMPLETE` (with multi-page mismatch caveat)
2. **Relevant frontend files:** `src/App.tsx` (Comparison Report Modal L5745–5791)
3. **Relevant backend files:** `backend/engine/pro_features.py:23–101` (`compare_pdf_documents`), `backend/engine/utils.py:245–302` (`compare_page_renders`)
4. **Existing API endpoints:** `POST /api/docs/compare`
5. **User-facing workflow:** Compare two open tabs -> shows per-page similarity %, highlighted pixel diff image, and unified text diff.
6. **Test coverage:** `test_pro_features_compare_watermarks_bates_bookmarks_attachments_and_pdfa`
7. **Actual verification evidence:** Verified diff detection in pytest and GUI screenshot `10_pro_compare_mode.png`.
8. **Missing functionality:** Comparing extra pages when `len(doc_a) != len(doc_b)` (currently stops at `min(len(doc_a), len(doc_b))`).
9. **Known defects:** Extra trailing pages in longer documents are ignored in the comparison array (`pro_features.py:38`); typo `"changed_Area_percent"` in `utils.py:297`.
10. **Technical complexity:** Medium
11. **Dependencies:** Pillow, `difflib`, PyMuPDF
12. **Recommended next action:** Report unmatched trailing pages as 0% similarity in Phase 4.

### I2. Bookmarks and Outlines
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (Left Sidebar Bookmarks tab)
3. **Relevant backend files:** `backend/engine/pro_features.py:315–372` (`get_bookmarks`, `add_bookmark`, `delete_bookmark`)
4. **Existing API endpoints:** `GET/POST /api/docs/{doc_id}/bookmarks`, `DELETE /api/docs/{doc_id}/bookmarks/{index}`
5. **User-facing workflow:** View, jump to, add, and delete outline bookmarks.
6. **Test coverage:** `test_pro_features_compare_watermarks_bates_bookmarks_attachments_and_pdfa`
7. **Actual verification evidence:** Verified in pytest.
8. **Missing functionality:** Drag-to-reorder/nest bookmark hierarchy, edit existing bookmark title/destination.
9. **Known defects:** None critical.
10. **Technical complexity:** Low
11. **Dependencies:** PyMuPDF
12. **Recommended next action:** Add bookmark rename/nesting in Phase 4.

### I3. Table of Contents Editing (Printable TOC Generation)
1. **Current status:** `MISSING`
2. **Relevant frontend files:** None
3. **Relevant backend files:** None (outline bookmarks exist, but no printable TOC page generator)
4. **Existing API endpoints:** None
5. **User-facing workflow:** Not available.
6. **Test coverage:** None
7. **Actual verification evidence:** Confirmed absent in `pro_features.py`.
8. **Missing functionality:** Generate a clickable, formatted Table of Contents page from document outline/headings.
9. **Known defects:** N/A
10. **Technical complexity:** Medium
11. **Dependencies:** `pro_features.py`
12. **Recommended next action:** Implement in Phase 4.

### I4. Attachments & PDF Portfolios
1. **Current status:** `PARTIAL` (Attachments `COMPLETE`; PDF Portfolios `MISSING`)
2. **Relevant frontend files:** `src/App.tsx` (Left Sidebar Attachments tab)
3. **Relevant backend files:** `backend/engine/pro_features.py:378–440` (`list_attachments`, `add_attachment`, `extract_attachment`, `delete_attachment`)
4. **Existing API endpoints:** `GET/POST /api/docs/{doc_id}/attachments`, `GET/DELETE /api/docs/{doc_id}/attachments/{name}`
5. **User-facing workflow:** List, add, download, and delete `/EmbeddedFiles` attachments.
6. **Test coverage:** `test_pro_features_compare_watermarks_bates_bookmarks_attachments_and_pdfa`
7. **Actual verification evidence:** Verified CSV attachment add/extract in pytest.
8. **Missing functionality:** True PDF Portfolios (`/Root /Collection` navigator schemas, folder hierarchies, cover sheet).
9. **Known defects:** None for basic attachments.
10. **Technical complexity:** Medium (Portfolios)
11. **Dependencies:** `pikepdf`, PyMuPDF
12. **Recommended next action:** Add `/Collection` portfolio support in Phase 4 if prioritized.

### I5. Document Metadata
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (Document Properties Modal L5670–5702, `Ctrl+D`)
3. **Relevant backend files:** `backend/engine/security_optimize.py:220–272` (`get_document_properties`, `set_document_properties`)
4. **Existing API endpoints:** `GET/PUT /api/docs/{doc_id}/properties`
5. **User-facing workflow:** View and edit Title, Author, Subject, Keywords, Creator, Producer.
6. **Test coverage:** `test_session_encryption_persistence_and_export_get`
7. **Actual verification evidence:** Verified in pytest.
8. **Missing functionality:** Custom XMP metadata properties editor.
9. **Known defects:** None
10. **Technical complexity:** Low
11. **Dependencies:** PyMuPDF
12. **Recommended next action:** None for v1.0.

### I6. PDF Accessibility, Tagged PDFs, Reading Order & PDF/UA Compliance
1. **Current status:** `PARTIAL` (Heuristic checker only; true Tagging / Reading Order / PDF/UA `MISSING`)
2. **Relevant frontend files:** `src/App.tsx` (Preflight report view)
3. **Relevant backend files:** `backend/engine/pro_features.py:446–554` (`run_preflight_and_accessibility_check`)
4. **Existing API endpoints:** `GET /api/docs/{doc_id}/pro/preflight`
5. **User-facing workflow:** Runs 7-point heuristic check (title, `/Lang`, `/MarkInfo`, text layer, bookmarks, fonts, PDF/A).
6. **Test coverage:** `test_pro_features_compare_watermarks_bates_bookmarks_attachments_and_pdfa`
7. **Actual verification evidence:** Verified `pro_features.py:446–554` does NOT inspect or edit `/StructTreeRoot`.
8. **Missing functionality:** `/StructTreeRoot` tag tree inspector/editor (`<P>`, `<H1>`, `<Table>`, alt text), reading order editor, auto-tagger, ISO 14289 PDF/UA validation.
9. **Known defects:** **False positive in preflight:** Reports document as "Tagged PDF" if `/MarkInfo /Marked: True` is set, even when `/StructTreeRoot` is empty or absent.
10. **Technical complexity:** Very High
11. **Dependencies:** `pikepdf` structure tree manipulation
12. **Recommended next action:** Fix `/StructTreeRoot` check in Phase 1/4; build Tag Tree & Reading Order editor in Phase 4.

### I7. Preflight Validation
1. **Current status:** `PARTIAL`
2. **Relevant frontend files:** `src/App.tsx`
3. **Relevant backend files:** `backend/engine/pro_features.py:446–554`
4. **Existing API endpoints:** `GET /api/docs/{doc_id}/pro/preflight`
5. **User-facing workflow:** Checks font embedding, PDF/A metadata, and basic accessibility flags.
6. **Test coverage:** `test_pro_features_compare_watermarks_bates_bookmarks_attachments_and_pdfa`
7. **Actual verification evidence:** Inspected `pro_features.py`.
8. **Missing functionality:** Prepress/print preflight profiles (image DPI threshold, CMYK vs RGB color space audit, spot colors, ink coverage, trim/bleed box validation).
9. **Known defects:** Superficial tagged-PDF check (see I6).
10. **Technical complexity:** High
11. **Dependencies:** `pikepdf`, PyMuPDF
12. **Recommended next action:** Add print-production preflight checks in Phase 4.

### I8. Batch Processing, Automation & Command-Line Functionality
1. **Current status:** `PARTIAL` (CLI opens a file in GUI; batch conversion is `BACKEND ONLY`; automation pipelines `MISSING`)
2. **Relevant frontend files:** None
3. **Relevant backend files:** `electron/main.cjs:434–440` (CLI `.pdf` arg opens in GUI), `backend/engine/ocr_convert.py:561–604` (`batch_convert_documents`)
4. **Existing API endpoints:** `POST /api/convert/batch`
5. **User-facing workflow:** Passing `vellum-pdf-pro file.pdf` opens the file in the desktop app; no headless CLI subcommands (`--ocr`, `--merge`, `--compress`) or Action Wizard batch pipelines exist.
6. **Test coverage:** None for CLI file open or `/api/convert/batch`.
7. **Actual verification evidence:** Inspected `electron/main.cjs` and `ocr_convert.py`.
8. **Missing functionality:** Action Wizard / batch pipeline runner (apply watermark + Bates + optimize + encrypt to folder), headless CLI flags.
9. **Known defects:** None
10. **Technical complexity:** High
11. **Dependencies:** `backend/engine/*`, CLI entrypoint
12. **Recommended next action:** Wire batch convert UI in Phase 3; Action Wizard & headless CLI in Phase 4.

### I9. Print Production Tools
1. **Current status:** `MISSING` (aside from OS `webContents.print()`)
2. **Relevant frontend files:** None
3. **Relevant backend files:** None
4. **Existing API endpoints:** None
5. **User-facing workflow:** Only standard print (`Ctrl+P`).
6. **Test coverage:** None
7. **Actual verification evidence:** Verified absent across codebase.
8. **Missing functionality:** Output preview / color separations, ink manager, RGB->CMYK conversion, printer marks (crop/bleed/registration marks), trap presets, imposition.
9. **Known defects:** N/A
10. **Technical complexity:** Very High
11. **Dependencies:** Ghostscript / LittleCMS (`lcms2`), `pikepdf`
12. **Recommended next action:** Scope to Phase 4 (Advanced Professional Release).

### I10. Advanced Search and Replacement
1. **Current status:** `PARTIAL` (Read-only Search `COMPLETE`; Search & Replace `MISSING`)
2. **Relevant frontend files:** `src/App.tsx` (search bar in top menubar, `Ctrl+F`, canvas hit highlights)
3. **Relevant backend files:** `backend/app.py:766–789` (`search_document`); NO search-and-replace function anywhere in `backend/engine/`
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/search`
5. **User-facing workflow:** Search highlights matches on pages; cannot replace text across page/document.
6. **Test coverage:** Tested indirectly in GUI scripts.
7. **Actual verification evidence:** Confirmed no search-and-replace endpoint or engine function exists.
8. **Missing functionality:** Regex search, whole-word search, and Find & Replace (single or Replace All across document using `edit_text_span`).
9. **Known defects:** N/A
10. **Technical complexity:** High
11. **Dependencies:** `direct_edit.py` (`edit_text_span`)
12. **Recommended next action:** Implement Find & Replace in Phase 2.

---

## Category J: Desktop User Experience

### J1. Frameless Window, Window Controls, Themes & Branding
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (`header.top-menubar`, `.window-controls`, `Ctrl+Shift+T`, About modal), `src/styles.css`
3. **Relevant backend files:** N/A
4. **Existing API endpoints:** N/A
5. **User-facing workflow:** Custom frameless dark/light header with drag region, double-click maximize, minimize/maximize/close controls, and Vellum PDF Pro Branding Kit v2 assets.
6. **Test coverage:** `scripts/verify_about_dialog_logo.cjs`, `docs/screenshots/frameless-*.png`, `branded-*.png`.
7. **Actual verification evidence:** Verified via Electron CDP scripts and screenshots.
8. **Missing functionality:** None critical.
9. **Known defects:** None critical.
10. **Technical complexity:** Low
11. **Dependencies:** Electron 43, `preload.cjs`
12. **Recommended next action:** Maintain visual regression checks.

### J2. Desktop Launcher & Dock Integration
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `electron/main.cjs` (`app.setName('vellum-pdf-pro')`, icon resolution)
3. **Relevant backend files:** `scripts/build_packages.sh:108–141` (`vellum-pdf-pro.desktop`, hicolor icons 16–512 + SVG, `MimeType=application/pdf;`)
4. **Existing API endpoints:** N/A
5. **User-facing workflow:** Desktop entry, PDF MIME association, dock icon, and CLI file-open argument.
6. **Test coverage:** `scripts/verify_about_dialog_logo.cjs`
7. **Actual verification evidence:** Verified in `.deb` and `.AppImage` package structure.
8. **Missing functionality:** Verification of actual `sudo dpkg -i` installation on clean Ubuntu/Debian/Fedora desktop sessions.
9. **Known defects:** None known in `.desktop` file; note Wayland `StartupWMClass` / `ozone-platform` hints are not explicitly configured.
10. **Technical complexity:** Low
11. **Dependencies:** `xdg-utils`, `gtk-update-icon-cache`
12. **Recommended next action:** Test clean `.deb` and `.AppImage` desktop integration in Phase 5.

### J3. Keyboard Shortcuts & Context Menus
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx:721–784, 1362–1440, 3974–3986, 4087–4173`
3. **Relevant backend files:** N/A
4. **Existing API endpoints:** N/A
5. **User-facing workflow:** 20+ shortcuts (`Ctrl+N/O/S/D/P/Z/Y/F/E/K/W`, `F1/F9/F10`, arrows, `Escape`, `Delete`, `Ctrl+B/I`) + right-click canvas object context menu.
6. **Test coverage:** Exercised in GUI verification scripts.
7. **Actual verification evidence:** Verified in `App.tsx` and GUI scripts.
8. **Missing functionality:** Customizable keybindings, context menus on page thumbnails (insert/delete/rotate/extract right-click) and bookmarks.
9. **Known defects:** None critical.
10. **Technical complexity:** Low
11. **Dependencies:** `App.tsx`
12. **Recommended next action:** Add right-click context menu on page thumbnails in Phase 2.

### J4. Multiple Document Tabs, Drag-and-Drop Opening & File Dialogs
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx:2043–2053, 2526–2557`, `electron/main.cjs:462–485`
3. **Relevant backend files:** `backend/app.py` (`open-upload`, `open-path`, `save`)
4. **Existing API endpoints:** `POST /api/docs/open-upload`, `open-path`, `save`, `DELETE /api/docs/{doc_id}`
5. **User-facing workflow:** Multi-tab bar with dirty indicators and lock icons, drag-and-drop `.pdf` files onto window, native Electron Open/Save dialogs.
6. **Test coverage:** `scripts/run_gui_tests.cjs`, `test_health_and_showcase_lifecycle`
7. **Actual verification evidence:** Verified in GUI tests and pytest.
8. **Missing functionality:** Tab drag-reordering, dirty-tab unsaved-changes confirmation dialog before closing tab/window.
9. **Known defects:** Closing a dirty tab or closing the main window does NOT prompt "Save changes before closing?" (relies silently on crash recovery snapshots).
10. **Technical complexity:** Low
11. **Dependencies:** `App.tsx`, `electron/main.cjs`
12. **Recommended next action:** Add non-blocking unsaved-changes confirmation modal on tab/app close in Phase 1.

### J5. Recent Documents
1. **Current status:** `MISSING`
2. **Relevant frontend files:** None (`src/App.tsx` has no recent files state or menu items)
3. **Relevant backend files:** None (`electron/main.cjs` does not call `app.addRecentDocument`)
4. **Existing API endpoints:** None
5. **User-facing workflow:** Not available.
6. **Test coverage:** None
7. **Actual verification evidence:** `grep` across `src/App.tsx` and `electron/main.cjs` confirmed zero matches.
8. **Missing functionality:** Recent documents list in File menu and welcome/empty state, persisted across restarts.
9. **Known defects:** N/A
10. **Technical complexity:** Low
11. **Dependencies:** `localStorage` or Electron `app.getPath('userData')` JSON store
12. **Recommended next action:** Implement Recent Documents menu & persistence in Phase 2.

### J6. Save, Save As, Autosave & Crash Recovery
1. **Current status:** `PARTIAL` (Save/Save As/Recovery work; Discard Recovery button `BACKEND ONLY` & silent snapshot errors)
2. **Relevant frontend files:** `src/App.tsx:519, 5793–5835` (Recovery modal has Restore, lacks Discard)
3. **Relevant backend files:** `backend/engine/session.py:261–312, 363–417` (`safe_save` atomic write + `.bak`, `_write_recovery_snapshot` on every mutation)
4. **Existing API endpoints:** `POST /api/docs/{doc_id}/save`, `GET /api/recovery`, `POST /api/recovery/{doc_id}/restore`, `DELETE /api/recovery/{doc_id}`
5. **User-facing workflow:** Safe atomic Save/Save As with `.bak` backup; automatic mutation snapshots appear in Crash Recovery Manager after restart.
6. **Test coverage:** `test_health_and_showcase_lifecycle`, `test_crash_recovery_journal`
7. **Actual verification evidence:** Verified atomic `.bak` save and session recovery in pytest.
8. **Missing functionality:** "Discard" button in Crash Recovery modal (`discardRecovery` is in `src/api.ts:132` but unused in `App.tsx`), startup toast prompting recovery automatically when snapshots exist, debounced async snapshot writes instead of synchronous write on every edit.
9. **Known defects:**
   - Synchronous full-PDF disk write on every mutation stalls large documents.
   - `_write_recovery_snapshot` swallows all exceptions silently (`except Exception: pass`).
   - `recover_session` vulnerable to `doc_id` path traversal (`session.py:402–417`).
10. **Technical complexity:** Medium
11. **Dependencies:** `session.py`, `App.tsx`
12. **Recommended next action:** Fix path traversal, debounce snapshots, surface recovery errors, and wire Discard button in Phase 1.

### J7. High-DPI Displays & Responsive Window Resizing
1. **Current status:** `PARTIAL` (Responsive resizing `COMPLETE`; High-DPI canvas `PARTIAL`)
2. **Relevant frontend files:** `src/App.tsx`, `src/styles.css`
3. **Relevant backend files:** `backend/app.py:703–736` (`render_page` renders at requested `dpi`)
4. **Existing API endpoints:** `GET /api/docs/{doc_id}/pages/{page_index}/render`
5. **User-facing workflow:** Window resizes cleanly at 1024x680, 1280x800, 1520x940, and maximized.
6. **Test coverage:** `docs/screenshots/frameless-responsive-*.png`, `responsive-1024x680.png`.
7. **Actual verification evidence:** Verified layout screenshots across resolutions; `devicePixelRatio` scaling not explicitly verified in `renderPage` DPI calculation.
8. **Missing functionality:** Automatic `window.devicePixelRatio` DPI multiplier for crisp HiDPI/4K page rendering without manual zoom.
9. **Known defects:** On 2x HiDPI displays at 100% zoom, fixed 144 DPI bitmaps can look slightly soft compared to native 288 DPI rendering.
10. **Technical complexity:** Low
11. **Dependencies:** `src/App.tsx`
12. **Recommended next action:** Multiply render DPI by `Math.min(window.devicePixelRatio || 1, 2)` in Phase 2.

### J8. Keyboard Accessibility & Screen-Reader Compatibility
1. **Current status:** `PARTIAL` (Minimal ARIA; largely inaccessible to screen readers)
2. **Relevant frontend files:** `src/App.tsx` (only 7 `aria-*` / `role=` attributes in 6,055 lines: window controls + rich inline editor)
3. **Relevant backend files:** N/A
4. **Existing API endpoints:** N/A
5. **User-facing workflow:** Global keyboard shortcuts work, but menus, tabs, sidebars, modals, and canvas objects lack ARIA roles, `aria-expanded`, focus trapping in modals, and `aria-live` status announcements.
6. **Test coverage:** None (no axe-core or accessibility audit).
7. **Actual verification evidence:** `grep` on `src/App.tsx` found only 7 `aria-*`/`role=` occurrences.
8. **Missing functionality:** Full WAI-ARIA landmarks/roles, modal focus traps, accessible form labels, `aria-live` notifications, keyboard focus management.
9. **Known defects:** Screen readers cannot navigate the 7 top menus, 5 sidebar tabs, or 9 modals reliably.
10. **Technical complexity:** Medium
11. **Dependencies:** `src/App.tsx` (component decomposition helps significantly)
12. **Recommended next action:** Add ARIA roles, focus trapping, and `axe-core` checks in Phase 5.

### J9. Error Reporting & Loading Indicators
1. **Current status:** `COMPLETE`
2. **Relevant frontend files:** `src/App.tsx` (`.notice-banner`, status bar backend state, Backend Diagnostics Modal L5921–6003, non-blocking notifications — zero `window.alert`/`confirm`/`prompt`)
3. **Relevant backend files:** `backend/app.py`, `electron/main.cjs:17–33, 449`
4. **Existing API endpoints:** `GET /api/health`
5. **User-facing workflow:** Non-blocking banner messages, loading states, and detailed backend diagnostics modal with live logs and Restart Backend button.
6. **Test coverage:** Static regex check in `test_textbox_inline_editing_wrapping_coordinates_and_lifecycle` enforces zero blocking browser dialogs.
7. **Actual verification evidence:** Verified in `App.tsx` and pytest.
8. **Missing functionality:** Progress bar (% complete) for long-running operations (multi-page OCR, large optimize, batch convert).
9. **Known defects:** Backend uncaught exceptions (`KeyError` on missing `doc_id`, `ValueError` on `listbox`) surface raw HTTP 500 strings instead of clean 400/404 messages.
10. **Technical complexity:** Low
11. **Dependencies:** `backend/app.py`, `src/App.tsx`
12. **Recommended next action:** Map `KeyError` -> 404 and `ValueError` -> 400 globally in `backend/app.py` in Phase 1.

### J10. Large-File Responsiveness
1. **Current status:** `PARTIAL` / `NOT TESTED` (beyond 40 pages)
2. **Relevant frontend files:** `src/App.tsx`
3. **Relevant backend files:** `backend/app.py:738–764` (`render_thumbnails`), `backend/engine/session.py` (`HistoryEntry`, `_write_recovery_snapshot`)
4. **Existing API endpoints:** `GET /api/docs/{doc_id}/thumbnails`, `render`
5. **User-facing workflow:** Responsive on 1–40 page test PDFs.
6. **Test coverage:** 40-page synthetic PDF in `compat_fixtures.py`; no 200+ page / 100+ MB stress benchmark.
7. **Actual verification evidence:** Code inspection of `session.py` and `app.py`.
8. **Missing functionality:** Paginated/lazy thumbnails, streaming uploads, disk-backed/delta undo history, background async rendering.
9. **Known defects:** Full-PDF RAM undo stack + synchronous recovery disk write + all-pages thumbnail rendering in one call will degrade or OOM on very large PDFs.
10. **Technical complexity:** High
11. **Dependencies:** `session.py`, `app.py`, `App.tsx`
12. **Recommended next action:** Benchmark 200+ page / 100+ MB PDFs and paginate thumbnails + optimize undo/recovery storage in Phase 1/5.

---

## Category K: Linux Distribution and Reliability

### K1. Ubuntu & Debian Compatibility
1. **Current status:** `PARTIAL`
2. **Relevant frontend files:** N/A
3. **Relevant backend files:** `scripts/build_packages.sh:144–159`, `.github/workflows/ci.yml`
4. **Existing API endpoints:** N/A
5. **User-facing workflow:** Built and tested on Ubuntu 24.04 (`ubuntu-24.04` in CI).
6. **Test coverage:** `.deb` extracted rootlessly and verified; `sudo dpkg -i` on clean Ubuntu 22.04/24.04 and Debian 12/13 VMs not tested.
7. **Actual verification evidence:** `RELEASE_READINESS.md:38–43` explicitly notes rootless extraction was used.
8. **Missing functionality:** Clean VM/container `dpkg -i` / `apt install` verification across Ubuntu 22.04, 24.04, and Debian 12.
9. **Known defects:** Bundles build-host CPython (`sys.base_prefix`) and `.so` wheels; if build host glibc is newer than target Debian/Ubuntu LTS, binary wheels or CPython may fail with `GLIBC_2.xx not found`.
10. **Technical complexity:** Medium
11. **Dependencies:** Docker/VM test matrix
12. **Recommended next action:** Build on oldest supported base (e.g., Ubuntu 22.04) and test `apt install ./vellum-pdf-pro_*.deb` across Ubuntu/Debian in Phase 5.

### K2. Other Major Linux Distributions (Fedora, Arch, openSUSE)
1. **Current status:** `NOT TESTED`
2. **Relevant frontend files:** N/A
3. **Relevant backend files:** `scripts/build_packages.sh` (AppImage), `backend/engine/utils.py` (hardcoded Debian font paths)
4. **Existing API endpoints:** N/A
5. **User-facing workflow:** AppImage is intended for cross-distro use, but untested outside Ubuntu.
6. **Test coverage:** None
7. **Actual verification evidence:** Confirmed CI only runs `ubuntu-24.04`; `utils.py:128–150` hardcodes `/usr/share/fonts/truetype/dejavu/...` (Fedora uses `/usr/share/fonts/dejavu-sans-fonts/`, Arch uses `/usr/share/fonts/TTF/`).
8. **Missing functionality:** Cross-distro fontconfig lookup, AppImage testing on Fedora/Arch/openSUSE, optional `.rpm` or Flatpak packaging.
9. **Known defects:** TrueType font fallback in `utils.py` will fail on Fedora/Arch due to Debian-specific font paths; AppImage requires `libfuse2` on some distros or `--appimage-extract-and-run`.
10. **Technical complexity:** Medium
11. **Dependencies:** `fontconfig`, distro test containers/VMs
12. **Recommended next action:** Fix `utils.py` font resolution via `fc-match` and test AppImage on Fedora/Arch in Phase 5.

### K3. X11 & Wayland Support
1. **Current status:** `PARTIAL` (X11 `COMPLETE`; Wayland `NOT TESTED`)
2. **Relevant frontend files:** `electron/main.cjs`
3. **Relevant backend files:** `scripts/build_packages.sh:104, 208`
4. **Existing API endpoints:** N/A
5. **User-facing workflow:** Tested under `DISPLAY=:0` (X11/XWayland).
6. **Test coverage:** `scripts/verify_mixed_format_gui.cjs` runs on `DISPLAY=:0`.
7. **Actual verification evidence:** No native Wayland (`--ozone-platform-hint=auto`) flag or Wayland session test exists.
8. **Missing functionality:** Native Wayland Ozone testing (`--ozone-platform-hint=auto`), Wayland window drag/maximize verification with frameless `frame: false`.
9. **Known defects:** Frameless Electron windows under native Wayland sometimes behave differently from X11 unless tested with Ozone.
10. **Technical complexity:** Low
11. **Dependencies:** Electron 43 Ozone/Wayland
12. **Recommended next action:** Test native Wayland session and evaluate `--ozone-platform-hint=auto` in Phase 5.

### K4. AppImage & Debian `.deb` Packaging & Desktop Integration
1. **Current status:** `PARTIAL`
2. **Relevant frontend files:** `electron/main.cjs`
3. **Relevant backend files:** `scripts/build_packages.sh`
4. **Existing API endpoints:** N/A
5. **User-facing workflow:** Produces `vellum-pdf-pro_1.0.0_amd64.deb` (450 MB) and `Vellum_PDF_Pro-1.0.0-x86_64.AppImage` (389 MB) with `.desktop` file and icons.
6. **Test coverage:** `scripts/verify_mixed_format_gui.cjs` ran against AppImage; `.deb` extracted rootlessly.
7. **Actual verification evidence:** Verified artifacts in `release/` and `SHA256SUMS`.
8. **Missing functionality:** Package size optimization (~389–450 MB includes unused `opencv-python` GUI + `onnxruntime` + full Python stdlib tests), removal of `--no-sandbox` requirement via proper `chrome-sandbox` permissions in `.deb` or documented AppImage behavior.
9. **Known defects:**
   - Hardcoded `--no-sandbox` in `vellum-launcher.sh` and `AppRun` weakens Chromium renderer sandboxing.
   - `build_packages.sh` downloads `runtime-x64` from GitHub `continuous` tag if not cached, which is non-reproducible across builds.
10. **Technical complexity:** Medium
11. **Dependencies:** `scripts/build_packages.sh`
12. **Recommended next action:** Pin AppImage runtime SHA-256, audit bundled `opencv-python` duplication (`opencv-python` AND `opencv-python-headless` are both in `requirements.txt`), and test `chrome-sandbox` in `.deb` in Phase 5.

### K5. Runtime Dependencies, Offline Operation & Clean Install/Removal
1. **Current status:** `COMPLETE` (Offline self-contained Python/Electron) / `PARTIAL` (Optional OS tools)
2. **Relevant frontend files:** `electron/main.cjs`
3. **Relevant backend files:** `scripts/build_packages.sh`, `requirements.txt`
4. **Existing API endpoints:** N/A
5. **User-facing workflow:** Core editing, RapidOCR, pyHanko, pdf2docx, pikepdf, and PyMuPDF run 100% offline inside bundled CPython 3.11.
6. **Test coverage:** Clean isolated environment test documented in `RELEASE_READINESS.md`.
7. **Actual verification evidence:** Bundled runtime verified via AppImage GUI test.
8. **Missing functionality:** `ghostscript` is NOT listed in `.deb` `Depends`/`Recommends` despite `convert_to_pdfa` relying on `gs` for real PDF/A conversion; clean `dpkg -r` / `dpkg -P` verification test.
9. **Known defects:** Duplicate OpenCV packages (`opencv-python` and `opencv-python-headless` both listed in `requirements.txt`).
10. **Technical complexity:** Low
11. **Dependencies:** `requirements.txt`, `scripts/build_packages.sh`
12. **Recommended next action:** Add `ghostscript` to `.deb` Recommends, deduplicate OpenCV in `requirements.txt`, and verify install/purge lifecycle in Phase 5.

### K6. Application Updates
1. **Current status:** `MISSING`
2. **Relevant frontend files:** None
3. **Relevant backend files:** None (`electron-updater` / AppImageUpdate not integrated)
4. **Existing API endpoints:** None
5. **User-facing workflow:** No "Check for Updates" or auto-update mechanism.
6. **Test coverage:** None
7. **Actual verification evidence:** Confirmed absent in `package.json` and `electron/main.cjs`.
8. **Missing functionality:** Optional update check (respecting offline-first privacy) or release notification link.
9. **Known defects:** N/A
10. **Technical complexity:** Medium
11. **Dependencies:** GitHub Releases / `electron-updater`
12. **Recommended next action:** Add manual "Check for Updates" in Help menu (opt-in, offline-safe) in Phase 5.

### K7. Error Logging, Crash Recovery & Backend Process Lifecycle
1. **Current status:** `COMPLETE` (Backend lifecycle & logging) / `PARTIAL` (Crash recovery UX)
2. **Relevant frontend files:** `src/App.tsx` (Backend Diagnostics Modal)
3. **Relevant backend files:** `electron/main.cjs:62–232, 524–533` (`resolveBackendPort`, `ensureBackendRunning`, `terminateBackendProcess`), `backend/engine/session.py`
4. **Existing API endpoints:** `GET /api/health`, `/api/recovery`
5. **User-facing workflow:** Electron manages dynamic port selection, spawns Python sidecar, buffers 120 log lines, supports manual restart, and cleans up with `SIGTERM`->`SIGKILL` on exit.
6. **Test coverage:** `tests/test_backend_startup_lifecycle.py` (5 tests pass).
7. **Actual verification evidence:** Verified port binding, multi-instance isolation, and clean `SIGTERM` shutdown.
8. **Missing functionality:** Persistent rotating log file on disk (`~/.local/share/vellum-pdf/logs/`) for post-crash bug reports; automatic backend crash-restart prompt if Python exits unexpectedly mid-session.
9. **Known defects:** Logs are only kept in memory (`recentBackendLogs` max 120 lines) and lost if Electron exits.
10. **Technical complexity:** Low
11. **Dependencies:** `electron/main.cjs`
12. **Recommended next action:** Add rotating file logging in `~/.local/share/vellum-pdf/logs/` in Phase 1/5.

### K8. Memory Leaks, Large-Document Performance & Release Reproducibility
1. **Current status:** `PARTIAL`
2. **Relevant frontend files:** `src/App.tsx`
3. **Relevant backend files:** `backend/engine/session.py`, `scripts/build_packages.sh`, `.github/workflows/ci.yml`
4. **Existing API endpoints:** N/A
5. **User-facing workflow:** Works smoothly on small-to-medium documents.
6. **Test coverage:** No long-running soak/memory test; no `tsc --noEmit` or GUI test in `.github/workflows/ci.yml`.
7. **Actual verification evidence:** Code inspection of `session.py` (35x full `pdf_bytes` undo + uncapped `redo_stack`) and `ci.yml`.
8. **Missing functionality:** Bounded/disk-backed undo history, `tsc --noEmit` + headless GUI test in CI, pinned AppImage runtime hash in `build_packages.sh`.
9. **Known defects:** Unbounded `redo_stack` memory growth; unpinned AppImage `continuous` runtime URL.
10. **Technical complexity:** Medium
11. **Dependencies:** `session.py`, `build_packages.sh`, `ci.yml`
12. **Recommended next action:** Fix undo/redo memory bounds (Phase 1), add `tsc` & GUI smoke tests to CI, and pin AppImage runtime (Phase 5).

