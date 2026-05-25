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

echo "Preparing MediaTagger macOS build..."
rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null 2>&1 || true
npm install

if [[ "$UNSIGNED" -eq 1 ]]; then
  echo "Running unsigned macOS build..."
  npm run tauri build
else
  echo "Running macOS build using any signing/notarization environment already configured..."
  npm run tauri build
fi

echo
echo "Build complete. Check src-tauri/target/release/bundle for .app/.dmg outputs."
