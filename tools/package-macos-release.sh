#!/usr/bin/env bash
set -euo pipefail

SKIP_BUILD=0
if [[ "${1:-}" == "--skip-build" ]]; then
  SKIP_BUILD=1
elif [[ -n "${1:-}" ]]; then
  echo "Usage: tools/package-macos-release.sh [--skip-build]"
  exit 1
fi

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "The macOS release package must be created on a Mac."
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILT_APP="$ROOT_DIR/src-tauri/target/release/bundle/macos/MediaTagger.app"
VERSION="$(node -p "require('$ROOT_DIR/package.json').version")"
PACKAGE_NAME="MediaTagger-macOS-v$VERSION"
RELEASE_DIR="$ROOT_DIR/release"
STAGING_DIR="$RELEASE_DIR/$PACKAGE_NAME"
ARCHIVE_PATH="$RELEASE_DIR/$PACKAGE_NAME.zip"

cd "$ROOT_DIR"
npm run version:check

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  npm run tauri:build:macos:unsigned
fi

if [[ ! -d "$BUILT_APP" ]]; then
  echo "Built app bundle was not found: $BUILT_APP"
  exit 1
fi

rm -rf "$STAGING_DIR"
rm -f "$ARCHIVE_PATH"
mkdir -p "$STAGING_DIR"
/usr/bin/ditto "$BUILT_APP" "$STAGING_DIR/MediaTagger.app"
/usr/bin/ditto "$ROOT_DIR/tools/install-downloaded-macos.command" "$STAGING_DIR/Install MediaTagger.command"
/bin/chmod +x "$STAGING_DIR/Install MediaTagger.command"

cat > "$STAGING_DIR/README.txt" <<EOF
MediaTagger $VERSION for macOS

1. Keep MediaTagger.app and Install MediaTagger.command together.
2. Right-click Install MediaTagger.command and choose Open.
3. Approve an administrator password only if macOS requires it to write to Applications.

The installer copies the app to /Applications, clears downloaded quarantine metadata,
applies an ad-hoc local signature, verifies the app, and opens it.

This release is not notarized through the paid Apple Developer Program, so the initial
right-click/Open step is expected when installing it on a different Mac.
EOF

/usr/bin/ditto -c -k --sequesterRsrc --keepParent "$STAGING_DIR" "$ARCHIVE_PATH"
/usr/bin/shasum -a 256 "$ARCHIVE_PATH" > "$ARCHIVE_PATH.sha256"

echo "Created:"
echo "  $ARCHIVE_PATH"
echo "  $ARCHIVE_PATH.sha256"
