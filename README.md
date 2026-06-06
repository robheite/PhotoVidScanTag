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

See [MAC_BUILD.md](/I:/PhotoVidScanTag/MAC_BUILD.md) for the dedicated macOS branch workflow and release checklist.

## macOS test install from GitHub

Use these exact steps for an unsigned Mac test build:

1. Open the repo on GitHub.
2. Click **Actions**.
3. Click **macOS Build**.
4. Open the newest successful run for branch `MAC`.
5. Scroll to **Artifacts**.
6. Click **MediaTagger-macos-app** to download it.
7. Move the downloaded zip to the Mac.
8. Double-click the zip so it extracts `MediaTagger.app`.
9. Open **Terminal** on the Mac.
10. Change into the folder containing `MediaTagger.app`.
11. Run:

```bash
xattr -dr com.apple.quarantine "MediaTagger.app"
open "MediaTagger.app"
```

12. If macOS still warns, right-click `MediaTagger.app` in Finder and choose **Open** once.

Important:
- Do **not** use the GitHub release auto-generated `Source code (zip)` file for testing the Mac app.
- Do **not** use the unsigned DMG from older runs.
- For unsigned GitHub test builds, use the `MediaTagger-macos-app` artifact zip only.
