#!/usr/bin/env bash
set -euo pipefail

OPEN_AFTER_INSTALL=0
SKIP_BUILD=0

for arg in "$@"; do
  case "$arg" in
    --open)
      OPEN_AFTER_INSTALL=1
      ;;
    --skip-build)
      SKIP_BUILD=1
      ;;
    *)
      echo "Unknown option: $arg"
      echo "Usage: tools/install-macos-local.sh [--open] [--skip-build]"
      exit 1
      ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This local installer must be run on macOS."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="MediaTagger.app"
BUILT_APP="$ROOT_DIR/src-tauri/target/release/bundle/macos/$APP_NAME"
INSTALL_APP="/Applications/$APP_NAME"

cd "$ROOT_DIR"

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  echo "Building unsigned macOS app bundle..."
  bash tools/tauri-build-macos.sh --unsigned
fi

if [[ ! -d "$BUILT_APP" ]]; then
  echo "Built app bundle was not found: $BUILT_APP"
  exit 1
fi

echo "Installing $APP_NAME to /Applications..."
/usr/bin/ditto "$BUILT_APP" "$INSTALL_APP"

echo "Removing copied Finder and quarantine metadata..."
/usr/bin/xattr -cr "$INSTALL_APP"

echo "Applying ad-hoc local signature..."
/usr/bin/codesign --force --deep --sign - "$INSTALL_APP"

echo "Verifying installed app..."
/usr/bin/codesign --verify --deep --strict --verbose=2 "$INSTALL_APP"

VERSION="$(/usr/bin/plutil -extract CFBundleShortVersionString raw "$INSTALL_APP/Contents/Info.plist")"
echo "Installed $APP_NAME version $VERSION at $INSTALL_APP"

if [[ "$OPEN_AFTER_INSTALL" -eq 1 ]]; then
  echo "Opening installed app..."
  /usr/bin/open "$INSTALL_APP"
fi
