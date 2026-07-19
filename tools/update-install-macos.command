#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This updater must be run on a Mac."
  read -r -p "Press Return to close..." _
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "The MediaTagger source folder has uncommitted changes."
  echo "The updater stopped so it would not overwrite local work."
  read -r -p "Press Return to close..." _
  exit 1
fi

echo "Updating MediaTagger from the authoritative main branch..."
git fetch origin main
git checkout main
git pull --ff-only origin main

echo "Installing locked dependencies and validating the source..."
npm ci
npm run version:check
npm test

echo "Building and installing MediaTagger locally..."
npm run install:macos-local:open

echo
echo "MediaTagger is current, verified, installed, and open."
read -r -p "Press Return to close..." _
