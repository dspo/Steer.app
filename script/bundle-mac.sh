#!/bin/sh
# Bundles Zu: the app from nsh, the pi harness into Contents/Helpers,
# ad-hoc signatures over both, and a dmg.
#
# Usage: script/bundle-mac.sh [options] [out-dir]   (out-dir default: build)
#   -i    install Zu.app to /Applications once the bundle is complete
#   -o    open Zu.app once the bundle is complete (the /Applications copy
#         when combined with -i)
#   -h    show this help
#        NSH=/path/to/nsh script/bundle-mac.sh
set -eu

usage() {
  echo "Usage: script/bundle-mac.sh [-i] [-o] [out-dir]"
  echo "  -i    install Zu.app to /Applications once the bundle is complete"
  echo "  -o    open Zu.app once the bundle is complete (the /Applications copy with -i)"
  echo "  -h    show this help"
  echo "  NSH=/path/to/nsh overrides the nsh binary (default: nsh)"
}

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/build"
INSTALL_RESULT=false
OPEN_RESULT=false
while [ $# -gt 0 ]; do
  case "$1" in
    -i) INSTALL_RESULT=true ;;
    -o) OPEN_RESULT=true ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "error: unknown option '$1'" >&2; usage >&2; exit 1 ;;
    *) OUT=$1 ;;
  esac
  shift
done
NSH=${NSH:-nsh}
APP="$OUT/Zu.app"

cd "$ROOT"

echo "→ pi harness sidecar"
(cd pi-harness && bun run build)

echo "→ app"
(cd app && "$NSH" package --target macos -o "$OUT")

echo "→ sidecar into Contents/Helpers"
mkdir -p "$APP/Contents/Helpers"
cp pi-harness/dist/pi-acp "$APP/Contents/Helpers/"
# pi loads these from beside the executable (photon for images, QuickJS for
# code mode); without them those paths throw at run time.
cp pi-harness/dist/photon_rs_bg.wasm pi-harness/dist/quickjs.wasm "$APP/Contents/Helpers/"

# The harness and its WASM are part of the app, not an optional add-on: a
# self-update replaces the whole .app, so an update archive that leaves
# Contents/Helpers out ships an app whose conversations cannot start. Fail
# the bundle here rather than shipping that.
for file in pi-acp photon_rs_bg.wasm quickjs.wasm; do
  if [ ! -f "$APP/Contents/Helpers/$file" ]; then
    echo "error: Contents/Helpers/$file is missing; the app cannot start a conversation" >&2
    exit 1
  fi
done
echo "✓ Contents/Helpers carries the pi harness and its WASM"

echo "→ ad-hoc signatures (nested: the sidecar, then the app)"
codesign --force --sign - "$APP/Contents/Helpers/pi-acp"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

echo "→ dmg"
rm -f "$OUT/Zu.dmg"
hdiutil create -volname Zu -srcfolder "$APP" -ov -format UDZO -quiet "$OUT/Zu.dmg"

# An update archive is the whole app: `nsh/updater` replaces it, so the
# archive must carry Contents/Helpers too. `nsh package` only writes one
# when nsh.json has an "updater" source, and this repository has none yet;
# opt in here when the release configuration exists.
if [ "${NSH_UPDATE_ARCHIVE:-0}" = "1" ]; then
  VERSION=$(plutil -extract CFBundleShortVersionString raw "$APP/Contents/Info.plist" 2>/dev/null || echo "0.0.0")
  case "$(uname -m)" in
    arm64) ARCH=aarch64 ;;
    *) ARCH=$(uname -m) ;;
  esac
  ARCHIVE="$OUT/Zu-$VERSION-macos-$ARCH.tar.gz"
  echo "→ update archive (includes Contents/Helpers)"
  rm -f "$ARCHIVE"
  tar -czf "$ARCHIVE" -C "$OUT" Zu.app
  echo "  $ARCHIVE"
  echo "  release: nsh update-manifest "$ARCHIVE" --notes CHANGES.md --key keys/update.secret"
else
  echo "  (set NSH_UPDATE_ARCHIVE=1 to write the whole-app archive an update needs)"
fi

# Install and open come after every bundle step, so /Applications gets
# exactly the signed bundle the dmg was built from — never a half-built copy.
if [ "$INSTALL_RESULT" = true ]; then
  INSTALL_DEST="/Applications/Zu.app"
  echo "→ install $INSTALL_DEST"
  rm -rf "$INSTALL_DEST"
  cp -R "$APP" "$INSTALL_DEST"
  echo "✓ installed $INSTALL_DEST"
  APP="$INSTALL_DEST"
fi

if [ "$OPEN_RESULT" = true ]; then
  echo "→ open $APP"
  open "$APP"
fi

echo "✓ $APP"
echo "✓ $OUT/Zu.dmg"
du -sh "$APP" "$OUT/Zu.dmg"
