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

echo "[2/6] Detecting Python runtime environment and generating application icon..."
if [ -x "$ROOT_DIR/.venv/bin/python" ]; then
  PYTHON_EXEC="$ROOT_DIR/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
  PYTHON_EXEC="$(command -v python3)"
else
  PYTHON_EXEC="python"
fi
echo "Using Python executable: $PYTHON_EXEC"

"$PYTHON_EXEC" - <<'PY' "$BUILD_TMP/vellum-pdf-pro.png"
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
if [ ! -d "$ROOT_DIR/node_modules/electron/dist" ] || [ -z "$(ls -A "$ROOT_DIR/node_modules/electron/dist" 2>/dev/null)" ]; then
  echo "    Electron binary not found in node_modules/electron/dist, running install script..."
  node "$ROOT_DIR/node_modules/electron/install.js"
fi
cp -r "$ROOT_DIR/node_modules/electron/dist/"* "$APP_STAGE/electron/"

# 2. Vellum Application Code
echo " -> Bundling application code (dist, electron, backend)..."
cp -r "$ROOT_DIR/dist" "$APP_STAGE/app/"
cp -r "$ROOT_DIR/electron" "$APP_STAGE/app/"
cp -r "$ROOT_DIR/backend" "$APP_STAGE/app/"
cp "$ROOT_DIR/package.json" "$APP_STAGE/app/"

# 3. Python 3.11 Runtime & Complete Site-Packages Engine
PYTHON_BASE_PREFIX="$("$PYTHON_EXEC" -c "import sys; print(sys.base_prefix)")"
PYTHON_PURELIB="$("$PYTHON_EXEC" -c "import sysconfig; print(sysconfig.get_path('purelib'))")"

echo " -> Bundling standalone Python runtime from $PYTHON_BASE_PREFIX..."
cp -r "$PYTHON_BASE_PREFIX"/* "$APP_STAGE/python/"

echo " -> Bundling all Python dependencies from $PYTHON_PURELIB..."
mkdir -p "$APP_STAGE/python/lib/python3.11/site-packages"
cp -r "$PYTHON_PURELIB"/* "$APP_STAGE/python/lib/python3.11/site-packages/"

if [ ! -f "$APP_STAGE/python/bin/python3.11" ]; then
  if [ -f "$APP_STAGE/python/bin/python3" ]; then
    ln -sf python3 "$APP_STAGE/python/bin/python3.11"
  elif [ -f "$APP_STAGE/python/bin/python" ]; then
    ln -sf python "$APP_STAGE/python/bin/python3.11"
  fi
fi

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
export LD_LIBRARY_PATH="$BASE/python/lib:${LD_LIBRARY_PATH:-}"
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

cp -al "$APP_STAGE/"* "$DEB_ROOT/opt/vellum-pdf-pro/payload/"
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
rm -rf "$DEB_ROOT"

echo "[5/6] Building Linux AppImage (.AppImage)..."
APPDIR="$BUILD_TMP/Vellum_PDF_Pro.AppDir"
mkdir -p "$APPDIR/usr/bin"
mkdir -p "$APPDIR/usr/lib/vellum-pdf-pro"
cp -al "$APP_STAGE/"* "$APPDIR/usr/lib/vellum-pdf-pro/"

# AppRun script in AppImage root
cat > "$APPDIR/AppRun" << 'EOF'
#!/usr/bin/env bash
set -e
APPDIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
BASE="$APPDIR/usr/lib/vellum-pdf-pro"

export VELLUM_PORT="${VELLUM_PORT:-18420}"
export VELLUM_PYTHON="$BASE/python/bin/python3.11"
export PYTHONPATH="$BASE/app:$BASE/python/lib/python3.11/site-packages:${PYTHONPATH:-}"
export LD_LIBRARY_PATH="$BASE/python/lib:${LD_LIBRARY_PATH:-}"
export ELECTRON_RUN_AS_NODE=""

exec "$BASE/electron/electron" --no-sandbox "$BASE/app/electron/main.cjs" "$@"
EOF
chmod +x "$APPDIR/AppRun"
cp "$BUILD_TMP/vellum-pdf-pro.desktop" "$APPDIR/vellum-pdf-pro.desktop"
cp "$BUILD_TMP/vellum-pdf-pro.png" "$APPDIR/vellum-pdf-pro.png"
ln -sf usr/lib/vellum-pdf-pro/app/electron "$APPDIR/electron"

RUNTIME_BIN=""
for candidate in \
  "$HOME/.cache/electron-builder/appimage-12.0.1/appimage-12.0.1-qkv17/runtime-x64" \
  "$HOME/.cache/electron-builder/appimage/appimage-12.0.1/runtime-x64" \
  /home/*/.cache/electron-builder/appimage*/runtime-x64 \
  /home/*/.cache/electron-builder/appimage*/*/runtime-x64; do
  if [ -f "$candidate" ]; then
    RUNTIME_BIN="$candidate"
    break
  fi
done

if [ -z "$RUNTIME_BIN" ]; then
  CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/electron-builder/appimage-12.0.1"
  mkdir -p "$CACHE_DIR"
  RUNTIME_BIN="$CACHE_DIR/runtime-x64"
  if [ ! -f "$RUNTIME_BIN" ]; then
    echo " -> Downloading AppImage runtime (Type-2)..."
    curl -fsSL -o "$RUNTIME_BIN" "https://github.com/AppImage/AppImageKit/releases/download/continuous/runtime-x86_64"
    chmod +x "$RUNTIME_BIN"
  fi
fi

SQUASHFS_IMG="$BUILD_TMP/appdir.squashfs"
mksquashfs "$APPDIR" "$SQUASHFS_IMG" -comp gzip -root-owned -noappend -quiet

APPIMAGE_OUT="$RELEASE_DIR/Vellum_PDF_Pro-${VERSION}-x86_64.AppImage"
rm -f "$APPIMAGE_OUT"
cat "$RUNTIME_BIN" "$SQUASHFS_IMG" > "$APPIMAGE_OUT"
chmod +x "$APPIMAGE_OUT"
rm -rf "$APPDIR" "$SQUASHFS_IMG"

echo " -> Generating SHA-256 checksums..."
cd "$RELEASE_DIR"
sha256sum "vellum-pdf-pro_${VERSION}_amd64.deb" "Vellum_PDF_Pro-${VERSION}-x86_64.AppImage" > SHA256SUMS
cd "$ROOT_DIR"

echo "[6/6] Build complete!"
ls -lh "$DEB_OUT" "$APPIMAGE_OUT" "$RELEASE_DIR/SHA256SUMS"
cat "$RELEASE_DIR/SHA256SUMS"
