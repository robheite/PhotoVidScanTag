# MediaTagger macOS Build Track

This branch exists to keep macOS packaging, signing, notarization, and release flow separate from the Windows release line.

Current branch name: `MAC`

## What we can prepare on Windows

From the Windows development machine we can safely do the following:

- keep the shared React + Rust codebase moving
- generate shared icon assets
- keep the Tauri bundle configuration ready for macOS
- document the macOS build and release flow
- prepare versioning and release notes

## What still requires a Mac

An actual distributable macOS build still needs a Mac or a macOS CI runner for:

- `tauri build` targeting macOS
- code signing with an Apple Developer certificate
- notarization with Apple
- final validation of the `.app` and `.dmg`

## Current macOS prep already done

- Tauri bundle icons include `icon.icns`
- macOS build scripts are available in `package.json`
- helper script: [tools/tauri-build-macos.sh](/I:/PhotoVidScanTag/tools/tauri-build-macos.sh)
- GitHub Actions workflow: [.github/workflows/macos-build.yml](/I:/PhotoVidScanTag/.github/workflows/macos-build.yml)

## Recommended build flow on a Mac

1. Install prerequisites:
   - Xcode
   - Xcode command line tools
   - Node.js
   - Rust

2. Clone the repo and switch to the `MAC` branch.

3. Install dependencies:

```bash
npm install
```

4. Run an unsigned local build first:

```bash
npm run tauri:build:macos:unsigned
```

5. Check the generated outputs under:

```bash
src-tauri/target/release/bundle
```

6. If macOS blocks the unsigned build on first run, clear quarantine and open it:

```bash
xattr -dr com.apple.quarantine "src-tauri/target/release/bundle/macos/MediaTagger.app"
open "src-tauri/target/release/bundle/macos/MediaTagger.app"
```

7. If Finder still warns, right-click the app once and choose **Open**.

8. After unsigned output looks good, configure Apple signing/notarization on the Mac and run:

```bash
npm run tauri:build:macos
```

## GitHub Actions path

If you want the easiest first test without touching local Mac build tooling, use the GitHub Actions workflow on the `MAC` branch:

1. Push changes to `MAC`, or run the workflow manually from the Actions tab.
2. Open the `macOS Build` workflow run in GitHub.
3. Download the `MediaTagger-macos-bundle` artifact.
4. Prefer the zipped app bundle:

```text
src-tauri/target/release/bundle/macos/MediaTagger.app.zip
```

5. On the Mac, unzip it, then run:

```bash
xattr -dr com.apple.quarantine "MediaTagger.app"
open "MediaTagger.app"
```

6. If the app still looks blocked, right-click it in Finder and choose **Open** once.

This workflow currently builds an unsigned macOS bundle for testing. That is the right first step before wiring in Apple signing and notarization.

## Why the GitHub build may behave differently from a local Mac build

Local Mac builds often launch more easily because they were created directly on the machine you are testing. A downloaded unsigned artifact from GitHub usually gets quarantined by macOS, which can make it fail to launch until quarantine is removed.

That is a packaging/distribution behavior, not necessarily an app-core failure.

## Signing / notarization checklist

Before the signed build pass, make sure the Mac has:

- an Apple Developer account with app signing access
- a valid Developer ID Application certificate in Keychain
- notarization credentials prepared for the chosen workflow
- the final app identifier confirmed as:
  - `com.robheite.mediatagger`

## Suggested first macOS validation pass

When we get onto a Mac, the first pass should be:

1. Build unsigned
2. Launch the app
3. Verify:
   - folder picking works
   - scans run
   - previews load
   - duplicates review and cleanup behave
   - move/copy preview and execution still behave
   - exports write correctly
4. Fix any platform-specific file-dialog or path behavior
5. Then do signing and notarization

## Distribution note

Keeping the macOS work on `MAC` makes it easier to:

- cut Mac-specific release notes
- keep platform packaging changes isolated
- merge shared app work back and forth without tangling release steps
