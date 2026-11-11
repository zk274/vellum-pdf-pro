# Contributing to Vellum PDF Pro

Thank you for your interest in contributing to **Vellum PDF Pro**!  
We welcome contributions from developers, PDF technology enthusiasts, designers, technical writers, and testers across the Linux community.

---

## 1. Code of Conduct & Principles

- **Linux-First & Offline-Default**: All core PDF operations must work completely offline without external network calls, proprietary cloud accounts, or telemetry.
- **Genuine Document Modification**: Features must manipulate genuine PDF objects (content streams, XREF tables, TrueType glyph tables, AcroForms) rather than visual overlays or whiteout patches.
- **Strict Copyleft & Open Source**: Vellum PDF Pro is licensed under **GNU AGPL-3.0**. By contributing, you agree that your contributions will be licensed under the GNU Affero General Public License version 3.

---

## 2. Development Setup

### Prerequisites
- Linux x86_64 or aarch64 (Ubuntu 22.04+, Debian 12+, Fedora 38+, Arch Linux)
- Node.js `20.x` or later & `npm`
- Python `3.11` or `3.12`
- Recommended system packages:
  ```bash
  sudo apt install -y python3-venv python3-dev build-essential tesseract-ocr libreoffice-core
  ```

### Local Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/your-username/vellum-pdf-pro.git
   cd vellum-pdf-pro
   ```
2. Set up the Python virtual environment:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install --upgrade pip
   pip install fastapi uvicorn pymupdf pikepdf pyhanko pyhanko-certvalidator \
               pdfplumber pdf2docx fonttools pillow rapidocr-onnxruntime \
               pytest anyio httpx
   ```
3. Install frontend dependencies:
   ```bash
   npm install
   ```

### Running the Application in Development Mode
```bash
# Terminal 1: Python FastAPI Local Backend
npm run dev:backend

# Terminal 2: Vite Hot-Reload Frontend
npm run dev:frontend

# Terminal 3: Electron Desktop Shell
npm run electron:start
```

---

## 3. Testing & Verification

Every pull request must pass the automated test suite and maintain document fidelity:
```bash
# Run backend engine tests
npm run test:backend

# Build production bundle
npm run build

# Package standalone Linux distributions (.deb & .AppImage)
npm run package:linux
```

### Guidelines for PDF Engine Changes
- When touching `backend/engine/direct_edit.py`, verify that text changes preserve surrounding layout on tight-leading lines (e.g. 10.5pt on 12pt text) and zero-gap adjacent spans.
- Run tests on both unrotated and rotated (90°/180°/270°) pages.
- Add regression test cases in `tests/test_pdf_engine_and_api.py` for any bug fix.

---

## 4. Submitting a Pull Request (PR)

1. Fork the repository and create your branch from `main`:
   ```bash
   git checkout -b feature/my-cool-feature
   ```
2. Commit your changes with clear, descriptive commit messages.
3. Ensure no temporary test PDFs, private keys, or `.bak` files are tracked.
4. Push to your fork and submit a Pull Request targeting `main`.
5. Provide a summary of changes, screenshot evidence (for UI modifications), and test results.
