#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

VERSION="1.0.0"
APP_NAME="vellum-pdf-pro"
RELEASE_DIR="$ROOT_DIR/release"
BUILD_TMP="$(mktemp -d /tmp/vellum_pkg_XXXXXX)"
trap 'rm -rf "$BUILD_TMP"' EXIT

echo "[1/5] Building production frontend bundle..."
npm run build

mkdir -p "$RELEASE_DIR"

echo "[2/5] Generating application icon..."
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

echo "[3/5] Assembling application tree..."
APP_STAGE="$BUILD_TMP/app_payload"
mkdir -p "$APP_STAGE"
cp -r "$ROOT_DIR/dist" "$APP_STAGE/"
cp -r "$ROOT_DIR/electron" "$APP_STAGE/"
cp -r "$ROOT_DIR/backend" "$APP_STAGE/"
cp "$ROOT_DIR/package.json" "$APP_STAGE/"

# Create launcher script that invokes Electron + local Python engine
cat > "$BUILD_TMP/vellum-launcher.sh" <<EOF
#!/usr/bin/env bash
set -e
SOURCE_ROOT="${ROOT_DIR}"
PAYLOAD_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
if [ -d "/opt/vellum-pdf-pro/payload" ]; then
  APP_DIR="/opt/vellum-pdf-pro/payload"
elif [ -d "\$PAYLOAD_DIR/usr/lib/vellum-pdf-pro" ]; then
  APP_DIR="\$PAYLOAD_DIR/usr/lib/vellum-pdf-pro"
else
  APP_DIR="\$SOURCE_ROOT"
fi
export VELLUM_PORT="\${VELLUM_PORT:-18420}"
export PYTHONPATH="\$APP_DIR:\${PYTHONPATH:-}"
if [ -x "$ROOT_DIR/node_modules/electron/dist/electron" ]; then
  exec "$ROOT_DIR/node_modules/electron/dist/electron" --no-sandbox "\$APP_DIR/electron/main.cjs" "\$@"
else
  exec electron --no-sandbox "\$APP_DIR/electron/main.cjs" "\$@"
fi
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

echo "[4/5] Building Debian package (.deb)..."
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
Depends: python3 (>= 3.11), libgtk-3-0t64 | libgtk-3-0, libnss3, libasound2t64 | libasound2
Description: Vellum PDF Pro - Professional Linux Desktop PDF Editor
 Full-featured offline Linux PDF editor supporting direct content stream
 text and image editing, page organization, annotations, interactive
 AcroForms, X.509 PKCS#12 cryptographic digital signatures, offline neural
 OCR, permanent content redaction, PDF/A-2b archival, and document comparison.
EOF

DEB_OUT="$RELEASE_DIR/vellum-pdf-pro_${VERSION}_amd64.deb"
dpkg-deb --root-owner-group --build "$DEB_ROOT" "$DEB_OUT"

echo "[5/5] Building Linux AppImage (.AppImage)..."
APPDIR="$BUILD_TMP/Vellum_PDF_Pro.AppDir"
mkdir -p "$APPDIR/usr/bin"
mkdir -p "$APPDIR/usr/lib/vellum-pdf-pro"
cp -r "$APP_STAGE/"* "$APPDIR/usr/lib/vellum-pdf-pro/"
cp "$BUILD_TMP/vellum-launcher.sh" "$APPDIR/AppRun"
chmod +x "$APPDIR/AppRun"
cp "$BUILD_TMP/vellum-pdf-pro.desktop" "$APPDIR/vellum-pdf-pro.desktop"
cp "$BUILD_TMP/vellum-pdf-pro.png" "$APPDIR/vellum-pdf-pro.png"

RUNTIME_BIN="/home/zk/.cache/electron-builder/appimage-12.0.1/appimage-12.0.1-qkv17/runtime-x64"
SQUASHFS_IMG="$BUILD_TMP/appdir.squashfs"
mksquashfs "$APPDIR" "$SQUASHFS_IMG" -root-owned -noappend -quiet -comp gzip

APPIMAGE_OUT="$RELEASE_DIR/Vellum_PDF_Pro-${VERSION}-x86_64.AppImage"
cat "$RUNTIME_BIN" "$SQUASHFS_IMG" > "$APPIMAGE_OUT"
chmod +x "$APPIMAGE_OUT"

echo "Build complete:"
ls -lh "$DEB_OUT" "$APPIMAGE_OUT"

