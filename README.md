# MediaTagger

MediaTagger is a local-first desktop app for scanning, tagging, reviewing, de-duplicating, and organizing photo/video libraries across macOS and Windows.

The app is planned as a Tauri desktop application with a React/TypeScript frontend, Rust backend, and SQLite cache/database.

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
