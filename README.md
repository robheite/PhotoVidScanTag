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
