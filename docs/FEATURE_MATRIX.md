# Vellum PDF Pro — Feature Completion Matrix & Roadmap

## 1. Feature Completion Matrix

| Category | Feature Requirement | Implementation Module | Backend Verified | UI Connected | Persistence & QA Tested | Status |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: |
| **Application Shell** | Linux desktop application (Electron + Python 3.11 sidecar) | `electron/main.cjs`, `backend/app.py` | Yes | Yes | Yes | **Complete** |
| **Application Shell** | Multi-document tabbed editing, Dark & Light themes | `src/App.tsx`, `src/styles.css` | Yes | Yes | Yes | **Complete** |
| **Application Shell** | Native file dialogs, drag-and-drop, printing, shortcuts, Command Palette (`Ctrl+K`) | `electron/preload.cjs`, `src/App.tsx` | Yes | Yes | Yes | **Complete** |
| **Resilience** | Full Undo/Redo stack with SHA-256 state tracking | `backend/engine/session.py` | Yes | Yes | Yes | **Complete** |
| **Resilience** | Automatic Crash Recovery journaling & restoration | `backend/engine/session.py` | Yes | Yes | Yes | **Complete** |
| **Resilience** | Safe Atomic Save, Save As, and `.bak` backup creation | `backend/engine/session.py` | Yes | Yes | Yes | **Complete** |
| **Direct PDF Edit** | Click & edit existing PDF text in-place without white-box masking | `backend/engine/direct_edit.py` (`edit_text_span`) | Yes | Yes | Yes | **Complete** |
| **Direct PDF Edit** | Original font re-encoding + transparent subset font fallback notice | `backend/engine/direct_edit.py` (`_encode_with_original_font`) | Yes | Yes | Yes | **Complete** |
| **Direct PDF Edit** | Move/resize text spans, modify font/size/color/bold/italic/alignment, add/delete text | `backend/engine/direct_edit.py` | Yes | Yes | Yes | **Complete** |
| **Direct PDF Edit** | Insert, replace, move, resize, rotate, crop, and delete embedded PDF images | `backend/engine/direct_edit.py` (`edit_image_object`) | Yes | Yes | Yes | **Complete** |
| **Direct PDF Edit** | Add vector shapes (rectangles, ellipses, lines, arrows) & edit hyperlinks | `backend/engine/direct_edit.py` | Yes | Yes | Yes | **Complete** |
| **Page Management** | Insert blank pages, delete, duplicate, extract, drag-and-drop reorder | `backend/engine/page_ops.py` | Yes | Yes | Yes | **Complete** |
| **Page Management** | Rotate (`±90°/180°`), crop margins (`CropBox`), resize dimensions (A4/Letter) | `backend/engine/page_ops.py` | Yes | Yes | Yes | **Complete** |
| **Page Management** | Merge multiple PDFs, split PDFs by page ranges, insert pages from external PDF | `backend/engine/page_ops.py` | Yes | Yes | Yes | **Complete** |
| **Annotations** | Highlight, underline, strikethrough, sticky notes, text callouts, freehand ink | `backend/engine/annotations.py` | Yes | Yes | Yes | **Complete** |
| **Annotations** | Arrows, shapes, stamps (`APPROVED`, `CONFIDENTIAL`, `DRAFT`, `FINAL`, `VOID`) | `backend/engine/annotations.py` | Yes | Yes | Yes | **Complete** |
| **Annotations** | Comment list navigation, author & timestamp metadata, edit & delete annotations | `backend/engine/annotations.py` | Yes | Yes | Yes | **Complete** |
| **Forms & Signatures** | Inspect & fill existing AcroForms; create Text, Checkbox, Radio, Dropdown, Signature widgets | `backend/engine/forms_signatures.py` | Yes | Yes | Yes | **Complete** |
| **Forms & Signatures** | Visual signatures (typed/drawn/image) vs. X.509 PKCS#12 cryptographic signing & verification | `backend/engine/forms_signatures.py` (`pyHanko`) | Yes | Yes | Yes | **Complete** |
| **OCR & Conversion** | Offline neural OCR (`RapidOCR` ONNX Runtime) with invisible searchable text layer (`Tr=3`) | `backend/engine/ocr_convert.py` | Yes | Yes | Yes | **Complete** |
| **OCR & Conversion** | PDF ↔ DOCX, PDF → Excel `.xlsx`/`.csv` tables, PDF → HTML/Text/Images, Images → PDF, Batch | `backend/engine/ocr_convert.py` | Yes | Yes | Yes | **Complete** |
| **Security & Opt** | AES-256 (`R=6`) password encryption, granular permissions, decryption (`pikepdf`) | `backend/engine/security_optimize.py` | Yes | Yes | Yes | **Complete** |
| **Security & Opt** | Permanent content stream & pixel Redaction (box, search terms, regex) | `backend/engine/security_optimize.py` | Yes | Yes | Yes | **Complete** |
| **Security & Opt** | Hidden metadata scrubbing, stream/image compression, font inspection, PDF repair | `backend/engine/security_optimize.py` | Yes | Yes | Yes | **Complete** |
| **Pro Features** | Visual pixel diff + unified text diff PDF Comparison | `backend/engine/pro_features.py` | Yes | Yes | Yes | **Complete** |
| **Pro Features** | Headers & Footers, Watermarks, Bates Numbering, Bookmarks, Attachments | `backend/engine/pro_features.py` | Yes | Yes | Yes | **Complete** |
| **Pro Features** | Accessibility & Preflight Inspector + Archival PDF/A-2b conversion | `backend/engine/pro_features.py` | Yes | Yes | Yes | **Complete** |
| **Distribution** | Debian package (`.deb`) and Linux `.AppImage` | `scripts/build_packages.sh` | Yes | Yes | Yes | **Complete** |

---

## 2. Prioritized Roadmap for Future Enhancements

1. **Multi-Line Paragraph Reflow with Embedded Subset Font Glyph Synthesis**:
   - Extend `_encode_with_original_font` in `backend/engine/direct_edit.py` to support automatic word-wrapped multi-line paragraph reflow across arbitrary column widths while preserving kerning pairs (`TJ` operator adjustments).
2. **PKCS#11 Hardware Token & Smartcard Signing**:
   - Extend `backend/engine/forms_signatures.py` to connect `pyHanko`'s PKCS#11 module to Linux OpenSC / YubiKey hardware tokens alongside `.p12`/`.pfx` files and RFC 3161 Timestamping Authorities (TSA).
3. **Interactive PDF Measurement & CAD Callout Tools**:
   - Add calibrated distance, perimeter, and area measurement annotations for architectural and engineering PDFs.
4. **Full Tagged PDF Structure Tree (`/StructTreeRoot`) Visual Editor**:
   - Provide a visual tag tree editor for manual WCAG 2.1 / PDF/UA reading-order adjustment.

