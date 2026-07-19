# MediaTagger macOS Releases

`main` is the authoritative branch for the application on both Windows and macOS. The legacy `MAC` branch must not be used for new builds; keeping application code on separate platform branches allowed it to drift behind `main`.

## Install on Bekka's laptop

1. Open the matching version on the repository's **Releases** page.
2. Download `MediaTagger-macOS-vX.Y.Z.zip`.
3. Do not download GitHub's `Source code (zip)` or `Source code (tar.gz)` links.
4. Extract the MediaTagger zip.
5. Keep the app and installer together.
6. Right-click **Install MediaTagger.command** and choose **Open**.
7. Enter an administrator password only if macOS requires it to write to `/Applications`.

The installer copies `MediaTagger.app` to `/Applications`, removes downloaded quarantine metadata, applies an ad-hoc local signature, verifies the bundle, and opens it. The destination laptop does not need Node.js, Rust, Git, Codex, or a source checkout.

Because this project is not enrolled in the paid Apple Developer Program, the package is not notarized. The initial right-click/Open step is therefore expected on a different Mac.

## Create a local transfer package

On the development Mac:

```bash
npm ci
npm test
npm run package:macos-release
```

The package and SHA-256 checksum are created under `release/`. To repackage an already-built application without rebuilding it:

```bash
npm run package:macos-release:existing
```

The latter command is intended only when the release bundle was just built and verified from the current commit.

## Publish a GitHub release

Versions are stored in `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock`.

1. Set the new version in `package.json`.
2. Synchronize and verify all version files:

```bash
npm run version:sync
npm run version:check
```

3. Commit the version change to `main` and make sure CI passes.
4. Create and push the matching tag, for example:

```bash
git tag v1.1.8
git push origin main v1.1.8
```

The `macOS Build and Release` GitHub Actions workflow will:

- check out the exact tagged commit;
- reject a tag that does not match the application version;
- install locked dependencies with `npm ci`;
- run the frontend and Rust test suites;
- build the unsigned macOS app;
- package the app with the installer and instructions;
- upload the zip as a workflow artifact;
- create the GitHub Release and attach the versioned Mac zip.

A manual workflow run or an ordinary push to `main` builds a downloadable test artifact but does not create a public GitHub Release. Only a `vX.Y.Z` tag publishes a release.

## Local installation while developing

To build, install, verify, and optionally open the current source directly on the development Mac:

```bash
npm run install:macos-local:open
```

This is for development. Bekka's laptop should use the versioned release zip instead.

## Signing limitation

The workflow intentionally distributes a zipped `.app`, not an unsigned DMG. Without Apple Developer signing and notarization, unsigned DMGs are more likely to produce misleading “damaged” warnings. The packaged installer applies an ad-hoc signature locally, but it cannot replace Apple notarization or eliminate every first-launch security prompt.
