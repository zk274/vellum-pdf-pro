# Vellum PDF Pro — Feature Gap Analysis & Architectural Assessment

**Audit Date:** 2026-11-13  
**Branch:** `feat/paragraph-editor` (`8437f47`)

---

## 1. Executive Gap Summary

While prior project reports (`docs/FEATURE_MATRIX.md`, `RELEASE_READINESS.md`) presented Vellum PDF Pro as feature-complete, direct code inspection and runtime probing reveal a clear divide:
- **Strong Core Direct Editing & Basic Workflows:** Single-span text editing, paragraph reflow, mixed-format run editing, text boxes, basic shapes, image insertion/editing, basic AcroForms (4 types), PKCS#12 signing, permanent coordinate/search redaction, basic page ops, and DOCX/XLSX/HTML/TXT/image exports work well.
- **Critical Stability, Security & Lifecycle Defects:** Local API lacks authentication and uses insecure CORS (`*` + `allow_credentials=True`), arbitrary local file read/write exists on `/open-path` and `/save`, encryption is silently stripped when opening and re-saving a password-protected PDF, `api_decrypt_pdf` ignores the password, `listbox` form creation crashes with HTTP 500, missing `doc_id` causes unhandled `KeyError` HTTP 500 on 45+ routes, and `annotations.py` ignores page rotation.
- **Substantial Professional & Acrobat-Class Gaps:** Multi-object selection/alignment/Z-order, search & replace, form flattening/FDF/XFDF/calculations/validation, CA chain & TSA/LTV signature verification, OCR language selection (in RapidOCR)/deskew/preprocessing, PDF-to-PPTX, HTML/XLSX/PPTX-to-PDF, true Tagged PDF (`/StructTreeRoot`) & PDF/UA, print production, and cross-distro/Wayland/dpkg-install verification are missing or incomplete.

---

## 2. Consolidated Gap Inventory by Status

### 2.1 Broken / Security-Critical Features (Immediate Attention)
| Feature | Location | Defect / Failure Mode |
|---|---|---|
| **Local API Security & CORS** | `backend/app.py:102–108, 597–654` | `allow_origins=["*"]` with `allow_credentials=True`, zero auth token, arbitrary file read (`/open-path`) and overwrite (`/save`). |
| **Encryption Lifecycle & Decrypt** | `backend/app.py:1546–1593`, `session.py:183, 244`, `security_optimize.py:32` | Opening an encrypted PDF clears `encryption_config` (saving strips encryption silently); `api_decrypt_pdf` ignores `req.password`; hardcoded `"vellum-owner-default"` or user=owner bypass; undo does not revert `encryption_config`. |
| **Unhandled `KeyError` -> HTTP 500** | `backend/app.py` (45+ routes) | `session_manager.get_session(doc_id)` raises uncaught `KeyError` -> 500 instead of HTTP 404. |
| **Listbox Form Field Creation** | `backend/engine/forms_signatures.py:31, 120–139` | Listed in `WIDGET_TYPE_NAMES` but `create_form_field` raises `ValueError: Unsupported form field type: listbox` (HTTP 500). |
| **OCR Language Selection (RapidOCR)** | `backend/engine/ocr_convert.py:27–33, 102`, `src/App.tsx:2898` | `language` parameter is ignored by RapidOCR; `GET /api/ocr/languages` is unwired in UI. |
| **Signature CA Chain Verification** | `backend/engine/forms_signatures.py:587–590` | `trust_roots=[signer_cert]` self-trusts any certificate without validating against system/user CA trust store or CRL/OCSP. |
| **Rotated Page Annotations** | `backend/engine/annotations.py:63, 107` | Missing `rect_to_display` / `rect_to_pdf` conversions; annotations misplace on 90°/180°/270° pages. |
| **Reorder Pages Partial-List Data Loss** | `backend/engine/page_ops.py:102–115` | `doc.select(valid)` silently deletes omitted pages if `new_order` is incomplete. |
| **Image Alpha Destruction in Optimizer** | `backend/engine/security_optimize.py:305–316` | `.convert("RGB")` + JPEG encoding turns transparent PNG/RGBA backgrounds black. |
| **Regex Redaction ReDoS & Over/Under-Match** | `backend/engine/security_optimize.py:133–140` | Unvalidated `re.compile()` risks ReDoS; `page.search_for(matched_str)` can redact unintended duplicates or miss wrapped text. |

### 2.2 Backend-Only Features (Implemented in Engine/API, Unwired in UI)
| Feature | Backend / `api.ts` Location | Gap in `src/App.tsx` |
|---|---|---|
| **Batch Document Conversion** | `backend/app.py:1529`, `ocr_convert.py:561` | Not exported in `src/api.ts`, no Batch Convert UI modal. |
| **OCR Languages Discovery** | `backend/app.py:1414` (`GET /api/ocr/languages`) | `App.tsx:2898` hardcodes `<select>` options instead of querying backend capabilities. |
| **Annotation Update** | `backend/app.py:1219`, `src/api.ts:312` (`updateAnnotation`) | Never called in `src/App.tsx`; users can only create or delete annotations. |
| **Form Field Edit & Delete** | `backend/app.py:1296, 1319`, `src/api.ts:344, 352` | `updateFormField` and `deleteFormField` never called in `src/App.tsx`. |
| **Discard Recovery Snapshot** | `backend/app.py:694`, `src/api.ts:132` (`discardRecovery`) | Crash Recovery modal (`App.tsx:5793–5835`) has Restore only, no Discard button. |

### 2.3 Partial Features (Missing Key Capabilities)
- **Core Editing:** Subset font glyph synthesis (warns/falls back only), copy/paste across documents or from OS image clipboard, non-orthogonal (e.g., 45°) text editing, shape deletion accidentally erasing intersecting native line art (`PDF_REDACT_LINE_ART_REMOVE_IF_COVERED`), underline/strikethrough/list formatting in rich editor.
- **Page Management:** Large-doc thumbnail pagination (currently loads all pages synchronously as base64), visual interactive page-crop marquee, multi-file merge wizard from disk, split by bookmarks/file size.
- **OCR:** Orientation detection & OpenCV deskew, low-quality scan denoising/binarization, suspect-word confidence review UI, region OCR on mixed image+text pages, background job progress.
- **Forms & Signatures:** Signing existing empty `/FT /Sig` form fields directly, RFC 3161 TSA timestamps, DSS/LTV embedding, warning before editing a signed PDF.
- **Security:** Bulk attachment removal in `sanitize_pdf_metadata` (`attached_files=False` hardcoded), explicit `/OpenAction`/`/AA`/`/Names/JavaScript` stripping in `pikepdf` sanitize pass, unsaved-changes confirmation prompt on dirty tab/window close.
- **Annotations:** Multi-line `QuadPoints` for highlight/underline/strikeout, `garbage > 0` cleanup on delete.
- **Conversions:** Pseudo-PDF/A when Ghostscript (`gs`) is absent (and `ghostscript` missing from `.deb` Recommends), XLSX/PPTX/HTML to PDF.
- **Advanced:** Unequal page count handling in `compare_pdf_documents`, heuristic-only preflight/accessibility (false positive "Tagged PDF" check without `/StructTreeRoot`).
- **UX & Linux:** High-DPI `devicePixelRatio` canvas scaling, WAI-ARIA accessibility (only 7 attributes in 6,055 lines), persistent rotating log files, X11-only testing (Wayland untested), cross-distro font discovery (`utils.py` hardcodes `/usr/share/fonts/truetype/...`).

### 2.4 Completely Missing Features
- **Core Editing:** Multi-object selection (Shift+Click / marquee) and batch transform; object alignment, distribution, and Z-order/layering control; Find & Replace across document.
- **Page Management:** Replace Pages (`replace_pages`), Page Background color/image editing.
- **OCR:** Multi-document Batch OCR queue.
- **Forms:** Form flattening, FDF/XFDF/JSON/CSV form data import/export, field validation rules, calculated fields, XFA detection/warning banner.
- **Annotations:** Comment threading (`/IRT`), review workflow states (Accepted/Rejected/Completed), FDF/XFDF annotation import/export, custom image stamps.
- **Conversions:** PDF to PowerPoint (`.pptx`) (`python-pptx` not installed), HTML to PDF, Excel/PowerPoint to PDF.
- **Advanced:** Printable Table of Contents page generation, PDF Portfolios (`/Collection`), true Tagged PDF (`/StructTreeRoot`) & Reading Order editor & PDF/UA compliance, Print Production tools (separations, CMYK, ink manager, printer marks, bleed/trim), Action Wizard / headless CLI subcommands.
- **UX & Packaging:** Recent Documents list, in-app update check, clean VM `dpkg -i` and non-Ubuntu distro (Fedora/Arch) verification.

---

## 3. Architectural Weaknesses Evaluation

### 3.1 Frontend Component Organization (`src/App.tsx` Monolith — 6,055 lines)
- **Observation:** Nearly the entire React application—state management, 9 modals, 7 top menus, 5 left sidebar tabs, 9 mode toolbars, canvas rendering, drag/resize/snap math, inline editors, context menu, and right-hand properties inspector—lives in a single 6,055-line file (`src/App.tsx`).
- **Impact:** High cognitive load, brittle merge conflicts, difficult unit testing of individual panels, and risk of accidental regressions when adding Phase 2–4 UI (multi-select, form properties, annotation editing, batch queue).
- **Recommended Refactor (High Concrete Benefit):** Incrementally extract cohesive modules (`src/components/TopMenuBar.tsx`, `CanvasStage.tsx`, `LeftSidebar.tsx`, `RightInspector.tsx`, `Modals.tsx`, `hooks/useDocumentSession.ts`, `hooks/useCanvasTransform.ts`) **only as each area is touched for Phase 1–3 work**, rather than a risky big-bang rewrite.

### 3.2 State Management & Unidirectional Sync
- **Observation:** `App.tsx` holds dozens of `useState` hooks with manual synchronization between `activeDoc`, `pageObjects`, `annotations`, `formFields`, `draftParagraph`, and `selectedObject`.
- **Impact:** Easy to leave stale overlays after mutations or undo/redo if a handler forgets to refresh one slice (e.g., annotations vs page objects vs thumbnails).
- **Recommended Refactor:** Centralize post-mutation refresh into a typed `refreshPageState(docId, pageIndex, scopes)` helper / reducer.

### 3.3 PDF Object Representation (`/VellumData` Private Page Dictionary)
- **Observation:** Custom Vellum-created text boxes and shapes are stored as JSON in a private `/VellumData` key on each PDF page dictionary (`direct_edit.py:154–174`), alongside actual drawn PDF content operators.
- **Strength:** Survives save/reopen and external viewers render the actual PDF operators cleanly.
- **Weakness:** If an external PDF editor modifies or rewrites a page without preserving custom `/VellumData` keys, Vellum loses object-level metadata for those boxes/shapes and falls back to raw PDF spans. Also, deleting shapes uses `PDF_REDACT_LINE_ART_REMOVE_IF_COVERED`, which can damage overlapping native vector art.
- **Recommendation:** Keep `/VellumData` for Vellum-authored editable metadata, but isolate Vellum-drawn shapes/text boxes into Form XObjects (`/XObject`) or Marked Content (`BDC`/`EMC`) sequences in Phase 2 so deletion/reordering/Z-order never damages underlying native graphics.

### 3.4 Document Mutation History (`SessionManager`)
- **Observation:** `HistoryEntry` (`session.py:20–26`) stores full raw `pdf_bytes: bytes` for up to 35 undo states per open tab, plus an **uncapped** `redo_stack`, and does **not** snapshot `encryption_config` or `is_encrypted`. Furthermore, `_write_recovery_snapshot` synchronously writes the entire `pdf_bytes` to disk on every mutation (`session.py:363–379`).
- **Impact:** Severe RAM pressure on large PDFs (~1.75 GB RAM for 35 edits on a 50 MB PDF), UI/backend stalls from synchronous disk writes, and broken undo for encryption changes.
- **Recommended Refactor (Critical):** Cap `redo_stack` to `max_history`, include `encryption_config` in `HistoryEntry`, spill older/large history snapshots to content-addressed temp files on disk (keeping only recent N or metadata in RAM), and debounce/async-write recovery snapshots.

### 3.5 Backend API Design & Error Handling
- **Observation:** `backend/app.py` (1,879 lines) has 60+ routes in one file, calls `session_manager.get_session(doc_id)` without catching `KeyError` on 45+ endpoints (returning HTTP 500 instead of 404), reads full `UploadFile` into RAM without size limits, and uses `allow_origins=["*"]` + `allow_credentials=True` with zero auth.
- **Recommended Refactor:** Add FastAPI exception handlers mapping `KeyError -> 404` and `ValueError -> 400`, enforce per-launch `X-Vellum-Token` middleware, restrict CORS, add upload size limits, and split `app.py` into FastAPI `APIRouter` modules (`routes/docs.py`, `routes/edit.py`, `routes/forms.py`, `routes/security.py`, etc.).

### 3.6 Electron Security & Python Process Management
- **Observation:** `electron/preload.cjs` properly uses `contextIsolation: true` and `nodeIntegration: false`. However, `scripts/build_packages.sh` hardcodes `--no-sandbox` in both `vellum-launcher.sh` and `AppRun`, and `electron/main.cjs` logs only in an in-memory 120-line ring buffer.
- **Recommendation:** Pass per-launch `VELLUM_API_TOKEN` from `electron/main.cjs` to the Python sidecar env and expose it via `preload.cjs`; add rotating disk logs; evaluate `chrome-sandbox` permissions in `.deb` so `--no-sandbox` isn't needed for `.deb` installs.

### 3.7 Test Architecture, Dependencies & Packaging Pipeline
- **Test Architecture:** Strong pytest engine/API integration coverage (27 tests) and Node/CDP GUI scripts, **but** `.github/workflows/ci.yml` omits `npx tsc --noEmit`, omits GUI/Electron smoke tests, and omits `pip-audit`/`npm audit`.
- **Dependencies:** `requirements.txt` pins 74 packages including **both** `opencv-python` and `opencv-python-headless`, omits `python-pptx`, and relies on system `libreoffice-core`, `tesseract-ocr`, and `ghostscript` (`ghostscript` isn't even in `.deb` Recommends). PyMuPDF + Ghostscript dictate `AGPL-3.0-only` licensing.
- **Packaging Pipeline:** `scripts/build_packages.sh` bundles the build host's CPython (`sys.base_prefix`) and `purelib` wholesale (~389–450 MB packages) and fetches an unpinned `continuous` AppImage runtime from GitHub if not cached. Pinning the runtime SHA-256, pruning unused OpenCV GUI/test files, and building on an older LTS glibc baseline (Ubuntu 22.04) will significantly improve portability and reproducibility.

