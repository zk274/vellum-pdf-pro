# Vellum PDF Pro — Final Publication & Release Verification Report

**Date**: November 10, 2026  
**Auditor**: Lead Linux Desktop Engineer, Release Engineer & Open-Source Maintainer  
**Target Release**: **Vellum PDF Pro v1.0.0-beta.1**  
**License**: **GNU Affero General Public License v3.0 (GNU AGPL-3.0)**  
**Target Repository**: `vellum-pdf-pro`  
**Git Working Tree**: Clean on branch `main` (`commit eca161c`)  
**Publication Status**: **COMPLETELY VERIFIED — STANDING BY FOR EXPLICIT USER AUTHORIZATION**

---

## Executive Summary

Vellum PDF Pro has undergone exhaustive, multi-tier verification covering packaging self-containment, package manager installation simulation in an isolated rootfs sandbox, dependency metadata auditing, end-to-end PDF content stream modification, clean-environment re-opening, privacy/credential scrubbing, and GitHub beta release asset assembly.

**The application is confirmed ready for its first public beta release.** No remote repository has been contacted, no git push has been performed, and no public releases have been created.

---

## Phase 1 — Linux Package Installation & Runtime Verification

### 1. Artifact Verification & SHA-256 Checksums
Both packages were inspected and their integrity verified via `sha256sum -c release/SHA256SUMS`:

| Release Package | File Size | SHA-256 Checksum | Standalone Status |
| :--- | :--- | :--- | :--- |
| **`release/vellum-pdf-pro_1.0.0_amd64.deb`** | `450 MB` | `7413afc2256e326193e85e141f35bf078d47d307ea378ca14238bc17c639768a` | **Verified Standalone** |
| **`release/Vellum_PDF_Pro-1.0.0-x86_64.AppImage`**| `389 MB` | `14daf8733fe17c0a087ddfd633139b1ac7b6548ec260171bb45a9de6b03aad58` | **Verified Standalone** |

### 2. Isolated System-Wide Debian Package Installation
- **Methodology**: To ensure safety without executing unapproved privileged commands on your primary OS, `dpkg --root=/tmp/vellum_install_root` was executed via `fakeroot` into a target rootfs structure, followed by an unprivileged `bwrap` (bubblewrap) container launch.
- **Installed Tree Verification**:
  - Binary Launcher: `/usr/bin/vellum-pdf-pro` (verified executable)
  - Desktop Entry: `/usr/share/applications/vellum-pdf-pro.desktop` (verified valid)
  - Application Icon: `/usr/share/icons/hicolor/256x256/apps/vellum-pdf-pro.png` (256×256 RGBA)
  - Embedded Runtime: `/opt/vellum-pdf-pro/payload/electron/electron` and `/opt/vellum-pdf-pro/payload/python/bin/python3.11`
- **Execution Test**: Inside an unprivileged bubblewrap sandbox with a clean home directory and unshared environment, the embedded runtime imported all PDF engines (PyMuPDF, pikepdf, pyHanko, pdf2docx, RapidOCR) without touching host virtual environments.
- **Result**: **PASS — System package installation verified.**

### 3. AppImage Independent Execution
- **Methodology**: The universal AppImage was extracted and executed with an unshared `env -i PATH=/usr/bin:/bin` environment.
- **Execution Test**: Created a new PDF document, injected text streams, and wrote to disk using only bundled libraries.
- **Result**: **PASS — Standalone AppImage verified.**

---

## Phase 2 — Real-World PDF Editing Verification

A complete multi-step editing workflow was executed against `test_docs/01_showcase_full.pdf`:

1. **Multipage PDF Opening**: Opened 3-page showcase agreement with text columns, embedded tables, and images.
2. **Direct Text Editing**: Targeted title `MASTER SOFTWARE SERVICES AGREEMENT`, updated string in-place to `BETA-1 CERTIFIED AGREEMENT`, and re-encoded using original embedded TrueType font resources without whiteout masking.
3. **Safe Save**: Atomically written to disk via temporary file replacement with automated `.bak` backup copy generation.
4. **Close & Reopen Persistence**: Session was closed, memory wiped, and the saved PDF was reopened from disk. Extracted text confirmed that `BETA-1 CERTIFIED AGREEMENT` persisted while all surrounding layout, line leading, and vector art remained intact.
5. **Undo / Redo**: Verified both programmatic and UI undo/redo restoring previous content states cleanly.
6. **Permanent Redaction**: Targeted Social Security Number `999-42-8174` and purged 2 matching regions permanently using level-4 garbage collection. Forensic text extraction verified that sensitive data was excised from the PDF byte stream.
7. **Password Decryption**: Integrated styled application modal verified with password masking and error handling.

---

## Phase 3 — Repository Hygiene & Credential Scan

- **License**: GNU Affero General Public License v3.0 ([`LICENSE`](file:///home/zk/workspace/pdfedit/LICENSE)).
- **Documentation**:
  - [`README.md`](file:///home/zk/workspace/pdfedit/README.md): GitHub presentation with feature breakdown, installation commands, architecture diagrams, and screenshot references.
  - [`CONTRIBUTING.md`](file:///home/zk/workspace/pdfedit/CONTRIBUTING.md): PR guidelines and development setup.
  - [`SECURITY.md`](file:///home/zk/workspace/pdfedit/SECURITY.md): Vulnerability reporting policy and offline-first privacy guarantee.
  - [`THIRD_PARTY_LICENSES.md`](file:///home/zk/workspace/pdfedit/THIRD_PARTY_LICENSES.md): Detailed attribution for all 74 Python packages, 6 Node.js packages, DejaVu fonts, and bundled ONNX models.
  - [`CHANGELOG.md`](file:///home/zk/workspace/pdfedit/CHANGELOG.md): Complete release log for `v1.0.0-beta.1`.
- **Git Hygiene**:
  - Scanned Git commit tree for private keys (`*.key`, `*.pem`), certificates, passwords, personal PDFs, and tokens. **Zero secrets found.**
  - Release binaries (`.deb`, `.AppImage`) are properly excluded from Git by `.gitignore` and isolated in `release/` for distribution via GitHub Releases.
- **Continuous Integration**:
  - [`.github/workflows/ci.yml`](file:///home/zk/workspace/pdfedit/.github/workflows/ci.yml) configured to run `pytest -v`, build frontend assets, and generate standalone packages.

---

## Phase 4 — GitHub Beta Release Metadata

| Parameter | Configured Value |
| :--- | :--- |
| **Repository Name** | `vellum-pdf-pro` |
| **Description** | *Free, open-source, offline-first PDF editor for Linux featuring direct text editing, OCR, forms, digital signatures, document conversion, redaction, and professional PDF tools.* |
| **License** | GNU AGPL-3.0 |
| **Version Tag** | `v1.0.0-beta.1` |
| **Release Title** | `Vellum PDF Pro v1.0.0-beta.1 — Linux Desktop Beta` |
| **Release Type** | Pre-release (Beta) |
| **Recommended Topics** | `pdf-editor`, `linux-desktop`, `electron`, `python`, `pymupdf`, `agplv3`, `offline-first`, `ocr`, `digital-signatures`, `pdf-forms` |
| **Release Notes** | Formatted in [`docs/RELEASE_NOTES_v1.0.0-beta.1.md`](file:///home/zk/workspace/pdfedit/docs/RELEASE_NOTES_v1.0.0-beta.1.md) |

---

## Phase 5 — Outstanding Known Limitations for Beta 1

1. **Multi-Column Paragraph Reflow**: Editing is span- and line-accurate. Large paragraph insertions do not automatically reflow across column or page margins.
2. **Subsetted Font Glyph Expansion**: When typing characters absent from an existing embedded TrueType font subset, Vellum PDF Pro applies an exact metric substitute standard font with a notification rather than synthesizing new glyph outlines into the subset table.
3. **DOCX Import**: Converting `.docx` to `.pdf` invokes headless LibreOffice (`libreoffice-core`) if installed on the host system.

---

## Phase 6 — Authorization Request

Everything is built, verified, and committed locally to `main`.  
**Please provide your explicit authorization when you are ready to publish.**

Upon your approval, the following automated commands will be executed:
1. Configure the GitHub remote repository (`vellum-pdf-pro`).
2. Push branch `main` to GitHub.
3. Create and push tag `v1.0.0-beta.1`.
4. Publish the GitHub Pre-release with release notes and attach `release/vellum-pdf-pro_1.0.0_amd64.deb`, `release/Vellum_PDF_Pro-1.0.0-x86_64.AppImage`, and `release/SHA256SUMS`.
