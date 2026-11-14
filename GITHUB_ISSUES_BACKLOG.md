# Vellum PDF Pro — Implementation-Ready GitHub Issues Backlog

**Audit Date:** 2026-11-13  
**Baseline:** `feat/paragraph-editor` (`8437f47`)  
**Note:** Local backlog only; no remote GitHub issues have been created.

---

## Issue 1: `security: add per-launch API auth token, strict CORS, and path-traversal guards`
- **Labels:** `security`, `P0`, `blocker:public-beta`, `blocker:v1.0`
- **Complexity:** Medium | **Dependencies:** None
- **Summary:** Backend listens on `127.0.0.1:18420` with `allow_origins=["*"]` + `allow_credentials=True` and zero auth, exposing `/open-path`, `/download`, `/save`, and `/recovery/{doc_id}/restore` to local/browser attacks and path traversal.
- **Acceptance Criteria:**
  - Generate random per-launch `VELLUM_API_TOKEN` in `electron/main.cjs`; pass to Python sidecar and `preload.cjs` -> `src/api.ts` (`X-Vellum-Token`).
  - Enforce token validation middleware in `backend/app.py` (excluding `/api/health`).
  - Restrict CORS to explicit Electron/Vite origins without wildcard + credentials.
  - Validate `doc_id` as strict UUID4 in `SessionManager.recover_session`.
  - Enforce max upload byte limit on multipart endpoints.
- **Required Tests:** Pytest asserting 401/403 without token, UUID traversal rejection, and oversized upload rejection.

## Issue 2: `fix(security): preserve encryption on save, verify password on decrypt, and remove default owner password`
- **Labels:** `bug`, `security`, `P0`, `blocker:public-beta`, `blocker:v1.0`
- **Complexity:** Medium | **Dependencies:** None
- **Summary:** Opening an encrypted PDF sets `encryption_config = None`, silently stripping password protection on save; `api_decrypt_pdf` ignores `req.password`; `encrypt_pdf` falls back to `"vellum-owner-default"` or `user_password == owner_password`; `HistoryEntry` omits `encryption_config`.
- **Acceptance Criteria:**
  - Retain encryption config on `open_document` so saving preserves protection unless explicitly decrypted.
  - Verify `req.password` in `api_decrypt_pdf`; return 401/403 on wrong password.
  - Remove `"vellum-owner-default"`; generate strong random owner secret if omitted with restricted permissions.
  - Snapshot `encryption_config` and `is_encrypted` in `HistoryEntry` for Undo/Redo.
- **Required Tests:** Pytest covering open-encrypted -> edit -> save remains encrypted; wrong-password decrypt fails; undo/redo of encrypt/decrypt restores state.

## Issue 3: `fix(backend): map missing sessions/inputs to 404/400, guard page reorder, and fix listbox form creation`
- **Labels:** `bug`, `P0`, `blocker:public-beta`, `blocker:v1.0`
- **Complexity:** Low | **Dependencies:** None
- **Summary:** Uncaught `KeyError` on 45+ endpoints returns HTTP 500; `parse_page_range_spec` & `rotate_pages` raise 500 on bad inputs; `reorder_pages` silently deletes omitted pages; `create_form_field("listbox")` crashes with `ValueError`.
- **Acceptance Criteria:**
  - Global FastAPI handlers map `KeyError` -> 404 and `ValueError` -> 400.
  - `reorder_pages` rejects incomplete permutations.
  - `rotate_pages` enforces multiples of 90°.
  - `create_form_field` and `update_form_field` support `PDF_WIDGET_TYPE_LISTBOX`.
- **Required Tests:** Pytest asserting 404/400 responses and end-to-end `listbox` create/fill/reopen.

## Issue 4: `fix(annotations): normalize display/PDF coordinates on rotated pages and purge deleted AP streams`
- **Labels:** `bug`, `P0`, `blocker:public-beta`, `blocker:v1.0`
- **Complexity:** Medium | **Dependencies:** None
- **Summary:** `annotations.py` omits `rect_to_display` / `rect_to_pdf`, misplacing annotations on 90°/180°/270° rotated pages, and `delete_annotation` uses `garbage=0` and silent no-op on missing xref.
- **Acceptance Criteria:**
  - Normalize annotation rects using `rect_to_display` / `rect_to_pdf`.
  - Raise `KeyError` (404) on missing xref in `delete_annotation` and save with `garbage >= 1`.
- **Required Tests:** Pytest creating, listing, updating, and deleting annotations on 90°/180°/270° rotated pages.

## Issue 5: `fix(security): fix regex redaction over-matching/ReDoS, strip active PDF actions in sanitize, and preserve alpha in optimizer`
- **Labels:** `bug`, `security`, `P0`, `blocker:public-beta`, `blocker:v1.0`
- **Complexity:** Medium | **Dependencies:** None
- **Summary:** Regex redaction uses `re.compile()` without ReDoS protection and re-searches via `page.search_for()`; `sanitize_pdf_metadata` leaves `/OpenAction`/`/AA` in pikepdf pass; `optimize_and_compress_pdf` turns RGBA transparent images black.
- **Acceptance Criteria:**
  - Map regex matches directly to word/span bboxes with regex safety limits.
  - Purge `/OpenAction`, `/AA`, `/Launch`, `/Names/JavaScript` in sanitize and expose attachment-removal option.
  - Preserve RGBA alpha/SMask in `optimize_and_compress_pdf`.
- **Required Tests:** Pytest for cross-line regex redaction, `/OpenAction` removal, and RGBA transparency preservation.

## Issue 6: `ci: add TypeScript check, headless Electron GUI smoke tests, and dependency CVE audits`
- **Labels:** `ci`, `P0`, `blocker:public-beta`, `blocker:v1.0`
- **Complexity:** Low | **Dependencies:** None
- **Summary:** `.github/workflows/ci.yml` omits `npx tsc --noEmit`, `pip-audit`, `npm audit`, and headless GUI smoke tests.
- **Acceptance Criteria:**
  - Add `npx tsc --noEmit`, `pip-audit`, `npm audit --audit-level=high`, and `xvfb-run` Electron GUI smoke test to `ci.yml`.
- **Required Tests:** Green CI workflow run.

## Issue 7: `perf(session): cap redo stack, spill large history snapshots to disk, debounce recovery, and prompt on dirty close`
- **Labels:** `performance`, `ux`, `P1`, `blocker:public-beta`, `blocker:v1.0`
- **Complexity:** High | **Dependencies:** Issue #2
- **Summary:** `SessionManager` keeps up to 35 full `pdf_bytes` + uncapped `redo_stack` in RAM, writes recovery snapshots synchronously on every edit, swallows recovery errors, lacks Discard button in UI, and closes dirty tabs without prompting.
- **Acceptance Criteria:**
  - Cap `redo_stack` to `max_history`; spill history above RAM threshold to temp files cleaned on close.
  - Debounce recovery writes, log errors, wire `discardRecovery` in Recovery modal.
  - Prompt Save/Discard/Cancel when closing dirty tab or app window.
- **Required Tests:** Pytest for redo cap, temp cleanup, recovery discard; GUI test for dirty-close modal.

## Issue 8: `fix(signatures,preflight): separate cryptographic integrity from CA trust and verify /StructTreeRoot`
- **Labels:** `bug`, `security`, `P1`, `blocker:public-beta`, `blocker:v1.0`
- **Complexity:** Medium | **Dependencies:** None
- **Summary:** `verify_pdf_signatures` sets `trust_roots=[signer_cert]`; preflight treats `/MarkInfo /Marked` without `/StructTreeRoot` as tagged; `convert_to_pdfa` silently returns pseudo-PDF/A when `gs` is missing.
- **Acceptance Criteria:**
  - Separate `intact` vs `trusted` in `verify_pdf_signatures`.
  - Check `/StructTreeRoot` in preflight.
  - Return explicit `compliant: false` warning when Ghostscript is absent.
- **Required Tests:** Pytest for self-signed `intact=True, trusted=False` and untagged `/Marked` preflight detection.

## Issue 9: `feat(ui): wire annotation editing, form field edit/delete inspector, and page thumbnail context menu`
- **Labels:** `enhancement`, `P1`, `blocker:v1.0`
- **Complexity:** Medium | **Dependencies:** Issue #3, Issue #4
- **Summary:** `updateAnnotation`, `updateFormField`, and `deleteFormField` exist in `src/api.ts` and backend, but have zero callers in `src/App.tsx`.
- **Acceptance Criteria:**
  - Comments sidebar edits annotations via `updateAnnotation`.
  - Forms Inspector edits/deletes fields via `updateFormField` / `deleteFormField`.
  - Page thumbnails support right-click context menu.
- **Required Tests:** API/GUI integration tests for annotation edit, form edit/delete, and thumbnail context menu.

## Issue 10: `feat(editor): add multi-object selection, alignment/distribution, and Z-order layering`
- **Labels:** `enhancement`, `P1`, `blocker:v1.0`
- **Complexity:** High | **Dependencies:** Phase 1
- **Summary:** Selection and `transform_object` only support a single object; no Align/Distribute or Bring to Front/Send to Back; shape deletion can erase intersecting native graphics.
- **Acceptance Criteria:**
  - Shift+Click / marquee multi-select, batch move/delete/duplicate, align/distribute, and Z-order layering without damaging native vector art.
- **Required Tests:** Pytest batch transform + GUI multi-select/align test.

## Issue 11: `feat(editor): implement Find & Replace across document using content-stream editing`
- **Labels:** `enhancement`, `P1`, `blocker:v1.0`
- **Complexity:** High | **Dependencies:** Issue #5
- **Summary:** Search is read-only; no Find & Replace exists.
- **Acceptance Criteria:**
  - `POST /api/docs/{doc_id}/replace` + Search/Replace UI supporting Next, Replace, Replace All, regex/case/whole-word, font warnings, and Undo.
- **Required Tests:** Pytest multi-page Find & Replace + Undo test.

## Issue 12: `feat(ocr): wire OCR language discovery, enable angle/deskew detection, and add OpenCV scan preprocessing`
- **Labels:** `enhancement`, `ocr`, `P1`, `blocker:v1.0`
- **Complexity:** Medium | **Dependencies:** Phase 1
- **Summary:** RapidOCR ignores `language`, `/api/ocr/languages` is unwired in UI, and no deskew/orientation or OpenCV preprocessing runs on low-quality scans.
- **Acceptance Criteria:**
  - Wire `/api/ocr/languages`, warn if selected language lacks model, enable angle classifier + OpenCV deskew/denoise/thresholding, and report multi-page progress.
- **Required Tests:** Pytest on rotated/skewed/noisy synthetic scans.

## Issue 13: `feat(forms): add form flattening, FDF/XFDF/JSON data import/export, validation/calculations, and XFA detection`
- **Labels:** `enhancement`, `forms`, `P1`, `blocker:v1.0`
- **Complexity:** High | **Dependencies:** Issue #3, Issue #9
- **Summary:** Missing form flatten, FDF/XFDF/JSON import/export, field validation/calculations, XFA warning, and signing existing `/FT /Sig` widgets.
- **Acceptance Criteria:**
  - Flatten widgets into static content; FDF/XFDF/JSON import/export; safe declarative validation/calculations; XFA warning banner; in-field signing.
- **Required Tests:** Pytest for flatten, FDF/XFDF roundtrip, calculated fields, XFA detection.

## Issue 14: `feat(pages): add Replace Pages, Page Backgrounds, interactive canvas crop, and paginated thumbnails`
- **Labels:** `enhancement`, `P2`, `blocker:v1.0`
- **Complexity:** Medium | **Dependencies:** Issue #3, Issue #7
- **Summary:** Missing `replace_pages`, page backgrounds, visual canvas crop, and thumbnail pagination for 200+ page PDFs.
- **Acceptance Criteria:**
  - Implement `replace_pages`, page backgrounds, visual crop marquee, and paginated `/thumbnails?offset=&limit=`.
- **Required Tests:** Pytest + 200-page thumbnail benchmark.

## Issue 15: `feat(ux): add fontconfig font discovery, HiDPI scaling, Recent Documents, and clipboard image/text paste`
- **Labels:** `enhancement`, `ux`, `P2`, `blocker:v1.0`
- **Complexity:** Medium | **Dependencies:** Phase 1
- **Summary:** `utils.py` hardcodes Debian font paths; HiDPI `devicePixelRatio` isn't applied; Recent Documents and OS clipboard image paste are missing.
- **Acceptance Criteria:**
  - `fc-match` font resolution, HiDPI scaling, persisted Recent Documents list, OS clipboard image paste.
- **Required Tests:** Pytest for `resolve_pdf_font`; GUI test for Recent Docs and paste.

## Issue 16: `feat(annotations): add multi-line QuadPoints markups, threaded replies (/IRT), review states, and XFDF import/export`
- **Labels:** `enhancement`, `P2`, `blocker:v1.0`
- **Complexity:** Medium | **Dependencies:** Issue #4, Issue #9
- **Summary:** Highlight/underline/strikeout use single bounding boxes instead of `QuadPoints`; threading, review states, and XFDF import/export are missing.
- **Acceptance Criteria:**
  - Compute per-line `QuadPoints` for text markups; support `/IRT` replies, review status, and XFDF import/export.
- **Required Tests:** Pytest for multi-line quads, `/IRT`, and XFDF roundtrip.

## Issue 17: `feat(signatures): add optional RFC 3161 TSA timestamps, multi-signature tests, and edit-invalidation warning`
- **Labels:** `enhancement`, `P2`, `blocker:v1.0`
- **Complexity:** Medium | **Dependencies:** Issue #8
- **Summary:** No RFC 3161 timestamping, no explicit multi-sig test, and no warning before editing a signed PDF.
- **Acceptance Criteria:**
  - Optional TSA URL in `sign_pdf_cryptographic`, warning banner when modifying signed PDFs, multi-sig pytest.
- **Required Tests:** Pytest multi-sig + mocked TSA test.

## Issue 18: `feat(convert): add PDF-to-PPTX, HTML/Office-to-PDF, and Batch Convert / Batch OCR UI`
- **Labels:** `enhancement`, `P2`
- **Complexity:** High | **Dependencies:** Issue #12
- **Summary:** `python-pptx` is missing; no HTML/XLSX/PPTX-to-PDF; `/api/convert/batch` has no UI or test.
- **Acceptance Criteria:**
  - Implement PDF->PPTX, HTML/Office->PDF, and Batch Convert/OCR UI queue.
- **Required Tests:** Pytest for PPTX, HTML->PDF, and `/api/convert/batch`.

## Issue 19: `build(linux): pin AppImage runtime SHA-256, add ghostscript Recommends, deduplicate OpenCV, and add rotating logs`
- **Labels:** `packaging`, `linux`, `P1`, `blocker:v1.0`
- **Complexity:** Medium | **Dependencies:** Issue #6, Issue #15
- **Summary:** Unpinned AppImage runtime URL, missing `ghostscript` in `.deb` Recommends, duplicate OpenCV packages, in-memory-only logs, hardcoded `--no-sandbox`.
- **Acceptance Criteria:**
  - Pin AppImage runtime SHA-256, add `ghostscript` Recommends, deduplicate OpenCV, add rotating disk logs, test `chrome-sandbox` in `.deb`.
- **Required Tests:** Reproducible package build + log verification.

## Issue 20: `test(linux): verify .deb install/purge and AppImage execution across Ubuntu, Debian, Fedora, Arch, and Wayland`
- **Labels:** `testing`, `linux`, `P1`, `blocker:v1.0`
- **Complexity:** Medium | **Dependencies:** Issue #15, Issue #19
- **Summary:** `.deb` only extracted rootlessly; Fedora, Arch, and native Wayland are untested.
- **Acceptance Criteria:**
  - Verified `apt install` / `dpkg -P` on Ubuntu 22.04/24.04 & Debian 12; AppImage verified on Fedora, Arch, X11, and Wayland.
- **Required Tests:** Container/VM smoke test matrix.

## Issue 21: `a11y,docs: add WAI-ARIA roles, modal focus trapping, axe-core checks, and user manual`
- **Labels:** `accessibility`, `docs`, `P2`, `blocker:v1.0`
- **Complexity:** Medium | **Dependencies:** Refactoring (`App.tsx` split)
- **Summary:** Only 7 ARIA/role attributes exist in 6,055-line `App.tsx`; no focus traps or `axe-core` audit.
- **Acceptance Criteria:**
  - Full ARIA roles/labels, modal focus traps, `axe-core` 0 critical violations, user manual.
- **Required Tests:** Automated `axe-core` CDP audit.

## Issue 22: `refactor: split App.tsx into feature components/hooks and backend/app.py into FastAPI routers`
- **Labels:** `refactor`, `P2`
- **Complexity:** Medium | **Dependencies:** None
- **Summary:** `src/App.tsx` (6,055 lines) and `backend/app.py` (1,879 lines) are monolithic.
- **Acceptance Criteria:**
  - Extract UI subcomponents/hooks and backend `APIRouter` modules with zero regression.
- **Required Tests:** Full pytest, `tsc --noEmit`, `npm run build`, and GUI scripts pass.

## Issue 23: `feat(accessibility): implement /StructTreeRoot tag tree inspector/editor, reading order, and PDF/UA checks`
- **Labels:** `enhancement`, `P2`, `milestone:pro-release`
- **Complexity:** Very High | **Dependencies:** Issue #8
- **Summary:** No `/StructTreeRoot` inspection/editing, reading order editor, or PDF/UA validation.
- **Acceptance Criteria:**
  - Tag tree CRUD, reading order editor, PDF/UA audit.
- **Required Tests:** Pytest tag-tree & PDF/UA tests.

## Issue 24: `feat(signatures): add PAdES-LTV /DSS embedding and PKCS#11 smartcard/YubiKey signing`
- **Labels:** `enhancement`, `P2`, `milestone:pro-release`
- **Complexity:** High | **Dependencies:** Issue #17
- **Summary:** Missing `/DSS` LTV and hardware token signing.
- **Acceptance Criteria:**
  - PAdES-LTV `/DSS` embedding and OpenSC PKCS#11 signing.
- **Required Tests:** SoftHSM2 / DSS pytest suite.

## Issue 25: `feat(pro): add printable TOC generation, PDF Portfolios (/Collection), and full-length doc comparison`
- **Labels:** `enhancement`, `P3`, `milestone:pro-release`
- **Complexity:** Medium | **Dependencies:** Phase 2
- **Summary:** Missing printable TOC page, `/Collection` portfolios, and trailing-page comparison when page counts differ.
- **Acceptance Criteria:**
  - TOC generator, `/Collection` portfolio support, and `max(len_a, len_b)` comparison.
- **Required Tests:** Pytest for TOC, portfolios, and unequal-page comparison.

## Issue 26: `feat(pro): add headless CLI batch mode, Action Wizard pipelines, and prepress print-production preflight`
- **Labels:** `enhancement`, `P3`, `milestone:pro-release`
- **Complexity:** Very High | **Dependencies:** Phase 3
- **Summary:** No headless CLI subcommands, Action Wizard pipelines, or CMYK/DPI/bleed print-production preflight.
- **Acceptance Criteria:**
  - Headless CLI flags, Action Wizard runner, prepress preflight checks.
- **Required Tests:** CLI subprocess & prepress fixture tests.

