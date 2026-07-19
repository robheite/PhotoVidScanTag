# MediaTagger

MediaTagger is a local-first desktop app for scanning, tagging, reviewing, de-duplicating, and organizing photo/video libraries across macOS and Windows.

The app is planned as a Tauri desktop application with a React/TypeScript frontend, Rust backend, and SQLite cache/database.

Repository: `robheite/PhotoVidScanTag`

## Current Status

Initial scaffold and product plan are in progress.

See [PROJECT_PLAN.md](PROJECT_PLAN.md) for the development roadmap and product decisions.

## Development

Prerequisites:

- Node.js 20+
- npm
- Rust toolchain, required for Tauri desktop builds

Frontend-only development:

```powershell
npm install
npm run dev
```

Tauri desktop development, after Rust is installed:

```powershell
npm run tauri dev
```

Windows Tauri development with automatic cleanup of stale Vite listeners on port `1420` before and after the session:

```powershell
npm run tauri:dev:windows
```

Windows desktop build:

```powershell
cmd /c tools\tauri-build-windows.cmd
```

The Windows helper loads the Visual Studio C++ build environment, adds Cargo to `PATH`, then runs the Tauri build. This is needed when building from a normal shell instead of a Visual Studio Developer Command Prompt.

macOS desktop build, on a Mac:

```bash
npm run tauri:build:macos:unsigned
```

or, once Apple signing/notarization is configured on the Mac:

```bash
npm run tauri:build:macos
```

See [MAC_BUILD.md](MAC_BUILD.md) for the macOS package and release workflow.

## macOS package and install

`main` is the authoritative source branch for both Windows and macOS. Do not build releases from the legacy `MAC` branch.

To create a ready-to-transfer Mac package locally:

```bash
npm ci
npm test
npm run package:macos-release
```

The versioned zip is written to `release/`. It contains `MediaTagger.app`, installation instructions, and a double-click installer that copies and verifies the app in `/Applications`.

For another Mac, download the matching `MediaTagger-macOS-vX.Y.Z.zip` asset from the GitHub Release—not GitHub's automatically generated source-code archives. Extract it, then right-click **Install MediaTagger.command** and choose **Open**. Node.js, Rust, Codex, and the source repository are not needed on the destination laptop.

See [MAC_BUILD.md](MAC_BUILD.md) for versioning, GitHub release, and unsigned-app details.
