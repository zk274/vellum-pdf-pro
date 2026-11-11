# Security Policy

The Vellum PDF Pro development team takes security and user privacy seriously.  
Because Vellum PDF Pro parses and modifies complex PDF binary structures, runs optical character recognition, and executes cryptographic signatures, maintaining strict memory safety and offline privacy is paramount.

---

## Supported Versions

| Version | Supported |
| :--- | :--- |
| `1.0.x` | :white_check_mark: |
| `< 1.0.0` | :x: |

---

## Offline Privacy Guarantee

Vellum PDF Pro is designed from the ground up as an **offline-first Linux application**:
- No document data, metadata, or telemetry is ever transmitted over the Internet.
- Cryptographic private keys and passwords remain strictly in local memory and are never cached to unencrypted persistent disks.
- OCR models (`RapidOCR` / `Tesseract`) run completely on the local CPU/GPU.

---

## Reporting a Vulnerability

If you discover a security vulnerability (such as a buffer overflow in PDF parsing, stream injection issue, memory leak, or cryptographic flaw):

1. **Do not open a public GitHub issue**.
2. Report the vulnerability privately via **GitHub Security Advisories** on the repository page.
3. If GitHub Advisories are not accessible, email the core engineering team at `security@vellumpdf.linux` with:
   - Description of the vulnerability.
   - Minimal reproducible test case (e.g. sample PDF file).
   - Expected impact and affected platforms.
4. We acknowledge receipt within 48 hours and aim to provide a remediation patch within 14 business days.

