#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_APP="$SCRIPT_DIR/MediaTagger.app"
INSTALL_APP="/Applications/MediaTagger.app"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer must be run on a Mac."
  read -r -p "Press Return to close..." _
  exit 1
fi

if [[ ! -d "$SOURCE_APP" ]]; then
  echo "MediaTagger.app must remain beside this installer."
  read -r -p "Press Return to close..." _
  exit 1
fi

echo "Installing MediaTagger in Applications..."
if ! /usr/bin/ditto "$SOURCE_APP" "$INSTALL_APP" 2>/dev/null; then
  echo "Administrator approval is required to write to Applications."
  /usr/bin/sudo /usr/bin/ditto "$SOURCE_APP" "$INSTALL_APP"
fi

/usr/bin/xattr -cr "$INSTALL_APP"
/usr/bin/codesign --force --deep --sign - "$INSTALL_APP"
/usr/bin/codesign --verify --deep --strict --verbose=2 "$INSTALL_APP"

VERSION="$(/usr/bin/plutil -extract CFBundleShortVersionString raw "$INSTALL_APP/Contents/Info.plist")"
echo "MediaTagger $VERSION is installed and verified."
/usr/bin/open "$INSTALL_APP"
