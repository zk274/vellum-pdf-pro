# Vellum PDF Pro — Prioritized Development Roadmap

**Audit Date:** 2026-11-13  
**Baseline:** `feat/paragraph-editor` (`8437f47`)

Tasks are ordered by **dependency and user impact** across five phases. Every task includes priority, complexity, dependencies, acceptance criteria, required tests, a recommended GitHub issue title, and milestone blocker status.

---

## Phase 1 — Critical Stability (Security, Data Loss & Regressions)

### Task 1.1: Harden Local API Authentication, CORS, and Path Traversal Protections
- **Priority:** P0
- **Estimated Complexity:** Medium
- **Dependencies:** None
- **Blocks:** Public Beta, Stable v1.0
- **Recommended GitHub Issue Title:** `security: add per-launch API auth token, strict CORS, and path-traversal guards`
- **Acceptance Criteria:**
  1. `electron/main.cjs` generates a cryptographically random `VELLUM_API_TOKEN` per launch, passes it to the Python sidecar environment, and exposes it to the renderer via `preload.cjs` / `src/api.ts`.
  2. `backend/app.py` rejects requests missing/mismatched `X-Vellum-Token` with HTTP 401/403 (except `/api/health`).
  3. `CORSMiddleware` restricts `allow_origins` to explicit Electron/Vite localhost origins (no `"*"` with `allow_credentials=True`).
  4. `SessionManager.recover_session` validates `doc_id` as a strict UUID4 and rejects traversal payloads with HTTP 400/404.
  5. `/api/docs/open-path` and `/api/docs/{doc_id}/save` validate paths (reject null bytes, non-`.pdf` opens, symlink escapes where appropriate) and require valid auth token.
  6. Upload endpoints enforce configurable max upload size limits instead of unbounded `await file.read()`.
- **Required Tests:** Pytest security tests verifying 401/403 without token, CORS origin rejection, UUID path traversal rejection on `/api/recovery/{id}/restore`, and oversized upload rejection.

### Task 1.2: Fix PDF Encryption Lifecycle, Decrypt Password Verification, and Undo State
- **Priority:** P0
- **Estimated Complexity:** Medium
- **Dependencies:** None
- **Blocks:** Public Beta, Stable v1.0
- **Recommended GitHub Issue Title:** `fix(security): preserve encryption on save, verify password on decrypt, and remove default owner password`
- **Acceptance Criteria:**
  1. Opening an encrypted PDF preserves its encryption status/parameters in `DocumentSession.encryption_config` so re-saving does **not** silently strip password protection unless the user explicitly decrypts.
  2. `POST /api/docs/{doc_id}/security/decrypt` verifies `req.password` against the document's user/owner password and returns HTTP 401/403 on wrong password.
  3. `security_optimize.py:encrypt_pdf` removes `"vellum-owner-default"`; if `owner_password` is omitted when `user_password` is set, generates a strong random owner password (or requires explicit owner password when permissions are restricted) so permission flags cannot be trivially bypassed.
  4. `HistoryEntry` snapshots `encryption_config` and `is_encrypted` so Undo/Redo restores encryption state accurately.
- **Required Tests:** Pytest verifying open-encrypted -> edit -> save remains encrypted; decrypt with wrong password fails (401/403); decrypt with right password succeeds; undo/redo of encrypt/decrypt restores state.

### Task 1.3: Global HTTP Error Mapping, Page-Ops Data-Loss Guards, and Listbox Fix
- **Priority:** P0
- **Estimated Complexity:** Low
- **Dependencies:** None
- **Blocks:** Public Beta, Stable v1.0
- **Recommended GitHub Issue Title:** `fix(backend): map missing sessions/inputs to 404/400, guard page reorder, and fix listbox form creation`
- **Acceptance Criteria:**
  1. Global FastAPI exception handlers return HTTP 404 for missing `doc_id` (`KeyError`) and HTTP 400/422 for `ValueError` (e.g., malformed `parse_page_range_spec` strings, invalid rotation angles not divisible by 90).
  2. `page_ops.reorder_pages` validates that `new_order` is a complete permutation of `0..len(doc)-1` (no silent page deletion).
  3. `forms_signatures.create_form_field` and `update_form_field` support `listbox` (`PDF_WIDGET_TYPE_LISTBOX`) without crashing.
- **Required Tests:** Pytest asserting HTTP 404 on missing `doc_id`, HTTP 400 on partial `reorder_pages` / malformed range / invalid rotation, and HTTP 200 for `listbox` creation + fill + reopen.

### Task 1.4: Fix Rotated-Page Annotation Coordinates & Deletion Garbage Cleanup
- **Priority:** P0
- **Estimated Complexity:** Medium
- **Dependencies:** None
- **Blocks:** Public Beta, Stable v1.0
- **Recommended GitHub Issue Title:** `fix(annotations): normalize display/PDF coordinates on rotated pages and purge deleted AP streams`
- **Acceptance Criteria:**
  1. `annotations.list_annotations` converts `annot.rect` via `rect_to_display(page, ...)`.
  2. `annotations.add_annotation` and `update_annotation` convert `bbox` via `rect_to_pdf(page, ...)`.
  3. `annotations.delete_annotation` raises `KeyError` (404) if `xref` is missing and saves with `garbage >= 1` to clean orphaned appearance streams.
- **Required Tests:** Pytest creating, listing, updating, and deleting annotations on 90°, 180°, and 270° rotated pages with coordinate assertions.

### Task 1.5: Fix Redaction Regex Matching, ReDoS Guard, Sanitize Active-Content Purge & Optimizer Alpha Preservation
- **Priority:** P0
- **Estimated Complexity:** Medium
- **Dependencies:** None
- **Blocks:** Public Beta, Stable v1.0
- **Recommended GitHub Issue Title:** `fix(security): fix regex redaction over-matching/ReDoS, strip active PDF actions in sanitize, and preserve alpha in optimizer`
- **Acceptance Criteria:**
  1. `apply_permanent_redaction` maps regex match character offsets directly to word/span bounding boxes (supporting cross-line matches without over-redacting unrelated identical substrings) and enforces regex length/execution safeguards.
  2. `sanitize_pdf_metadata` strips `/OpenAction`, `/AA`, `/Launch`, and `/Names/JavaScript` in its `pikepdf` pass and exposes an `include_attachments` option.
  3. `optimize_and_compress_pdf` preserves RGBA/SMask transparency (compressing with Flate/PNG or preserved SMask instead of black-fill JPEG conversion).
- **Required Tests:** Pytest verifying cross-line regex redaction, non-redaction of non-matching contexts, `/OpenAction` removal in sanitize, and RGBA transparency preservation after optimize.

### Task 1.6: Bound Undo/Redo Memory, Debounce Recovery Snapshots, and Add Unsaved-Changes Prompt
- **Priority:** P1
- **Estimated Complexity:** High
- **Dependencies:** Task 1.2
- **Blocks:** Public Beta, Stable v1.0
- **Recommended GitHub Issue Title:** `perf(session): cap redo stack, spill large history snapshots to disk, debounce recovery, and prompt on dirty close`
- **Acceptance Criteria:**
  1. `redo_stack` is capped at `max_history`.
  2. History entries spill `pdf_bytes` to temp storage above a configurable RAM threshold (e.g., 64 MB per session) and clean up on session close.
  3. Recovery snapshots are debounced/written asynchronously with surfaced error logging (no silent `except Exception: pass`) and Discard button wired in Recovery modal.
  4. Closing a dirty tab or window prompts a non-blocking Save / Discard / Cancel modal.
- **Required Tests:** Pytest for redo cap, temp snapshot cleanup on close, recovery discard endpoint + UI, and GUI test for dirty-tab close prompt.

### Task 1.7: Fix Signature Verification Trust Semantics & Preflight `/StructTreeRoot` Check
- **Priority:** P1
- **Estimated Complexity:** Medium
- **Dependencies:** None
- **Blocks:** Public Beta, Stable v1.0
- **Recommended GitHub Issue Title:** `fix(signatures,preflight): separate cryptographic integrity from CA trust and verify /StructTreeRoot`
- **Acceptance Criteria:**
  1. `verify_pdf_signatures` validates against system/user CA trust roots rather than `trust_roots=[signer_cert]`, returning distinct `intact` (digest/ByteRange valid) and `trusted` (CA-verified) booleans, clearly explaining self-signed status in UI.
  2. `run_preflight_and_accessibility_check` checks actual `/StructTreeRoot` existence (not merely `/MarkInfo /Marked`).
  3. `convert_to_pdfa` returns explicit `compliant: false` warning when Ghostscript (`gs`) is missing instead of claiming full PDF/A-2b conversion.
- **Required Tests:** Pytest verifying self-signed cert returns `intact=True, trusted=False` and preflight flags `/Marked` without `/StructTreeRoot` as untagged.

---

## Phase 2 — Core Editing Completion

### Task 2.1: Multi-Object Selection, Batch Transform, Alignment, Distribution & Z-Order Layering
- **Priority:** P1
- **Estimated Complexity:** High
- **Dependencies:** Phase 1
- **Blocks:** Stable v1.0
- **Recommended GitHub Issue Title:** `feat(editor): add multi-object selection, alignment/distribution, and Z-order layering`
- **Acceptance Criteria:**
  1. Users can Shift+Click or drag-marquee to select multiple Vellum objects (text boxes, shapes, images) and move, delete, duplicate, align (left/center/right/top/middle/bottom), and distribute them together.
  2. Bring to Front / Send to Back / Bring Forward / Send Backward reorder `/VellumData` and PDF XObject/stream layers cleanly without damaging underlying native graphics on shape deletion.
- **Required Tests:** Pytest batch transform + Z-order tests; GUI test verifying marquee select, align, and layer reorder.

### Task 2.2: Document-Wide Find & Replace
- **Priority:** P1
- **Estimated Complexity:** High
- **Dependencies:** Task 1.5
- **Blocks:** Stable v1.0
- **Recommended GitHub Issue Title:** `feat(editor): implement Find & Replace across document using content-stream editing`
- **Acceptance Criteria:**
  1. `POST /api/docs/{doc_id}/replace` supports case-sensitive, whole-word, and regex Find & Replace (next match or Replace All) via `edit_text_span` / `edit_paragraph_block` with font fallback reporting and atomic undo.
  2. Frontend Search bar expands to Find & Replace panel with match counter and step-through navigation.
- **Required Tests:** Pytest verifying single and bulk replacement across multi-page PDFs, font preservation, and undo restoration.

### Task 2.3: Wire Existing Annotation Update & Form Field Edit/Delete Workflows + Page Thumbnails Context Menu
- **Priority:** P1
- **Estimated Complexity:** Medium
- **Dependencies:** Task 1.3, Task 1.4
- **Blocks:** Public Beta (partial), Stable v1.0
- **Recommended GitHub Issue Title:** `feat(ui): wire annotation editing, form field edit/delete inspector, and page thumbnail context menu`
- **Acceptance Criteria:**
  1. Comments sidebar allows editing existing annotation content/author/color/opacity via `PUT /api/docs/{doc_id}/annotations/{xref}`.
  2. Forms Inspector allows selecting, renaming, editing options/flags, moving, and deleting existing form fields via `PUT`/`DELETE /api/docs/{doc_id}/forms/{xref}`.
  3. Right-clicking page thumbnails opens a context menu (Insert Blank, Duplicate, Rotate, Extract, Replace, Delete).
- **Required Tests:** GUI/API integration tests for annotation update, form field update/delete, and thumbnail context menu.

### Task 2.4: Missing Page Operations (Replace Pages, Page Backgrounds, Visual Crop) & Large-Doc Pagination
- **Priority:** P2
- **Estimated Complexity:** Medium
- **Dependencies:** Task 1.3, Task 1.6
- **Blocks:** Stable v1.0
- **Recommended GitHub Issue Title:** `feat(pages): add Replace Pages, Page Backgrounds, interactive canvas crop, and paginated thumbnails`
- **Acceptance Criteria:**
  1. `replace_pages` replaces target page(s) from another PDF while optionally preserving annotations/links.
  2. Page background tool adds/removes solid color or image backgrounds behind page content.
  3. Interactive canvas crop marquee lets users drag crop margins visually.
  4. `GET /api/docs/{doc_id}/thumbnails` supports `offset` & `limit` pagination; sidebar virtualizes/lazy-loads thumbnails for 200+ page PDFs.
- **Required Tests:** Pytest for `replace_pages`, backgrounds, and paginated thumbnails; benchmark on 200-page PDF.

### Task 2.5: Cross-Distro Font Discovery (`fontconfig`), HiDPI Rendering, Recent Docs & OS Clipboard Paste
- **Priority:** P2
- **Estimated Complexity:** Medium
- **Dependencies:** Phase 1
- **Blocks:** Stable v1.0
- **Recommended GitHub Issue Title:** `feat(ux): add fontconfig font discovery, HiDPI scaling, Recent Documents, and clipboard image/text paste`
- **Acceptance Criteria:**
  1. `utils.py:resolve_pdf_font` queries `fc-match` / `fontconfig` (with bundled fallback) instead of hardcoded `/usr/share/fonts/truetype/...` Debian paths.
  2. Canvas rendering scales DPI by `Math.min(window.devicePixelRatio || 1, 2)` for crisp 4K/HiDPI displays.
  3. File menu and empty state track up to 10 Recent Documents across restarts.
  4. `Ctrl+V` supports pasting images from the OS clipboard onto the active PDF page.
- **Required Tests:** Pytest for `resolve_pdf_font` fallback chain; GUI test for Recent Documents and clipboard paste.

### Task 2.6: Incremental Modularization of `src/App.tsx` & `backend/app.py`
- **Priority:** P2
- **Estimated Complexity:** Medium
- **Dependencies:** Task 2.1–2.5 (performed alongside feature additions)
- **Blocks:** None (maintainability enabler)
- **Recommended GitHub Issue Title:** `refactor: split App.tsx into feature components/hooks and backend/app.py into FastAPI routers`
- **Acceptance Criteria:**
  1. Extract `TopMenuBar`, `LeftSidebar`, `CanvasStage`, `RightInspector`, and `Modals` from `src/App.tsx` (reducing `App.tsx` below 1,500 lines) with zero regression in `tsc` or GUI tests.
  2. Split `backend/app.py` routes into domain `APIRouter` modules under `backend/routes/`.
- **Required Tests:** All existing 27+ pytest tests, `npx tsc --noEmit`, `npm run build`, and all CDP GUI verification scripts pass.

---

## Phase 3 — Professional Document Workflows

### Task 3.1: Fix OCR Language Support, Add Orientation Detection, Deskew & Scan Preprocessing
- **Priority:** P1
- **Estimated Complexity:** Medium
- **Dependencies:** Phase 1
- **Blocks:** Stable v1.0
- **Recommended GitHub Issue Title:** `feat(ocr): wire OCR language discovery, enable angle/deskew detection, and add OpenCV scan preprocessing`
- **Acceptance Criteria:**
  1. `GET /api/ocr/languages` is wired to the UI and reports installed Tesseract/RapidOCR language availability accurately (warning if a requested language pack is missing instead of silently running English).
  2. RapidOCR angle classifier + OpenCV deskew, adaptive thresholding, and denoising run on skewed/noisy scans.
  3. Multi-page OCR reports async job progress (% complete) without blocking the event loop.
- **Required Tests:** Pytest with skewed/rotated/noisy synthetic scans verifying orientation correction and recognized text.

### Task 3.2: Complete Form Workflows (Flatten, FDF/XFDF/JSON Export-Import, Validation, Calculations, XFA Warning, Sign-in-Field)
- **Priority:** P1
- **Estimated Complexity:** High
- **Dependencies:** Task 1.3, Task 2.3
- **Blocks:** Stable v1.0
- **Recommended GitHub Issue Title:** `feat(forms): add form flattening, FDF/XFDF/JSON data import/export, validation/calculations, and XFA detection`
- **Acceptance Criteria:**
  1. Flatten AcroForms bakes `/AP` appearances into static page graphics and removes widgets.
  2. Export/Import form data in JSON, CSV, FDF, and XFDF.
  3. Declarative field validation (required, regex, numeric range) and safe arithmetic calculated fields (`/C` without arbitrary `eval`).
  4. Opening an XFA PDF displays a clear non-blocking XFA limitation banner; clicking an existing empty `/FT /Sig` widget signs directly into that field.
- **Required Tests:** Pytest covering flatten, FDF/XFDF roundtrip, calculated sums, XFA detection, and in-field signing.

### Task 3.3: Annotation `QuadPoints`, Comment Threading (`/IRT`), Review States & XFDF Import/Export
- **Priority:** P2
- **Estimated Complexity:** Medium
- **Dependencies:** Task 1.4, Task 2.3
- **Blocks:** Stable v1.0 (QuadPoints/XFDF), Post-v1.0 (Threading)
- **Recommended GitHub Issue Title:** `feat(annotations): add multi-line QuadPoints markups, threaded replies (/IRT), review states, and XFDF import/export`
- **Acceptance Criteria:**
  1. Highlight/underline/strikeout markups compute per-line `QuadPoints` over selected text spans.
  2. Sticky notes and comments support threaded replies (`/IRT`), review statuses (Accepted, Rejected, Cancelled, Completed), and XFDF export/import.
- **Required Tests:** Pytest verifying multi-line quad highlights, `/IRT` reply links, and XFDF export -> import roundtrip.

### Task 3.4: Complete Digital Signatures (RFC 3161 Timestamps, Multi-Sig Tests, Signed-Edit Warning)
- **Priority:** P2
- **Estimated Complexity:** Medium
- **Dependencies:** Task 1.7
- **Blocks:** Stable v1.0
- **Recommended GitHub Issue Title:** `feat(signatures): add optional RFC 3161 TSA timestamps, multi-signature tests, and edit-invalidation warning`
- **Acceptance Criteria:**
  1. `sign_pdf_cryptographic` supports optional RFC 3161 TSA server URL via `pyHanko` `HTTPTimeStamper`.
  2. Editing or non-incrementally saving an already-signed PDF warns the user that existing cryptographic signatures will be invalidated.
- **Required Tests:** Pytest verifying sequential multi-signature preservation (2+ signers) and mocked/local TSA timestamping.

### Task 3.5: Expand Document Conversions (PDF-to-PPTX, HTML/XLSX/PPTX-to-PDF, Batch Convert & Batch OCR UI)
- **Priority:** P2
- **Estimated Complexity:** High
- **Dependencies:** Task 3.1
- **Blocks:** None (PPTX/Batch are value-add; PDF/A warning already in Phase 1)
- **Recommended GitHub Issue Title:** `feat(convert): add PDF-to-PPTX, HTML/Office-to-PDF, and Batch Convert / Batch OCR UI`
- **Acceptance Criteria:**
  1. Add `python-pptx` to `requirements.txt` and implement `convert_pdf_to_pptx` (editable text + images per slide).
  2. Support `.xlsx`/`.pptx`/`.html` to PDF via LibreOffice or Electron `printToPDF`.
  3. Wire `POST /api/convert/batch` and multi-file Batch OCR into a unified Batch Processing UI queue.
- **Required Tests:** Pytest for PDF->PPTX, HTML->PDF, and `/api/convert/batch`.

---

## Phase 4 — Advanced Acrobat-Class Functionality

### Task 4.1: True Tagged PDF (`/StructTreeRoot`), Reading Order Editor & PDF/UA Validation
- **Priority:** P2
- **Estimated Complexity:** Very High
- **Dependencies:** Task 1.7, Phase 2
- **Blocks:** Advanced Professional Release
- **Recommended GitHub Issue Title:** `feat(accessibility): implement /StructTreeRoot tag tree inspector/editor, reading order, and PDF/UA checks`
- **Acceptance Criteria:**
  1. Inspect and edit `/StructTreeRoot` semantic tags (`Document`, `H1`–`H6`, `P`, `Table`, `Figure` alt text) and visual reading order.
  2. Auto-tag untagged PDFs and validate against core ISO 14289-1 (PDF/UA) rules.
- **Required Tests:** Pytest verifying tag tree creation/editing and PDF/UA audit accuracy.

### Task 4.2: Signature LTV / DSS Embedding & PKCS#11 Hardware Token Signing
- **Priority:** P2
- **Estimated Complexity:** High
- **Dependencies:** Task 3.4
- **Blocks:** Advanced Professional Release
- **Recommended GitHub Issue Title:** `feat(signatures): add PAdES-LTV /DSS embedding and PKCS#11 smartcard/YubiKey signing`
- **Acceptance Criteria:**
  1. Embed `/DSS` (OCSP/CRL/certs) for Long-Term Validation.
  2. Support OpenSC / PKCS#11 hardware token signing via `pyHanko`.
- **Required Tests:** Pytest with SoftHSM2 / mock PKCS#11 token and DSS dictionary assertions.

### Task 4.3: Printable Table of Contents, PDF Portfolios (`/Collection`), and Comparison Unequal-Page Fix
- **Priority:** P3
- **Estimated Complexity:** Medium
- **Dependencies:** Phase 2
- **Blocks:** Advanced Professional Release
- **Recommended GitHub Issue Title:** `feat(pro): add printable TOC generation, PDF Portfolios (/Collection), and full-length doc comparison`
- **Acceptance Criteria:**
  1. Generate clickable TOC pages from outline bookmarks.
  2. Create/browse `/Root /Collection` PDF Portfolios.
  3. `compare_pdf_documents` compares up to `max(len_a, len_b)` and reports added/removed trailing pages.
- **Required Tests:** Pytest covering TOC links, `/Collection` portfolio metadata, and unequal-length document comparison.

### Task 4.4: Headless CLI Subcommands, Action Wizard & Print Production / Prepress Preflight
- **Priority:** P3
- **Estimated Complexity:** Very High
- **Dependencies:** Phase 3
- **Blocks:** Advanced Professional Release
- **Recommended GitHub Issue Title:** `feat(pro): add headless CLI batch mode, Action Wizard pipelines, and prepress print-production preflight`
- **Acceptance Criteria:**
  1. CLI flags (`--ocr`, `--merge`, `--compress`, `--redact`) execute headlessly without launching Electron GUI.
  2. Action Wizard chains multiple operations across folders of PDFs.
  3. Print production preflight audits CMYK/RGB color spaces, image DPI, bleed/trim boxes, and spot colors.
- **Required Tests:** CLI subprocess tests and prepress preflight fixture tests.

---

## Phase 5 — Public Release Readiness

### Task 5.1: Hardening CI Pipeline (`tsc`, GUI Smoke Tests, `pip-audit` / `npm audit`)
- **Priority:** P0
- **Estimated Complexity:** Low
- **Dependencies:** Phase 1
- **Blocks:** Public Beta, Stable v1.0
- **Recommended GitHub Issue Title:** `ci: add TypeScript check, headless Electron GUI smoke tests, and dependency CVE audits`
- **Acceptance Criteria:**
  1. `.github/workflows/ci.yml` runs `npx tsc --noEmit`, `pip-audit`, `npm audit --audit-level=high`, and headless `xvfb-run` Electron smoke tests on every PR/push.
  2. CI caches/builds fail on any TS or high/critical CVE regression.
- **Required Tests:** Passing GitHub Actions workflow run on `ubuntu-24.04`.

### Task 5.2: Packaging Optimization, Reproducibility, Persistent Logs & Sandbox Review
- **Priority:** P1
- **Estimated Complexity:** Medium
- **Dependencies:** Task 2.5, Task 5.1
- **Blocks:** Stable v1.0
- **Recommended GitHub Issue Title:** `build(linux): pin AppImage runtime SHA-256, add ghostscript Recommends, deduplicate OpenCV, and add rotating logs`
- **Acceptance Criteria:**
  1. `scripts/build_packages.sh` pins exact AppImage runtime version + SHA-256 checksum (no unpinned `continuous` fetch), declares `ghostscript` in `.deb` `Recommends`, and deduplicates `opencv-python` vs `opencv-python-headless` in `requirements.txt`.
  2. Electron + Python write rotating logs to `~/.local/share/vellum-pdf/logs/` with an "Export Diagnostics Bundle" button.
  3. `.deb` package tests `chrome-sandbox` permissions (eliminating `--no-sandbox` where supported).
- **Required Tests:** Reproducible build checksum check and clean startup log verification.

### Task 5.3: Multi-Distro, Wayland & Clean `dpkg -i` Installation Verification Matrix
- **Priority:** P1
- **Estimated Complexity:** Medium
- **Dependencies:** Task 2.5, Task 5.2
- **Blocks:** Stable v1.0
- **Recommended GitHub Issue Title:** `test(linux): verify .deb install/purge and AppImage execution across Ubuntu, Debian, Fedora, Arch, and Wayland`
- **Acceptance Criteria:**
  1. Clean `apt install ./vellum-pdf-pro_*.deb` and `dpkg -P vellum-pdf-pro` verified in Ubuntu 22.04, Ubuntu 24.04, and Debian 12 containers/VMs.
  2. AppImage launch, PDF open, edit, OCR, and save verified on Fedora, Arch Linux, X11, and native Wayland (`--ozone-platform-hint=auto`).
- **Required Tests:** Automated container/VM smoke test scripts and documented compatibility matrix.

### Task 5.4: WAI-ARIA Accessibility, Screen-Reader Audit & User Documentation
- **Priority:** P2
- **Estimated Complexity:** Medium
- **Dependencies:** Task 2.6
- **Blocks:** Stable v1.0
- **Recommended GitHub Issue Title:** `a11y,docs: add WAI-ARIA roles, modal focus trapping, axe-core checks, and user manual`
- **Acceptance Criteria:**
  1. Top menus, tabs, sidebars, toolbars, and modals have proper ARIA roles, labels, keyboard navigation, and focus traps; zero critical `axe-core` violations.
  2. Complete user guide, keyboard shortcut reference, and known limitations (subset fonts, XFA) documented.
- **Required Tests:** Automated `axe-core` Playwright/CDP accessibility check passing with 0 critical issues.

