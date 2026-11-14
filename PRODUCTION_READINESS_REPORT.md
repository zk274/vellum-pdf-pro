# Vellum PDF Pro — Production Readiness & Release Milestone Report

**Audit Date:** 2026-11-13  
**Branch:** `feat/paragraph-editor` (`8437f47`)

---

## 1. Current Production Readiness Verdict

**Earliest Milestone Responsibly Claimable Today:** **Public Alpha** (or **Developer Preview** for security-sensitive environments).  
**Status for Public Beta / Stable v1.0:** **NOT READY** — blocked by P0 local API security, encryption-stripping on save, page/form crash defects, rotated-page annotation bugs, and unverified cross-distro/clean-install Linux packaging.

While Vellum PDF Pro's **direct PDF content-stream editing engine** (span editing, paragraph reflow, mixed-format runs, redaction purge) is technically strong and well-tested (27/27 pytest passing, AppImage GUI verification passing), several surrounding lifecycle, security, and packaging safeguards are not yet at public beta or production quality.

---

## 2. Security Assessment

| Area | Current State | Severity | Evidence |
|---|---|---|---|
| **Local HTTP API Auth** | Unauthenticated `127.0.0.1:18420` | **Critical (P0)** | `backend/app.py`: Any local process can call all endpoints. |
| **CORS Policy** | `allow_origins=["*"]`, `allow_credentials=True` | **Critical (P0)** | `backend/app.py:102–108`: Permits cross-origin requests from malicious browser tabs to local API. |
| **Arbitrary Local File Read/Write** | Unsanitized `file_path` / `target_path` | **Critical (P0)** | `backend/app.py:597–654`: `/open-path` + `/download` reads any readable file; `/save` overwrites any writable file. |
| **Path Traversal in Recovery** | Unvalidated `doc_id` in path | **High (P0)** | `backend/engine/session.py:402–417`: `self.recovery_dir / f"{doc_id}.json"`. |
| **Encryption Stripping on Save** | `encryption_config = None` after open | **Critical (P0)** | `backend/engine/session.py:183, 244`: Opening an encrypted PDF and saving silently removes encryption. |
| **Decrypt Password Ignored** | `req.password` unused | **High (P0)** | `backend/app.py:1585–1592`: `api_decrypt_pdf` clears flag without verifying password. |
| **Weak Owner Password Fallback** | `"vellum-owner-default"` / `user==owner` | **High (P0)** | `backend/engine/security_optimize.py:32`: Bypasses permission restrictions. |
| **Regex Redaction ReDoS** | Unvalidated `re.compile()` | **Medium (P0)** | `backend/engine/security_optimize.py:133–135`: Catastrophic backtracking risk + over/under-matching via `search_for`. |
| **Signature Trust Validation** | Self-trusts `signer_cert` | **Medium (P1)** | `backend/engine/forms_signatures.py:587–590`: Reports self-signed certs as valid without distinguishing CA trust. |
| **Electron Renderer Security** | `contextIsolation: true`, `nodeIntegration: false` | **Good** | `electron/preload.cjs` uses `contextBridge`; however, `--no-sandbox` is hardcoded in `scripts/build_packages.sh`. |
| **Active PDF Content** | Passive rendering, `scrub(javascript=True)` | **Good (Partial)** | Hostile JS fixture passes, though `pikepdf` sanitize pass misses `/OpenAction` and `/AA`. |
| **Dependency CVE Scanning** | Not configured in CI | **Medium (P0)** | `.github/workflows/ci.yml` lacks `pip-audit` and `npm audit`. |

---

## 3. Reliability, Stability & Performance Assessment

1. **Unhandled HTTP 500s:** Calling any of 45+ routes with an invalid/expired `doc_id` raises `KeyError` -> HTTP 500; malformed page ranges (`parse_page_range_spec`) raise `ValueError` -> HTTP 500; creating a `listbox` form field raises `ValueError` -> HTTP 500.
2. **Data Loss Risks:**
   - `page_ops.reorder_pages` silently drops omitted pages if a partial list is supplied (`doc.select(valid)`).
   - Closing a dirty tab or window does not prompt to save changes (relies silently on crash recovery).
   - `optimize_and_compress_pdf` turns transparent PNG/RGBA images black by converting to RGB JPEG.
   - `annotations.py` misplaces annotations on 90°/180°/270° rotated pages.
3. **Memory & Large-File Behavior:**
   - `SessionManager` keeps up to 35 full `pdf_bytes` undo snapshots **plus** an uncapped `redo_stack` in RAM (~1.75 GB+ per 50 MB PDF), and writes full recovery PDFs synchronously on every edit.
   - `GET /api/docs/{doc_id}/thumbnails` renders all pages synchronously into a single base64 JSON response.
   - Tested up to 40 synthetic pages (`large_40p_synthetic`); 200+ page / 100+ MB real-world stress tests have **not** been run.
4. **Error Logging:** Electron buffers only 120 lines in memory (`recentBackendLogs`); no persistent rotating log files exist on disk.

---

## 4. Linux Distribution & Packaging Readiness

- **Build Artifacts Verified:** `vellum-pdf-pro_1.0.0_amd64.deb` (450 MB) and `Vellum_PDF_Pro-1.0.0-x86_64.AppImage` (389 MB) build cleanly via `scripts/build_packages.sh` with SHA-256 checksums.
- **Strengths:** Completely offline Python 3.11 + Electron 43 bundle; desktop file, PDF MIME association, and hicolor icons (16–512 + SVG) included; AppImage GUI smoke test passes on X11 (`DISPLAY=:0`).
- **Gaps Blocking Wide Linux Release:**
  1. **Clean Install Untested:** `.deb` was only extracted rootlessly; never tested via `sudo apt install` / `dpkg -P` on clean Ubuntu 22.04/24.04 or Debian 12.
  2. **Non-Ubuntu Distros Untested:** Fedora, Arch, and openSUSE are untested; `backend/engine/utils.py` hardcodes Debian `/usr/share/fonts/truetype/...` paths instead of `fontconfig` (`fc-match`).
  3. **Wayland Untested:** Tested on `DISPLAY=:0` (X11/XWayland) only; native Wayland Ozone flags not configured or tested.
  4. **Missing `ghostscript` Recommends:** `convert_to_pdfa` depends on `gs` for real PDF/A conversion, yet `.deb` `Recommends` only lists `tesseract-ocr, libreoffice-core`.
  5. **Reproducibility & Size:** `build_packages.sh` fetches an unpinned `continuous` AppImage runtime from GitHub when uncached, and `requirements.txt` bundles both `opencv-python` and `opencv-python-headless`.
  6. **CI Blind Spots:** `.github/workflows/ci.yml` does not run `npx tsc --noEmit` or headless Electron GUI tests.

---

## 5. Release Milestones & Gate Criteria

### Milestone 1: Developer Preview *(Achieved — Exceeded)*
- **Required Functionality:** Core PDF rendering, text/paragraph editing, basic page ops, prototype UI, dev test suite.
- **Status:** **Achieved** (verified on `feat/paragraph-editor`).

### Milestone 2: Public Alpha *(Earliest Responsibly Claimable Milestone Now)*
- **Required Functionality:** Working direct content-stream editing (spans, paragraphs, mixed runs), basic page management, annotations, basic forms/signatures, RapidOCR, conversions, AppImage/deb packaging for tester evaluation with clear "Alpha / Local-Only" disclaimers.
- **Test Coverage & Gates:** 27/27 pytest passing, `tsc --noEmit` 0 errors, `npm run build` passing, AppImage GUI smoke test passing.
- **Remaining Caveat for Alpha Labeling:** Must clearly document local-API single-user trust assumption, encryption re-save caveat, and Ubuntu/X11-only testing until Phase 1 fixes land.

### Milestone 3: Public Beta *(Target: After Phase 1 + Task 2.3 + Task 5.1)*
- **Required Functionality:** All Phase 1 P0/P1 fixes complete (API token auth, strict CORS, path traversal fix, encryption preserved on save, decrypt password check, 404/400 error mapping, `reorder_pages` guard, `listbox` fix, rotated-page annotations fix, regex redaction fix, optimizer alpha fix, bounded undo/redo + dirty-close prompt, signature intact vs trusted separation).
- **Test Coverage & Gates:**
  - All Phase 1 security & regression tests passing in pytest.
  - CI runs `pytest`, `npx tsc --noEmit`, `npm run build`, `pip-audit`, `npm audit`, and headless `xvfb-run` Electron smoke test.
  - Zero known P0 security or data-loss defects.
- **Documentation & Packaging:** Known limitations (subset font glyph synthesis, XFA, non-Ubuntu experimental) documented; `ghostscript` added to `.deb` Recommends; persistent logs enabled.

### Milestone 4: Stable v1.0 *(Target: After Phase 2 + Core Phase 3 + Phase 5)*
- **Required Functionality:**
  - Complete Core Editing: Multi-object selection/alignment/Z-order, Find & Replace, Replace Pages, Page Backgrounds, `fontconfig` font resolution, HiDPI scaling, Recent Docs, OS clipboard paste, paginated thumbnails for 200+ page PDFs.
  - Complete Professional Workflows: Annotation editing & `QuadPoints` & XFDF, full Form edit/delete/flatten/FDF-XFDF/validation/calculations/XFA banner, fixed OCR languages + deskew/preprocessing, RFC 3161 TSA timestamps, signed-doc edit warning.
- **Test Coverage & Gates:**
  - Clean `apt install` & `dpkg -P` verified on Ubuntu 22.04/24.04 & Debian 12; AppImage verified on Fedora, Arch, X11, and Wayland.
  - 200+ page / 100+ MB performance & memory benchmark passing.
  - WAI-ARIA `axe-core` accessibility audit passing with 0 critical violations.
  - Reproducible build with pinned AppImage runtime SHA-256.

### Milestone 5: Advanced Professional Release *(Target: After Phase 4)*
- **Required Functionality:** Tagged PDF (`/StructTreeRoot`) & Reading Order editor, PDF/UA validation, PAdES-LTV (`/DSS`), PKCS#11 smartcard/YubiKey signing, PDF Portfolios (`/Collection`), printable TOC generation, headless CLI batch mode, Action Wizard, prepress Print Production tools, PDF-to-PPTX & HTML/Office-to-PDF.
- **Test Coverage & Gates:** Full ISO 14289-1 (PDF/UA) and veraPDF PDF/A validation suite, SoftHSM2 PKCS#11 test suite, CLI automation suite.

