# Vellum PDF Pro — Official Branding Kit v2 Integration Report

**Date:** November 11, 2026  
**Release Target:** v1.0.0-beta.2 / Post-Beta Desktop Polish  
**Status:** Completed & Fully Verified  

---

## 1. Executive Summary

The official **Vellum PDF Pro Branding Kit v2** (`/home/zk/workspace/pdfedit/Vellum_PDF_Pro_Branding_Kit_v2/`) has been integrated across the entire application stack, including:
- Desktop window chrome and frameless header badge
- Interactive About dialog
- Electron `BrowserWindow` window icon (Ubuntu dock, task switcher, window manager)
- Linux packaging (Debian `.deb` and standalone `.AppImage`)
- FreeDesktop `/usr/share/icons/hicolor` standard hierarchy
- Web application runtime favicons
- Repository documentation and GitHub README responsive branding

The approved **lighter cobalt-navy icon background gradient** (`#285C97` → `#19477F`) from Branding Kit v2 has been strictly preserved. It delivers superior contrast for the dark-blue geometric "V" emblem across both light and dark desktop themes.

---

## 2. Branding Kit Assets Inspection

The source directory `/home/zk/workspace/pdfedit/Vellum_PDF_Pro_Branding_Kit_v2/` was thoroughly inspected:
- **`README.md`**: Approved branding specifications, geometry rules, color palettes, and component sizing guidelines.
- **`vellum-app-icon.svg`**: Master 1024×1024 vector application icon with rounded squircle geometry and the approved lighter cobalt-navy gradient background.
- **`vellum-mark.svg`**: Standalone vector "V" mark with transparent background and crisp dual-fold geometry.
- **`vellum-wordmark-dark.svg`**: Horizontal wordmark optimized for dark backgrounds (white text with blue accent).
- **`vellum-wordmark-light.svg`**: Horizontal wordmark optimized for light backgrounds (dark slate text with blue accent).
- **`vellum-header-dark.svg` & `vellum-header-light.svg`**: Compact horizontal lockups combining the V mark and title for application headers.
- **`raster/`**: High-resolution raster PNG exports at standard resolutions (16px to 1024px) and multi-resolution `vellum.ico`.

Per requirements, the original `/home/zk/workspace/pdfedit/Vellum_PDF_Pro_Branding_Kit_v2/` directory is preserved intact in the workspace as the permanent upstream design reference.

---

## 3. Canonical Production Asset Pipeline

To maintain clean repository hygiene without redundant scattered files, production assets were organized into canonical project directories:

```
resources/
├── branding/
│   ├── vellum-app-icon.svg       # Master vector icon (lighter cobalt background)
│   ├── vellum-app-icon.png       # 1024x1024 master raster
│   ├── vellum-mark.svg           # Standalone V mark (transparent background)
│   ├── vellum-mark.png           # 512x512 raster mark
│   ├── vellum-wordmark-dark.svg  # Dark theme wordmark (GitHub / Docs)
│   ├── vellum-wordmark-dark.png  # 1200x300 raster
│   ├── vellum-wordmark-light.svg # Light theme wordmark (GitHub / Docs)
│   ├── vellum-wordmark-light.png # 1200x300 raster
│   ├── vellum-header-dark.svg    # Dark header lockup
│   ├── vellum-header-light.svg   # Light header lockup
│   └── vellum-header-dark.png / vellum-header-light.png
└── icons/
    ├── vellum-16.png             # 16x16 standard PNG
    ├── vellum-24.png             # 24x24 standard PNG
    ├── vellum-32.png             # 32x32 standard PNG
    ├── vellum-48.png             # 48x48 standard PNG
    ├── vellum-64.png             # 64x64 standard PNG
    ├── vellum-128.png            # 128x128 standard PNG
    ├── vellum-256.png            # 256x256 standard PNG (primary Electron icon)
    ├── vellum-512.png            # 512x512 standard PNG
    ├── vellum-1024.png           # 1024x1024 standard PNG
    └── vellum.ico                # Multi-resolution Windows/Wine ICO (16-256)
```

### Deterministic Icon Generator (`scripts/generate_branding_assets.py`)
A standalone Python generation script was created to deterministically rasterize `resources/branding/vellum-app-icon.svg` into all 9 standard pixel sizes using Inkscape CLI vector rendering (with PIL fallback), guaranteeing crisp pixel-aligned edges at small sizes (16px, 24px, 32px) and maximum quality at high sizes (512px, 1024px).

---

## 4. Application Integration Details

### 4.1 Frameless Header Brand Badge
- **File:** `src/App.tsx`
- **Component:** `VellumMarkIcon` (crisp inline SVG component rendering the official dual-fold V mark).
- **Placement:** Positioned in the `.brand-badge` button at the far left of the frameless desktop header row.
- **Dimensions:** Sized at `18×18 px`, preserving critical horizontal space for the File/Edit/View menus, document title, search bar, and window controls.
- **Interactivity:** Clicking the brand badge opens the official About modal. Hover effects and tooltips (`About Vellum PDF Pro`) are fully preserved.

### 4.2 Interactive About Modal & Bundled Asset Handling
- **File:** `src/App.tsx`, `src/assets/branding/vellum-app-icon.png`
- **Asset Resolution Fix:** Resolved broken image symbol by converting the previous root-relative path (`/branding/vellum-app-icon.png`, which failed under `file://` protocol in packaged Electron) into a Vite-bundled module import (`import vellumAppIcon from './assets/branding/vellum-app-icon.png'`). In production, Vite bundles the asset to `./assets/vellum-app-icon-[hash].png` via `new URL(..., import.meta.url).href`, ensuring reliable relative loading across development, Electron unpackaged, `.deb` installation, and AppImage Squashfs mount points.
- **Visuals & Styling:** Displays the approved 64×64 pixel rounded squircle tile icon with the lighter cobalt-navy gradient (`#285C97` → `#19477F`). Replaced rectangular bounding `boxShadow` with alpha-aware CSS `filter: drop-shadow(0 4px 8px rgba(0,0,0,0.25))` and `objectFit: 'contain'`, properly preserving the icon squircle's corner transparency without rectangular box-shadow clipping.
- **Verification:** Verified via Chrome DevTools Protocol (CDP) in live packaged Electron run: `complete: true`, `naturalWidth: 1024`, `naturalHeight: 1024`, `width: 64`, `height: 64`.
- **Metadata Displayed:**
  - Official Application Name: **Vellum PDF Pro**
  - Subtitle: *Professional Offline Linux Desktop PDF Editor*
  - Version: `v1.0.0-beta.2` (Production Desktop Build)
  - License: **GNU Affero General Public License v3.0 (GNU AGPL-3.0)**
  - Core Technology Stack: PyMuPDF 1.25.3, pikepdf, pyHanko, RapidOCR, Electron 43.4.1, React 19, TypeScript
  - Active GitHub Repository URL: `https://github.com/zk274/vellum-pdf-pro`
  - Direct Action Buttons: "View on GitHub", "Keyboard Shortcuts", "Close"

### 4.3 Electron Native Window & System Chrome
- **File:** `electron/main.cjs`
- **Configuration:** Updated `BrowserWindow` constructor to dynamically locate and set `icon: appIconPath` using `resources/icons/vellum-256.png` with fallbacks, followed by `mainWindow.setIcon(appIconPath)`. Configured `app.setName('vellum-pdf-pro')` to align with the desktop entry `StartupWMClass`.
- **Desktop Behavior:**
  - In Ubuntu GNOME (Wayland and X11), assigns the official icon to the running window, Ubuntu dock, task-switcher (Alt+Tab), and application titlebar previews.

### 4.4 Web Favicon & HTML Metadata
- **Files:** `index.html`, `public/favicon.png`, `public/favicon.ico`, `public/branding/*`
- Configured HTML link tags:
  ```html
  <link rel="icon" type="image/svg+xml" href="/branding/vellum-mark.svg" />
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon.png" />
  <link rel="shortcut icon" href="/favicon.ico" />
  ```

### 4.5 GitHub README Documentation
- **File:** `README.md`
- Added responsive `<picture>` banner supporting automatic GitHub dark/light mode switching:
  - Dark mode: `resources/branding/vellum-wordmark-dark.svg`
  - Light mode: `resources/branding/vellum-wordmark-light.svg`

---

## 5. Linux Packaging & FreeDesktop Integration

Both Linux distribution packages were updated in `scripts/build_packages.sh`:

### 5.1 Debian Package (`.deb`)
1. **FreeDesktop Hicolor Hierarchy:** Installed raster PNG icons across all standard sizes:
   - `/usr/share/icons/hicolor/16x16/apps/vellum-pdf-pro.png`
   - `/usr/share/icons/hicolor/24x24/apps/vellum-pdf-pro.png`
   - `/usr/share/icons/hicolor/32x32/apps/vellum-pdf-pro.png`
   - `/usr/share/icons/hicolor/48x48/apps/vellum-pdf-pro.png`
   - `/usr/share/icons/hicolor/64x64/apps/vellum-pdf-pro.png`
   - `/usr/share/icons/hicolor/128x128/apps/vellum-pdf-pro.png`
   - `/usr/share/icons/hicolor/256x256/apps/vellum-pdf-pro.png`
   - `/usr/share/icons/hicolor/512x512/apps/vellum-pdf-pro.png`
2. **Scalable Vector Icon:**
   - `/usr/share/icons/hicolor/scalable/apps/vellum-pdf-pro.svg`
3. **Legacy Pixmaps Fallback:**
   - `/usr/share/pixmaps/vellum-pdf-pro.png` (256×256)
4. **Desktop Entry:**
   - `/usr/share/applications/vellum-pdf-pro.desktop` configured with `Icon=vellum-pdf-pro` and `StartupWMClass=vellum-pdf-pro`.
5. **Debian Maintainer Scripts (`DEBIAN/postinst` & `DEBIAN/postrm`):**
   - Automatically executes `gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor` and `update-desktop-database -q /usr/share/applications` on package install and remove, ensuring Ubuntu desktop immediately reflects the new cobalt-navy launcher icon without stale caching.

### 5.2 AppImage Package
1. **Root Assets:**
   - `vellum-pdf-pro.png` (512×512 icon at root)
   - `.DirIcon` (symlink / copy of 256×256 icon for AppImage desktop integration)
   - `vellum-pdf-pro.svg` (scalable vector icon at root)
2. **AppDir Hicolor Tree:**
   - `$APPDIR/usr/share/icons/hicolor/<size>x<size>/apps/vellum-pdf-pro.png` (16px to 512px)
   - `$APPDIR/usr/share/icons/hicolor/scalable/apps/vellum-pdf-pro.svg`
3. **Desktop Entry:**
   - `$APPDIR/vellum-pdf-pro.desktop` configured with `Icon=vellum-pdf-pro` and `StartupWMClass=vellum-pdf-pro`.

---

## 6. Verification & Test Results

### 6.1 Contrast & Visual Verification
- **Dark Theme:** Tested against background `#0f172a` (Slate 900) and `#1e293b` (Slate 800). The cobalt-navy background `#285C97` / `#19477F` provides clear contrast with adjacent dark slate elements while the dark-blue V remains sharp and distinct.
- **Light Theme:** Tested against background `#ffffff` and `#f1f5f9` (Slate 100). The icon tile creates a well-defined boundary with clear visibility.
- **Header Spacing:** The 18×18 px mark badge occupies no more space than the previous placeholder icon, leaving ample room for all seven top-level menus and window controls.
- **About Modal Logo Rendering:** Verified via automated CDP inspection in packaged Electron: `complete: true`, `naturalWidth: 1024`, `naturalHeight: 1024`, `rendered: 64x64`, `currentSrc: file:///.../dist/assets/vellum-app-icon-D7cVUfgL.png`. The logo renders with the approved cobalt-navy gradient, precise squircle geometry, and alpha-blended drop shadow.

### 6.2 Screenshots Captured
The following visual captures document the branded interface:
1. `docs/screenshots/branded-header-dark.png`: Dark mode frameless header displaying the official Vellum mark badge and menus.
2. `docs/screenshots/branded-header-light.png`: Light mode frameless header with dark-slate text and branded mark badge.
3. `docs/screenshots/branded-about-modal-dark.png`: Dark mode About modal featuring the verified 64×64 squircle tile icon, official typography, version, license, and engine details.
4. `docs/screenshots/branded-about-modal-light.png`: Light mode About modal showing high-contrast rendering.

### 6.3 Automated Test Suite
The full regression suite passed with zero failures:
```
tests/test_backend_startup_lifecycle.py::test_health_endpoints_and_caching PASSED
tests/test_backend_startup_lifecycle.py::test_custom_port_and_cli_flag PASSED
tests/test_backend_startup_lifecycle.py::test_multi_instance_backend_isolation PASSED
tests/test_backend_startup_lifecycle.py::test_packaged_runtime_path_resolution PASSED
tests/test_backend_startup_lifecycle.py::test_clean_process_shutdown PASSED
tests/test_pdf_engine_and_api.py (15 tests) PASSED
======================= 20 passed, 2 warnings in 28.63s ========================
```

### 6.4 Built Packages & Checksums
- `release/vellum-pdf-pro_1.0.0_amd64.deb`: `d1aa4ca7f37ea2eb074ab9ff16ad18c919d4f9010a722276d9f9e95b122f1b75`
- `release/Vellum_PDF_Pro-1.0.0-x86_64.AppImage`: `62432bcc6d34f304e94c483d60536a1be37543da9c6863b15057290ad620bd11`

---

## 7. Conclusion & Release Readiness

All branding integration goals have been met:
- Official Branding Kit v2 assets are active in development and packaging pipelines.
- No application features or PDF editing capabilities were modified.
- Original branding kit is preserved intact in the workspace root.
- The application is ready for testing and packaging.

