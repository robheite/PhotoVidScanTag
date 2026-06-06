#!/usr/bin/env bash
set -euo pipefail

UNSIGNED=0
if [[ "${1:-}" == "--unsigned" ]]; then
  UNSIGNED=1
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This macOS build helper must be run on a Mac."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "xcodebuild was not found. Install Xcode and the command line tools first."
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo was not found. Install the Rust toolchain first."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Install Node.js first."
  exit 1
fi

echo "Preparing MediaTagger macOS build..."
rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null 2>&1 || true

if [[ ! -d node_modules ]]; then
  echo "Installing frontend dependencies..."
  npm install
else
  echo "Refreshing frontend dependencies..."
  npm install
fi

if [[ "$UNSIGNED" -eq 1 ]]; then
  echo "Running unsigned macOS app-bundle build..."
  npm run tauri build -- --bundles app
else
  echo "Running macOS build using any signing/notarization environment already configured..."
  npm run tauri build
fi

echo
echo "Build complete."
echo "Bundle output:"
find src-tauri/target/release/bundle -maxdepth 3 \( -name '*.app' -o -name '*.dmg' -o -name '*.app.tar.gz' -o -name '*.zip' \) -print || true
echo
if [[ "$UNSIGNED" -eq 1 ]]; then
  echo "Unsigned test builds intentionally ship the .app bundle only."
  echo "DMG packaging is reserved for signed/notarized release-oriented builds."
  echo
fi
echo "If this is an unsigned first-run build on macOS, you may need:"
echo "  xattr -dr com.apple.quarantine <path-to-app-or-dmg>"
echo "and then launch the app with Finder Open, or from Terminal:"
echo "  open <path-to-app>"
