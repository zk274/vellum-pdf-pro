# Vellum PDF Pro — Default Text Box Appearance Report

## Summary

New PDF text boxes created in **Edit PDF → + Add Text Box** previously risked inheriting selection/overlay styling or non-standard defaults. Vellum PDF Pro now enforces clean, document-ready defaults and user-configurable persistent preferences across both Dark and Light themes.

---

## 1. Factory Defaults (`src/App.tsx`)

`FACTORY_TEXTBOX_DEFAULTS` is defined and applied whenever creating a new text box (`draftTextBox`) unless overridden by saved user preferences:

- **Text Color**: `#000000` (pure black)
- **Font Family**: `helv` (Helvetica / Sans)
- **Font Size**: `11` pt
- **Text Alignment**: `left`
- **Background Fill**: `transparent` (Transparent / None)
- **Border Color**: `transparent` (No Border)

Selection frames (`.inline-textbox-overlay`, `.text-edit-box`) are rendered purely in the React overlay layer and never bleed blue borders, blue text colors, or tinted backgrounds into committed PDF content streams.

---

## 2. Persistent Preferences & Inspector Controls

- **Storage Key**: `vellum.textbox.defaults.v1` in `localStorage`.
- **Inspector Controls** (under **New Text Box Properties** when placing/editing a draft text box):
  - **Background** selector (`Transparent (None)`, `White (#ffffff)`, `Soft Yellow (#fef9c3)`, `Light Slate (#f1f5f9)`).
  - **Border** selector (`No Border`, `Black (#000000)`, `Slate (#475569)`, `Blue (#2563eb)`).
  - **Save as Default** button (`saveTextBoxDefaults`) persists the current font, size, color, alignment, background, and border to `localStorage`.
  - **Reset Defaults** button (`resetTextBoxDefaults`) restores `FACTORY_TEXTBOX_DEFAULTS` and clears custom overrides.

---

## 3. Verification

- **Unit/API Persistence**: `tests/test_forms_and_textbox_defaults.py::test_textbox_default_appearance_black_helvetica_11pt` verifies that adding a text box with default parameters writes `#000000` black fill (`0.0 0.0 0.0 rg`), Helvetica (`Helv`), `11 pt`, with no blue text or border injected into the PDF content stream.
- **Electron GUI & Theme Verification**: `scripts/verify_forms_and_textbox_defaults_gui.cjs` clears `vellum.textbox.defaults.v1`, creates a new blank PDF, drags a new text box, verifies `rgb(0, 0, 0)` computed text color, `#000000` inspector color input, and `11` pt size, and captures:
  - `docs/screenshots/textbox-defaults-dark.png` (Dark theme)
  - `docs/screenshots/textbox-defaults-light.png` (Light theme)

