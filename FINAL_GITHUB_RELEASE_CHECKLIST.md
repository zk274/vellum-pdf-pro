# Final GitHub Public Release Checklist — Vellum PDF Pro v1.0.0-beta.1

**Prepared for**: Public Open-Source Release on GitHub  
**Release Tag**: `v1.0.0-beta.1`  
**License**: GNU Affero General Public License v3.0 (GNU AGPL-3.0)  
**Status**: **ALL AUTOMATED REQUIREMENTS MET — PENDING EXPLICIT USER AUTHORIZATION**

> [!IMPORTANT]
> In accordance with user instructions, **no git push or remote publication has been performed**. All files are committed locally on `main`.

---

## 1. Release Verification Matrix

| Verification Item | Status | Verified Evidence & Findings |
| :--- | :--- | :--- |
| **Clean Standalone Execution** | **PASS** | Both `.deb` (450 MB) and `.AppImage` (389 MB) launch and execute PDF generation cleanly in an isolated environment without host python or npm packages. |
| **PyMuPDF Version Audit** | **PASS** | Verified version `2.1` (`mupdf 1.28.6`), dual-licensed under **GNU AGPL-3.0** / Artifex Commercial. Mandates AGPL-3.0 for Vellum PDF Pro. |
| **pdf2docx Relicensing Audit** | **PASS** | Verified version `0.5.13` officially relicensed under **MIT License** (`.dist-info/METADATA` and `.dist-info/licenses/`). |
| **Third-Party Attribution** | **PASS** | All 74 Python packages, 6 Node.js packages, DejaVu fonts, and bundled ONNX neural models cataloged in [`THIRD_PARTY_LICENSES.md`](file:///home/zk/workspace/pdfedit/THIRD_PARTY_LICENSES.md). |
| **Automated Test Suite** | **PASS** | 14 test suites, 65+ unit/integration assertions passing (`100% pass rate in 19.78s`). |
| **Full E2E Edit-Save-Reopen** | **PASS** | Verified complete round-trip: open PDF $\to$ direct text edit $\to$ atomic save $\to$ `.bak` backup $\to$ close $\to$ reopen from disk. |
| **Credential & Secret Scan** | **PASS** | Zero private keys, certificates, API tokens, passwords, or personal documents tracked in Git or working tree. |
| **Repository Documents** | **PASS** | `README.md`, `LICENSE` (AGPL-3.0), `CONTRIBUTING.md`, `SECURITY.md`, `CHANGELOG.md`, and `RELEASE_READINESS.md` prepared. |
| **CI Automation** | **PASS** | `.github/workflows/ci.yml` configured for automated test execution and Linux package building on push/PR. |
| **SHA-256 Checksums** | **PASS** | Calculated and verified in [`release/SHA256SUMS`](file:///home/zk/workspace/pdfedit/release/SHA256SUMS). |

---

## 2. Artifact Checksums

```text
14daf8733fe17c0a087ddfd633139b1ac7b6548ec260171bb45a9de6b03aad58  release/Vellum_PDF_Pro-1.0.0-x86_64.AppImage (389 MB)
7413afc2256e326193e85e141f35bf078d47d307ea378ca14238bc17c639768a  release/vellum-pdf-pro_1.0.0_amd64.deb (450 MB)
```

---

## 3. Human Review & Deployment Steps Required for Publication

When you are ready to publish the repository to GitHub, execute the following manual commands:

### Step 1: Create the Remote Repository on GitHub
Create a new public repository on GitHub (e.g. `https://github.com/<your-username>/vellum-pdf-pro`).  
*Do not initialize with a README, .gitignore, or license on GitHub (these are already present in the local repository).*

### Step 2: Add Remote and Push Local Branch
```bash
git remote add origin https://github.com/<your-username>/vellum-pdf-pro.git
git branch -M main
git push -u origin main
```

### Step 3: Create and Push Git Release Tag
```bash
git tag -a v1.0.0-beta.1 -m "Vellum PDF Pro v1.0.0-beta.1 (Initial Public Beta Release)"
git push origin v1.0.0-beta.1
```

### Step 4: Publish GitHub Release
In the GitHub repository interface:
1. Navigate to **Releases** $\to$ **Draft a new release**.
2. Select tag `v1.0.0-beta.1`.
3. Set Title: `Vellum PDF Pro v1.0.0-beta.1 (Linux Desktop Edition)`.
4. Copy and paste the contents of [`docs/RELEASE_NOTES_v1.0.0-beta.1.md`](file:///home/zk/workspace/pdfedit/docs/RELEASE_NOTES_v1.0.0-beta.1.md) into the description.
5. Attach the two binary installer files:
   - `release/vellum-pdf-pro_1.0.0_amd64.deb`
   - `release/Vellum_PDF_Pro-1.0.0-x86_64.AppImage`
6. Check **"Set as a pre-release"** (Beta 1).
7. Click **Publish release**.

---

## 4. Remaining Operational Considerations
- **Root-Level `sudo dpkg -i` Testing**: The `.deb` package was verified via isolated rootless filesystem extraction and execution. If deploying to an actual machine with root privileges, run `sudo apt install ./vellum-pdf-pro_1.0.0_amd64.deb` to automatically satisfy any missing GTK3/NSS desktop libraries.
- **Commercial Inquiries**: If any commercial users request closed-source redistribution or integration without AGPL-3.0 obligations, refer them to Artifex Software Inc. for a commercial PyMuPDF OEM license.

