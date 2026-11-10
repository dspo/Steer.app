#!/bin/sh
# Bundles Zu: the app from nsh, the engine sidecar into Contents/Helpers,
# ad-hoc signatures over both, and a dmg.
#
# Usage: script/bundle-mac.sh [out-dir]   (default: build)
#        NSH=/path/to/nsh script/bundle-mac.sh
set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT=${1:-"$ROOT/build"}
NSH=${NSH:-nsh}
APP="$OUT/Zu.app"

cd "$ROOT"

echo "→ engine sidecar"
(cd engine && bun run build)

echo "→ app"
"$NSH" package . --target macos -o "$OUT"

echo "→ sidecar into Contents/Helpers"
mkdir -p "$APP/Contents/Helpers"
cp engine/dist/pi-engine "$APP/Contents/Helpers/"
# pi loads these from beside the executable (photon for images, QuickJS for
# code mode); without them those paths throw at run time.
cp engine/dist/photon_rs_bg.wasm engine/dist/quickjs.wasm "$APP/Contents/Helpers/"

echo "→ ad-hoc signatures (nested: the sidecar, then the app)"
codesign --force --sign - "$APP/Contents/Helpers/pi-engine"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP"

echo "→ dmg"
rm -f "$OUT/Zu.dmg"
hdiutil create -volname Zu -srcfolder "$APP" -ov -format UDZO -quiet "$OUT/Zu.dmg"

echo "✓ $APP"
echo "✓ $OUT/Zu.dmg"
du -sh "$APP" "$OUT/Zu.dmg"
