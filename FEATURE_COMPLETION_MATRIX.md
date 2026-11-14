# Vellum PDF Pro — Feature Completion Matrix

**Audit Date:** 2026-11-13  
**Baseline:** `feat/paragraph-editor` (`8437f47`)

---

## 1. Scoring Methodology & Uncertainty

### Credit Allocation Rules (Evidence-Based)
A feature only receives **1.00** credit when implemented end-to-end **and** verified in automated/runtime checks without known blocking defects.

| Audit Status | Credit | Rationale |
|---|---|---|
| `COMPLETE` | **1.00** | Implemented end-to-end and verified with tests/runtime checks |
| `COMPLETE` *(with minor caveat)* | **0.85** | Works end-to-end but has a documented non-blocking edge-case defect |
| `PARTIAL` | **0.50** | Core path works, but key capabilities or UI/backend wiring are missing |
| `BACKEND ONLY` / `UI ONLY` | **0.25** | One side exists; unusable as a complete user workflow |
| `NOT TESTED` | **0.25** | Code/packaging exists, but runtime verification is absent |
| `BROKEN` | **0.10** | Implemented, but fails verification or exhibits critical security/crash defect |
| `MISSING` | **0.00** | Not implemented |

### Uncertainty & Distinction: Coverage vs. Reliability
- **Feature Coverage** measures how much of the target capability surface exists.
- **Production Reliability** measures whether existing features can be shipped safely without security exposures, data loss, or unhandled crashes.
- **Uncertainty (±5–8%):** Scores reflect current codebase evidence on `feat/paragraph-editor` (27 pytest tests, TypeScript check, AppImage GUI script, and targeted `TestClient` probes). Untested real-world edge cases (e.g., native Microsoft Office binary PDFs, 200+ page files, non-Ubuntu distros, and native Wayland) introduce uncertainty that keeps reliability lower than raw feature coverage.

---

## 2. Assessment A — Core PDF Editor Completion

Evaluates the essential workflows required for a **reliable everyday open-source Linux PDF editor**.

| Core Domain | Weight | Verified Items & Credits | Domain Score | Weighted Contribution |
|---|---:|---|---:|---:|
| **1. Text & Paragraph Editing** | 25% | Span edit (1.0), Double-click inline (1.0), Paragraph reflow (1.0), Mixed-format runs (1.0), Font embed/replace (0.85), Subset fonts (0.5), Unicode Latin/complex (0.5), Text box create/del (1.0), Move/resize text (1.0), Text align/format (1.0), Rotated page text (1.0), Find & Replace (0.0) | 9.85 / 12 = **82.1%** | **20.5%** |
| **2. Objects, Images & Shapes** | 15% | Image insert/replace (1.0), Image move/crop/rotate/resize (1.0), Vector shapes (0.85), Hyperlinks (1.0), Copy/cut/paste/dup (0.5), Multi-object select (0.0), Align/distribute/Z-order (0.0) | 4.35 / 7 = **62.1%** | **9.3%** |
| **3. Page Management** | 15% | Insert blank (1.0), Delete (0.85), Reorder (0.5 — partial-list bug), Extract (1.0), Duplicate (1.0), Rotate (0.85), Crop (1.0), Split (1.0), Merge (1.0), Resize (1.0), Replace pages (0.0), Backgrounds (0.0) | 9.20 / 12 = **76.7%** | **11.5%** |
| **4. Annotations & Review (Core)** | 10% | Sticky/freetext/ink/shapes/stamps (0.5 — rotated coord bug), Highlight/underline/strikeout (0.5 — no QuadPoints/rotated bug), Edit annotations (0.25 — backend only), Preserve 3rd-party (0.5) | 1.75 / 4 = **43.8%** | **4.4%** |
| **5. Security & Data Safety** | 15% | Permanent redaction (0.85 — regex ReDoS/match flaw), Password/encryption lifecycle (0.10 — strips on save, decrypt ignores pwd), Metadata sanitize (0.85), Malformed repair (1.0), Local API/CORS/path security (0.10) | 2.90 / 5 = **58.0%** | **8.7%** |
| **6. Desktop UX, Session & Persistence** | 20% | Frameless/theme/branding (1.0), Tabs/DnD/dialogs (0.85 — no dirty-close prompt), Shortcuts/context menu (1.0), Undo/redo (0.5 — RAM bloat/no encrypt undo), Save/recovery (0.5 — sync write/path traversal), Error/loading (0.85 — 500s on KeyError), Recent docs (0.0), HiDPI/a11y (0.5) | 5.20 / 8 = **65.0%** | **13.0%** |
| **TOTAL CORE COMPLETION** | **100%** | — | — | **~67.4%** *(±6%)* |

### Core Production Reliability Assessment
While **Core Feature Coverage is ~67%**, **Core Production Reliability is substantially lower (~45–50% — Alpha grade)** until Phase 1 resolves:
- Local API authentication & CORS hardening
- Encryption preservation on save & decrypt password verification
- Unhandled `KeyError`/`ValueError` HTTP 500s
- `reorder_pages` data-loss guard & `annotations.py` rotated-page coordinates
- Unbounded undo/redo memory & dirty-close save prompt

---

## 3. Assessment B — Adobe Acrobat Pro-Class Feature Coverage

Evaluates the **full professional PDF suite** expected of an Adobe Acrobat Pro competitor.

| Pro Domain | Weight | Domain Summary & Verified Credits | Domain Score | Weighted Contribution |
|---|---:|---|---:|---:|
| **A. Core PDF Editing** | 20% | Direct span/paragraph/mixed-format editing, images, shapes, hyperlinks; missing multi-select, Z-order, Find & Replace, subset glyph synthesis | **~75.0%** | **15.0%** |
| **B. Page Management** | 10% | Core page ops + Bates/headers/footers/watermarks; missing Replace Pages, Backgrounds, large-doc Grid/pagination | **~75.0%** | **7.5%** |
| **C. OCR & Scanned Docs** | 10% | RapidOCR searchable PDF works (1.0), preserves appearance (1.0); broken RapidOCR language support (0.1), missing deskew/orientation (0.0), low-quality preprocessing (0.5), suspect correction (0.5), batch OCR (0.25) | **~47.9%** | **4.8%** |
| **D. Forms** | 10% | Text/check/radio/dropdown fill & create (1.0), appearances (1.0); listbox broken (0.1), edit/delete backend-only (0.25), signature widget in-place (0.5); missing flatten (0.0), FDF/XFDF (0.0), validation (0.0), calculations (0.0), XFA warning (0.0) | **~31.7%** | **3.2%** |
| **E. Digital Signatures** | 10% | PKCS#12 & visual sigs (1.0), visible appearance (1.0), multi-sig incremental writer (1.0); broken CA trust (0.5), missing RFC 3161 TSA (0.0), missing LTV/DSS (0.0) | **~58.3%** | **5.8%** |
| **F. Security & Redaction** | 10% | Permanent purge (0.85), sanitize (0.85), repair (1.0); broken encryption lifecycle (0.10), broken local API auth/CORS (0.10), missing bulk attachment strip (0.5) | **~56.7%** | **5.7%** |
| **G. Annotations & Review** | 7% | 9+ annot types (0.5), author/delete (0.5); backend-only edit (0.25); missing QuadPoints (0.0), threading `/IRT` (0.0), review states (0.0), XFDF import/export (0.0) | **~25.0%** | **1.8%** |
| **H. PDF Conversion** | 8% | Word/Excel/HTML/Text/Images/Img-to-PDF (1.0), DOCX-to-PDF (0.5), PDF/A (0.5 — pseudo without `gs`), Optimize (0.5 — alpha bug), Batch (0.25 — backend only); missing PDF-to-PPTX (0.0), HTML/XLSX/PPTX-to-PDF (0.0) | **~53.6%** | **4.3%** |
| **I. Advanced Acrobat Pro Tools** | 8% | Compare (0.85), Bookmarks (1.0), Attachments (1.0), Metadata (1.0); heuristic preflight/a11y (0.25), CLI open only (0.25); missing TOC page (0.0), Portfolios (0.0), Tagged PDF/PDF-UA (0.0), Print Production (0.0), Action Wizard (0.0) | **~39.5%** | **3.2%** |
| **J. Desktop UX** | 4% | Frameless/themes/shortcuts/tabs/error UI strong; missing recent docs, dirty-close prompt, full ARIA | **~65.0%** | **2.6%** |
| **K. Linux Distribution & Reliability** | 3% | AppImage/`.deb` build & X11 smoke test pass; untested `dpkg -i`, non-Ubuntu distros, Wayland; no auto-update or rotating logs | **~45.0%** | **1.4%** |
| **TOTAL ACROBAT PRO COVERAGE** | **100%** | — | — | **~55.3%** *(±7%)* |

---

## 4. Key Takeaways

1. **Core Editor (~67% feature coverage / Alpha reliability):** The hardest technical problem—non-whiteout direct PDF content-stream editing with paragraph reflow and mixed-style runs—is already solved and well-tested. Fixing Phase 1 stability/security bugs and Phase 2 core gaps brings Core Editor Completion into **>85% Beta/v1.0 territory**.
2. **Acrobat Pro Coverage (~55%):** Professional depth drops sharply in **Forms** (~32%), **Annotations & Review** (~25%), **Advanced Accessibility/Print Production** (~40%), and **OCR preprocessing/languages** (~48%). Reaching full Acrobat Pro parity requires Phases 3 and 4.

