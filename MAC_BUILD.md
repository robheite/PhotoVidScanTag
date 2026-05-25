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

- Tauri bundle icons now include `icon.icns`
- macOS build scripts are available in `package.json`
- helper script added at [tools/tauri-build-macos.sh](</E:/New folder/OneDrive/Documents/Bekka File Search and Tag/tools/tauri-build-macos.sh>)

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

5. Test the generated app locally.

6. After unsigned output looks good, configure Apple signing/notarization on the Mac and run:

```bash
npm run tauri:build:macos
```

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
   - move/copy preview and execution still behave
   - exports write correctly
4. Fix any platform-specific file-dialog or path behavior
5. Then do signing and notarization

## Distribution note

Keeping the macOS work on `MAC` makes it easier to:

- cut Mac-specific release notes
- keep platform packaging changes isolated
- merge shared app work back and forth without tangling release steps
