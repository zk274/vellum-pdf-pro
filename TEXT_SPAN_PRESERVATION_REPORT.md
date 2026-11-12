# Vellum PDF Pro — Native Text Span Manipulation & Hyperlink Preservation Report

**Date:** November 11, 2026  
**Application:** Vellum PDF Pro  
**Module:** Interactive Object Manipulation, Direct PDF Text Stream Engine & Hyperlink Synchronizer  

---

## 1. Executive Summary

A critical regression was reported where selecting native PDF text spans (such as hyperlinks) and moving or resizing their bounding boxes caused the text to disappear from the page, even though its original text string remained visible in the Direct PDF Text Stream Editor sidebar.

A thorough investigation of the end-to-end pipeline—from React selection and drag gestures down through the FastAPI endpoint and PyMuPDF content stream transformation—revealed the root causes. A comprehensive, multi-layer permanent fix has been implemented and verified across both backend and frontend.

### Verified Outcomes:
1. **Zero Disappearing Text:** Text remains permanently visible, crisp, and properly rendered after move and resize operations.
2. **Proper Resizing Semantics:** Resizing a text span's selection frame updates the bounding geometry without unexpectedly altering the font size or distorting glyphs.
3. **Hyperlink Synchronization:** Moving or resizing a hyperlinked text span automatically shifts and preserves associated `/Link` URI and destination annotations.
4. **Atomic Transformation Guarantees:** Transformations are validated before completion; if a text token cannot be verified in the output document, the operation aborts cleanly and restores the original content without leaving partially erased glyphs.
5. **Universal Compatibility:** Verified with native Helvetica, bold/italic text, multiline text, embedded TrueType fonts, subsetted fonts, rotated pages (0°, 90°, 180°, 270°), text over colored backgrounds, and full Undo/Redo cycles.

---

## 2. Root Cause Analysis

Tracing the transformation pipeline for `text_span` objects:

1. **Frontend Parameter Loss during Drag & Resize:**  
   In `src/App.tsx`, the drag and resize mouseup handlers invoked `commitObjectTransform(selectedObj, current)` without passing `extraProps`. While `obj.data` contained the initial span properties, `commitObjectTransform` did not explicitly extract `text`, `font`, `size`, `color`, or `orig_origin`. As a result, the JSON payload dispatched to `/api/docs/{doc_id}/pages/{page_index}/transform-object` had `text: undefined`, `font_name: undefined`, `font_size: undefined`, etc.

2. **Backend Unchecked Redaction without Insertion:**  
   In `backend/engine/direct_edit.py`, `transform_object()` received `text=None` for `object_type="text_span"`. It called `edit_text_span(..., new_text=text if text is not None else "")`. With `new_text=""`:
   - `_remove_glyphs(page, pdf_rect)` ran and redacted the original glyphs from the PDF content stream.
   - Because `new_text` was empty string, no replacement text was written back into the content stream.
   - The PDF rendered canvas became blank at that position.

3. **Decoupled Frontend Component State:**  
   In React, `selectedSpan` held the original span dictionary in local state, so the sidebar "Direct PDF Text Stream Editor" continued to display the original text string while the actual PDF document on the canvas was blank.

4. **Hyperlink Annotation Invalidation by Redactions:**  
   In PyMuPDF, `page.apply_redactions()` by default removes any annotation or link intersecting the redaction rectangle. When `edit_text_span` removed the glyphs, the intersecting `/Link` annotation was purged from the page links array and never restored.

---

## 3. Permanent Codebase Solutions

### Backend (`backend/engine/direct_edit.py` & `backend/app.py`)

1. **Server-Side Fallback & Span Introspection:**  
   If `transform_object()` receives `None` or empty text for a `text_span` (and the action is not `"delete"`), it inspects the page using `inspect_page_objects(pdf_bytes, page_index)` to locate the span by ID or bounding box coordinates, automatically recovering the real text content, font family, font size, color hex, bold/italic flags, and origin coordinates.

2. **Atomic Verification Guard:**  
   Before returning transformed PDF bytes, `transform_object()` re-opens the document in-memory and verifies that the text string actually exists on the target page. If text was lost or corrupted during the transform, the operation aborts atomically and returns the untouched original bytes.

3. **Hyperlink Annotation Synchronization:**  
   In `edit_text_span()`, before `_remove_glyphs()` applies redactions, all link annotations on the page intersecting the target rectangle are saved. After the text is re-inserted at its new position (offset by `delta`), the link annotations are re-inserted with matching offset coordinates, preserving all URI links and destination pages.

4. **Correct Bounding Box vs Font Size Behavior:**  
   `edit_text_span()` preserves the original font size, baseline origin, and font family when the bounding box is resized.

### Frontend (`src/App.tsx` & `src/types.ts`)

1. **Complete Payload Serialization in `commitObjectTransform`:**  
   Explicitly extracts and serializes:
   - `textVal`: `extraProps.text ?? (obj.data?.text ?? editSpanText)`
   - `fontVal`: `extraProps.font_name ?? (obj.data?.font ?? editSpanFont)`
   - `sizeVal`: `extraProps.font_size ?? (obj.data?.size ?? editSpanSize)`
   - `colorVal`: `extraProps.color_hex ?? (obj.data?.color || obj.data?.color_hex || editSpanColor)`
   - `boldVal`: `extraProps.bold ?? (obj.data?.bold ?? editSpanBold)`
   - `italicVal`: `extraProps.italic ?? (obj.data?.italic ?? editSpanItalic)`
   - `alignVal`: `extraProps.align ?? (obj.data?.align ?? editSpanAlign ?? 'left')`
   - `origOrigin`: `obj.data?.origin`

2. **Post-Transformation Object Synchronization:**  
   When the backend returns updated page objects, `commitObjectTransform` locates the newly transformed span in `res.objects.text_spans` and synchronizes `selectedObj`, `selectedSpan`, and `editSpanBbox` to the actual resulting geometry.

---

## 4. Test Verification Results

### Automated Regression Test Suite (Pytest)
Command: `.venv/bin/pytest -v tests/`  
**Result:** **22 passed, 0 failed in 25.37s**

Key test cases verified:
- `test_text_span_manipulation_preservation_and_hyperlinks`:
  - **Resize Bounding Box:** Resized `https://specifications.vellumpdf.linux/msa` from 190×14 pt to 239×42 pt. Verified text remained 100% visible and font size remained 10.5 pt.
  - **Move Hyperlinked Span:** Moved span by (+50 pt, +60 pt). Verified text moved and `/Link` annotation shifted from `[48, 345, 290, 368]` to `[98, 405, 340, 428]`.
  - **Bold and Italic Spans:** Moved bold heading across colored rectangle background; verified vector artwork remained pristine with no whiteout boxes.
  - **Rotated Pages:** Verified move and resize across 90°, 180°, and 270° rotated PDF pages.
  - **Atomic Failure Guard:** Tested omitted text payload; verified document was never corrupted or wiped.
  - **Undo / Redo:** Full lifecycle verification.
  - **Export and Reopen Persistence:** Exported PDF to disk and re-opened via API; verified all text spans and hyperlinks were intact.
- `test_direct_edit_embedded_and_subsetted_fonts_deep_verification`:
  - Verified embedded TrueType fonts, subsetted fonts, and tight vertical line spacing (10.5 pt leading on 12 pt text).

### Packaged Electron Desktop GUI Testing (CDP Automation)
Command: `node scripts/verify_text_span_manipulation_gui.cjs`  
**Result:** **Passed cleanly**

Screenshots captured on Linux desktop (`docs/screenshots/`):
1. `text-span-selected.png`: Single-click selection showing high-contrast frame, 8 resize handles, and dimension badge (`190 × 14 pt (X: 48, Y: 349)`).
2. `text-span-after-resize.png`: Resized bounding box via SE handle; text remains fully visible, sharp, and correctly positioned.
3. `text-span-after-move.png`: Dragged text span by (+52 pt, +35 pt); dimension badge updated to `(X: 100, Y: 384)` with text and link intact.
4. `text-span-after-undo.png`: Reverted cleanly to original position via desktop Undo control.

---

## 5. Linux Packaging Build

Command: `bash scripts/build_packages.sh`  
**Status:** **Build Complete (Zero Errors)**

- **Debian Package:** `release/vellum-pdf-pro_1.0.0_amd64.deb` (450 MB)  
  SHA-256: `e30d0c473c3c377f885de5e509efb0142dc7e4aef6cc3e22f42b78112496a3df`
- **AppImage Package:** `release/Vellum_PDF_Pro-1.0.0-x86_64.AppImage` (389 MB)  
  SHA-256: `a36fc1854a96def27eda37e002839ded0eb83271c5db303d1f9a25c501351ee3`
- **Checksums File:** `release/SHA256SUMS` verified.
