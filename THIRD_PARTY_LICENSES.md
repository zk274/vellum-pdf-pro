# Third-Party Licenses and Legal Notices

Vellum PDF Pro is licensed under the **GNU Affero General Public License v3.0 (GNU AGPL-3.0)**.  
This document enumerates third-party open-source software libraries, runtimes, assets, and dependencies incorporated into or utilized by Vellum PDF Pro, along with their respective licensing obligations, copyright notices, and redistribution terms.

---

## 1. Copyleft Engine Dependency (AGPL-3.0)

### PyMuPDF (fitz)
- **Version**: `2.1` (`PyMuPDF`)
- **License**: **Dual Licensed: GNU Affero General Public License v3.0 (AGPL-3.0) or Artifex Commercial License**
- **Copyright**: © 2026 Artifex Software, Inc.
- **Project URL**: <https://github.com/pymupdf/PyMuPDF>
- **Obligations**:
  - Because Vellum PDF Pro links with and utilizes PyMuPDF under its open-source license, Vellum PDF Pro itself is licensed and distributed under the **GNU AGPL-3.0**.
  - Complete, corresponding source code for Vellum PDF Pro must be made available to all recipients who run or interact with the application.
  - If a proprietary, closed-source commercial distribution is required without AGPL copyleft obligations, a commercial OEM license must be procured directly from Artifex Software, Inc.

---

## 2. Permissive Copyleft Dependencies (MPL-2.0)

### pikepdf / QPDF
- **Version**: `10.18.0` (`pikepdf`), linking QPDF C++ engine
- **License**: **Mozilla Public License 2.0 (MPL-2.0)** / **Apache License 2.0**
- **Copyright**: © 2018–2026 James R. Barlow and contributors
- **Project URL**: <https://github.com/pikepdf/pikepdf>
- **Obligations**:
  - The MPL-2.0 is a file-level copyleft license compatible with GNU AGPL-3.0.
  - Any modifications made directly to pikepdf source files must be made available under MPL-2.0.
  - Vellum PDF Pro utilizes unmodified pikepdf wheels via standard Python package bindings.

### certifi
- **Version**: `2026.10.23`
- **License**: **MPL-2.0**
- **Copyright**: © Kenneth Reitz and contributors

---

## 3. Permissive Dependencies (MIT / ISC / BSD / Apache-2.0)

### Core Python Backend Engines & Libraries

| Package | Installed Version | Declared License | Copyright / Maintainer |
| :--- | :--- | :--- | :--- |
| **pdf2docx** | `0.5.13` | **MIT License** *(Verified: Updated from legacy GPL-3.0 in recent releases)* | © 2020–2026 Artifex / pdf2docx contributors |
| **pyHanko** | `0.38.1` | **MIT License** | © 2020–2026 Matthias Valvekens |
| **pyhanko-certvalidator**| `0.33.0` | **MIT License** | © 2020–2026 Matthias Valvekens |
| **pdfplumber** | `0.11.10` | **MIT License** | © 2015–2026 Jeremy Singer-Vine and contributors |
| **pdfminer.six** | `20260107` | **MIT License** | © 2004–2026 Yusuke Shinyama and pdfminer.six contributors |
| **fonttools** | `4.68.0` | **MIT License** | © 1999–2026 Just van Rossum and fonttools contributors |
| **Pillow (PIL)** | `13.0.0` | **HPND / MIT-CMU License** | © 2010–2026 Alex Clark and Pillow contributors |
| **FastAPI** | `0.162.2` | **MIT License** | © 2018–2026 Sebastián Ramírez |
| **Starlette** | `1.10.0` | **BSD-3-Clause** | © 2018–2026 Encode OSS Ltd |
| **Uvicorn** | `0.54.0` | **BSD-3-Clause** | © 2017–2026 Encode OSS Ltd |
| **Pydantic** | `2.14.3` | **MIT License** | © 2017–2026 Samuel Colvin and Pydantic contributors |
| **Cryptography** | `50.0.2` | **Apache-2.0 OR BSD-3-Clause** | © 2013–2026 The Python Cryptographic Authority |
| **RapidOCR (onnxruntime)**| `1.4.4` | **Apache-2.0** | © 2021–2026 RapidAI / RapidOCR contributors |
| **ONNX Runtime** | `1.31.1` | **MIT License** | © Microsoft Corporation |
| **OpenCV Python Headless**| `5.0.0.93`| **Apache-2.0** | © OpenCV team and contributors |
| **OpenPyXL** | `3.1.5` | **MIT License** | © 2010–2026 Eric Gazoni, Charlie Clark |
| **Python-docx** | `1.2.0` | **MIT License** | © 2013–2026 Steve Canny |
| **Pytesseract** | `0.3.13` | **Apache-2.0** | © 2014–2026 Samuel Hoffstaetter |
| **ReportLab** | `5.1.0` | **BSD License (ReportLab)** | © 2000–2026 ReportLab Inc. |
| **Shapely** | `2.2.0` | **BSD-3-Clause** | © 2007–2026 Sean Gillies and contributors |
| **NumPy** | `2.4.6` | **BSD-3-Clause** | © 2005–2026 NumPy Developers |

### Frontend UI Stack (Node.js & React)

| Package | Version | Declared License | Copyright / Maintainer |
| :--- | :--- | :--- | :--- |
| **Electron** | `43.4.1` | **MIT License** | © 2013–2026 GitHub Inc. / OpenJS Foundation |
| **React** | `19.3.1` | **MIT License** | © Meta Platforms, Inc. and affiliates |
| **React DOM** | `19.3.1` | **MIT License** | © Meta Platforms, Inc. and affiliates |
| **Lucide React** | `0.577.0` | **ISC License** | © 2026 Lucide Project Contributors |
| **Vite** | `6.4.3` | **MIT License** | © 2019–2026 Evan You and Vite Contributors |
| **TypeScript** | `5.9.3` | **Apache-2.0** | © Microsoft Corporation |

---

## 4. System Tools and Binaries (External Invocations)

Vellum PDF Pro may interact with the following system-installed binaries when available on the host Linux OS:

- **Tesseract OCR Engine (`tesseract`)**: Licensed under **Apache License 2.0**.
- **LibreOffice Headless (`libreoffice`)**: Licensed under **Mozilla Public License v2.0 (MPL-2.0)**. Invoked out-of-process via standard subprocess CLI calls for DOCX-to-PDF conversion.
- **Ghostscript (`gs`)**: Licensed under **GNU AGPL-3.0**. Optional fallback utility for postscript rasterization and repair. Fully compatible with Vellum PDF Pro's AGPL-3.0 license.

---

## 5. Fonts and Typography

- **DejaVu Fonts (DejaVu Sans, DejaVu Serif)**: Licensed under the **DejaVu Fonts License / Bitstream Vera License**. Freely redistributable and embeddable in PDF documents without copyright fee.
- **Standard Base 14 PDF Fonts (Helvetica, Times-Roman, Courier)**: Metric definitions and core glyph mappings conform to the ISO 32000-1 specification.
