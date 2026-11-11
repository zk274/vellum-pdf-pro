#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERSION="1.0.0"
APP_NAME="vellum-pdf-pro"
RELEASE_DIR="$ROOT_DIR/release"
BUILD_TMP="$(mktemp -d /tmp/vellum_pkg_XXXXXX)"
trap 'rm -rf "$BUILD_TMP"' EXIT

mkdir -p "$RELEASE_DIR"

echo "[1/6] Building production frontend bundle..."
npm run build

echo "[2/6] Generating application icon..."
"$ROOT_DIR/.venv/bin/python" - <<'PY' "$BUILD_TMP/vellum-pdf-pro.png"
import sys
from PIL import Image, ImageDraw

img = Image.new("RGBA", (256, 256), (15, 23, 42, 255))
draw = ImageDraw.Draw(img)
draw.rounded_rectangle([16, 16, 240, 240], radius=36, fill=(30, 58, 138, 255), outline=(96, 165, 250, 255), width=6)
draw.rounded_rectangle([54, 46, 202, 210], radius=12, fill=(255, 255, 255, 255))
draw.rectangle([74, 76, 182, 94], fill=(37, 99, 235, 255))
draw.rectangle([74, 112, 182, 126], fill=(100, 116, 139, 255))
draw.rectangle([74, 140, 162, 154], fill=(100, 116, 139, 255))
draw.rectangle([74, 168, 142, 182], fill=(220, 38, 38, 255))
img.save(sys.argv[1], format="PNG")
PY

echo "[3/6] Assembling completely self-contained application payload..."
APP_STAGE="$BUILD_TMP/payload"
mkdir -p "$APP_STAGE/electron" "$APP_STAGE/app" "$APP_STAGE/python"

# 1. Electron Runtime
echo " -> Bundling Electron binary and native frameworks..."
cp -r "$ROOT_DIR/node_modules/electron/dist/"* "$APP_STAGE/electron/"

# 2. Vellum Application Code
echo " -> Bundling application code (dist, electron, backend)..."
cp -r "$ROOT_DIR/dist" "$APP_STAGE/app/"
cp -r "$ROOT_DIR/electron" "$APP_STAGE/app/"
cp -r "$ROOT_DIR/backend" "$APP_STAGE/app/"
cp "$ROOT_DIR/package.json" "$APP_STAGE/app/"

# 3. Python 3.11 Runtime & Complete Site-Packages Engine
echo " -> Bundling standalone Python 3.11 runtime..."
cp -r /home/zk/.local/share/uv/python/cpython-3.11.15-linux-x86_64-gnu/* "$APP_STAGE/python/"

echo " -> Bundling all Python dependencies (PyMuPDF, pikepdf, pyHanko, pdf2docx, FastAPI, RapidOCR)..."
mkdir -p "$APP_STAGE/python/lib/python3.11/site-packages"
cp -r "$ROOT_DIR/.venv/lib/python3.11/site-packages/"* "$APP_STAGE/python/lib/python3.11/site-packages/"

# Clean cache files to optimize package size
find "$APP_STAGE" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find "$APP_STAGE" -type f -name "*.pyc" -delete 2>/dev/null || true

# Standalone Launcher Script
cat > "$BUILD_TMP/vellum-launcher.sh" << 'EOF'
#!/usr/bin/env bash
set -e

# Determine installation root
SELF_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
if [ -d "/opt/vellum-pdf-pro/payload" ]; then
  BASE="/opt/vellum-pdf-pro/payload"
elif [ -d "$SELF_DIR/../lib/vellum-pdf-pro" ]; then
  BASE="$SELF_DIR/../lib/vellum-pdf-pro"
elif [ -d "$APPDIR/usr/lib/vellum-pdf-pro" ]; then
  BASE="$APPDIR/usr/lib/vellum-pdf-pro"
elif [ -d "$SELF_DIR/payload" ]; then
  BASE="$SELF_DIR/payload"
else
  BASE="/opt/vellum-pdf-pro/payload"
fi

export VELLUM_PORT="${VELLUM_PORT:-18420}"
export VELLUM_PYTHON="$BASE/python/bin/python3.11"
export PYTHONPATH="$BASE/app:$BASE/python/lib/python3.11/site-packages:${PYTHONPATH:-}"
export ELECTRON_RUN_AS_NODE=""

ELECTRON_BIN="$BASE/electron/electron"
if [ ! -x "$ELECTRON_BIN" ]; then
  ELECTRON_BIN="electron"
fi

exec "$ELECTRON_BIN" --no-sandbox "$BASE/app/electron/main.cjs" "$@"
EOF
chmod +x "$BUILD_TMP/vellum-launcher.sh"

cat > "$BUILD_TMP/vellum-pdf-pro.desktop" <<EOF
[Desktop Entry]
Name=Vellum PDF Pro
Comment=Professional Linux Desktop PDF Editor
Exec=vellum-pdf-pro %f
Icon=vellum-pdf-pro
Terminal=false
Type=Application
Categories=Office;Viewer;Graphics;
MimeType=application/pdf;
StartupNotify=true
EOF

echo "[4/6] Building Debian package (.deb)..."
DEB_ROOT="$BUILD_TMP/deb_root"
mkdir -p "$DEB_ROOT/DEBIAN"
mkdir -p "$DEB_ROOT/opt/vellum-pdf-pro/payload"
mkdir -p "$DEB_ROOT/usr/bin"
mkdir -p "$DEB_ROOT/usr/share/applications"
mkdir -p "$DEB_ROOT/usr/share/icons/hicolor/256x256/apps"

cp -r "$APP_STAGE/"* "$DEB_ROOT/opt/vellum-pdf-pro/payload/"
cp "$BUILD_TMP/vellum-launcher.sh" "$DEB_ROOT/usr/bin/vellum-pdf-pro"
cp "$BUILD_TMP/vellum-pdf-pro.desktop" "$DEB_ROOT/usr/share/applications/vellum-pdf-pro.desktop"
cp "$BUILD_TMP/vellum-pdf-pro.png" "$DEB_ROOT/usr/share/icons/hicolor/256x256/apps/vellum-pdf-pro.png"

INSTALLED_KB=$(du -sk "$DEB_ROOT/opt" | awk '{print $1}')
cat > "$DEB_ROOT/DEBIAN/control" <<EOF
Package: vellum-pdf-pro
Version: ${VERSION}
Section: editors
Priority: optional
Architecture: amd64
Installed-Size: ${INSTALLED_KB}
Maintainer: Vellum PDF Engineering <engineering@vellumpdf.linux>
Depends: libgtk-3-0t64 | libgtk-3-0, libnss3, libasound2t64 | libasound2
Recommends: tesseract-ocr, libreoffice-core
Description: Vellum PDF Pro - Professional Linux Desktop PDF Editor
 Completely self-contained Linux desktop PDF editor. Bundles the Electron
 desktop shell, embedded CPython 3.11 runtime, and high-performance PDF
 processing engines (PyMuPDF, pikepdf, pyHanko, pdf2docx, RapidOCR).
 Requires no external python virtual environments or node package installations.
EOF

DEB_OUT="$RELEASE_DIR/vellum-pdf-pro_${VERSION}_amd64.deb"
dpkg-deb -Zzstd -z1 --root-owner-group --build "$DEB_ROOT" "$DEB_OUT"

echo "[5/6] Building Linux AppImage (.AppImage)..."
APPDIR="$BUILD_TMP/Vellum_PDF_Pro.AppDir"
mkdir -p "$APPDIR/usr/bin"
mkdir -p "$APPDIR/usr/lib/vellum-pdf-pro"
cp -r "$APP_STAGE/"* "$APPDIR/usr/lib/vellum-pdf-pro/"

# AppRun script in AppImage root
cat > "$APPDIR/AppRun" << 'EOF'
#!/usr/bin/env bash
set -e
APPDIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
BASE="$APPDIR/usr/lib/vellum-pdf-pro"

export VELLUM_PORT="${VELLUM_PORT:-18420}"
export VELLUM_PYTHON="$BASE/python/bin/python3.11"
export PYTHONPATH="$BASE/app:$BASE/python/lib/python3.11/site-packages:${PYTHONPATH:-}"
export ELECTRON_RUN_AS_NODE=""

exec "$BASE/electron/electron" --no-sandbox "$BASE/app/electron/main.cjs" "$@"
EOF
chmod +x "$APPDIR/AppRun"
cp "$BUILD_TMP/vellum-pdf-pro.desktop" "$APPDIR/vellum-pdf-pro.desktop"
cp "$BUILD_TMP/vellum-pdf-pro.png" "$APPDIR/vellum-pdf-pro.png"
ln -sf usr/lib/vellum-pdf-pro/app/electron "$APPDIR/electron"

RUNTIME_BIN="/home/zk/.cache/electron-builder/appimage-12.0.1/appimage-12.0.1-qkv17/runtime-x64"
SQUASHFS_IMG="$BUILD_TMP/appdir.squashfs"
mksquashfs "$APPDIR" "$SQUASHFS_IMG" -comp zstd -Xcompression-level 1 -root-owned -noappend -quiet

APPIMAGE_OUT="$RELEASE_DIR/Vellum_PDF_Pro-${VERSION}-x86_64.AppImage"
cat "$RUNTIME_BIN" "$SQUASHFS_IMG" > "$APPIMAGE_OUT"
chmod +x "$APPIMAGE_OUT"

echo "[6/6] Build complete!"
ls -lh "$DEB_OUT" "$APPIMAGE_OUT"
