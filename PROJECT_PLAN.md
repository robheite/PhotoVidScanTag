# MediaTagger Project Plan

## Working Name

Working name: **MediaTagger**

The app is a local-first desktop media scanner, tagger, duplicate finder, and move/copy organizer for macOS and Windows. macOS is the primary target, but the application should keep one shared codebase and maintain matching functionality and visual behavior across both platforms.

## Product Goals

- Scan selected folders or entire drives for photos and videos.
- Handle libraries in the thousands to low tens of thousands of files.
- Cache scan results so the user does not need to rescan unchanged files.
- Display media in a polished photo-library style UI with a detailed data-grid mode.
- Let users tag individual files, multiple files, folders, or whole folder trees.
- Provide tag-based browsing so users can easily see what has already been tagged.
- Detect exact duplicate files and group them for review.
- Preview move/copy plans before any files are changed.
- Organize media by date taken, with optional additional folder levels selected by the user.
- Export useful reports such as scan results, tags, duplicates, and move/copy plans.

## Recommended Stack

- Desktop shell: Tauri
- UI: React + TypeScript
- Backend: Rust
- Database/cache: SQLite
- Packaging targets: macOS and Windows

This keeps a single app codebase while still allowing native file access, performant scanning, and modern UI work. Most development can happen on Windows. Final macOS packaging, signing, and notarization will require access to a Mac or a macOS build runner.

## Core Data Concepts

### Scan Roots

A scan root can be either:

- A selected folder
- An entire drive or volume

Users can maintain multiple scan roots and choose whether to work with all roots or a single selected root.

### Media Files

Each scanned file should store:

- File id
- Current file path
- Original scan root
- Filename
- Extension
- Media type: image, video, raw, unknown-supported
- File size in bytes and MB
- Date taken
- Date metadata source
- Filesystem created date
- Filesystem modified date
- Width
- Height
- Megapixels
- Duration, for videos
- Camera make/model, when available
- Codec/container attributes, when available
- Hash, when computed
- Missing/deleted status
- Last scanned timestamp

### Tags

Tags are stored in the application database. They are not written back to media metadata in v1.

Tag behavior:

- Tags can be applied to individual files.
- Tags can be applied to multiple selected files.
- Tags can be applied to a folder.
- Folder-applied tags cascade to files inside that folder.
- Individual file tags remain supported even when folder tags exist.
- Existing tags autocomplete when the user applies tags.
- Tags are visible in the library and data-grid views.
- Tags are usable as filters.
- A dedicated tag browser lets the user select a tag and see all matching files with previews.

Open design detail: folder tags should likely be stored separately from file tags, then resolved into an effective tag list at display/report time. This preserves the ability to change folder tag behavior later without rewriting every file record.

## Supported File Types

The user can configure selected image/video formats. The app should ship with editable presets that include standard, Apple, Nikon, Sony, and common camera formats.

Initial preset candidates:

- Images: jpg, jpeg, png, gif, bmp, tif, tiff, webp
- Apple/iOS: heic, heif, mov, m4v
- Video: mp4, mov, m4v, avi, mkv, mpg, mpeg, webm
- RAW/camera: dng, nef, nrw, arw, srf, sr2, cr2, cr3, raf, orf, rw2, pef

## Metadata Priority

Date organization should prefer:

1. EXIF/date taken metadata
2. Video creation metadata
3. Filesystem created date
4. Filesystem modified date

The app should preserve which source was used so users understand why a file was grouped into a given year/month.

## UI Structure

### Main Sections

1. Scan
2. Library & Tagging
3. Duplicates
4. Move/Copy
5. Settings

### Shared UI Requirements

- Modern photo-library feel.
- System thumbnails preferred.
- Fallback to file-type icons when system thumbnails are unavailable.
- Generated/cached thumbnails for video files are core functionality.
- Generated/cached thumbnails should also support unsupported image formats such as HEIC and RAW where feasible.
- Resizable side panels with visible horizontal drag handles.
- No fixed-width side panels that trap the user.
- Data grids must allow columns to be shown/hidden.
- Filters should be easy to turn on/off.
- Folder and path lists should use tree hierarchy from the start.

### Tree Requirements

Any folder/directory tree should support:

- Expand all
- Collapse all
- Expand/collapse by level
- Checkboxes
- Multi-select
- Ctrl-style selection behavior
- Shift-style range selection behavior where practical
- Folder-level actions

## Section Details

### 1. Scan

Capabilities:

- Add folder scan root.
- Add drive/volume scan root.
- Enable/disable scan roots.
- Choose one root or all roots.
- Configure included extensions.
- Start scan.
- Refresh scan.
- Detect unchanged files and avoid reprocessing them.
- Keep missing/deleted files visible, marked with status.
- Let user remove missing entries manually or through a cleanup action.

Scan cache behavior:

- Store file path, size, modified time, and metadata.
- On refresh, skip unchanged files when size and modified timestamp match.
- Reprocess changed files.
- Mark previously known files as missing if no longer found.

### 2. Library & Tagging

Views:

- Photo grid view
- Detailed data-grid view
- Tag browser view

Photo grid:

- Uses system thumbnails where feasible.
- Uses generated cached thumbnails for video files.
- Uses generated cached thumbnails for unsupported image formats where feasible.
- Supports multiple thumbnail sizes.
- Shows filename, tags, file status, and basic metadata.

Thumbnail layer:

- Store generated thumbnails in the app data folder, not beside user media.
- Store thumbnail status in SQLite: pending, ready, failed, unsupported.
- Reuse cached thumbnails when source file size and modified timestamp have not changed.
- Generate thumbnails in the background after scan.
- Use FFmpeg/ffprobe or an equivalent proven engine for video thumbnails and video metadata.
- Use image conversion or OS-native support for HEIC/RAW thumbnails where possible.
- Show fallback icons only while thumbnails are pending, failed, or unsupported.

Data grid:

- Shows preview thumbnail, filename, current path, type, size, date taken, dimensions, megapixels, duration, tags, scan root, duplicate status, missing status.
- Supports inline or quick-access tag editing.
- Supports bulk actions based on selected rows.

Tag browser:

- Left side: searchable tag list.
- Main area: files with the selected tag.
- Optional filters still available.

### 3. Duplicates

Initial behavior:

- Exact duplicate detection only.
- Use content hash.
- Store duplicate groups in the database.
- Show grouped duplicate results.

Duplicate group details:

- Preview
- Current file path
- Filename
- File size
- Date taken
- Dimensions
- File type
- Tags
- Scan root
- Missing status

Reports:

- Export duplicates to CSV in v1.
- PDF report can follow after CSV/report shape is validated.

### 4. Move/Copy

Capabilities:

- Select source scope:
  - Selected files
  - Selected folder
  - Selected scan root
  - All scanned files
- Choose destination folder.
- Choose move or copy.
- Configure folder organization order.
- Preview plan before commit.
- Execute only after explicit confirmation.
- Save operation log.

Default structure:

```text
Destination/
  YYYY/
    MM - Month/
      file.ext
```

Optional organization levels:

- Year
- Month
- Tag
- Media type
- File type
- Camera model
- Source folder

Safeguards:

- Preview all source and destination paths.
- Never overwrite by default.
- Collision options:
  - Skip
  - Auto-rename
  - Compare details
- Dry-run preview before execution.
- Post-operation report.

### 5. Settings

Settings should include:

- Extension presets
- Custom extensions
- Default scan roots
- Thumbnail preferences
- Metadata source preferences
- Duplicate hash settings
- Default move/copy organization rules
- Report export preferences
- Database/cache location

## Reports

Initial CSV reports:

- All scanned files
- Files by tag
- Tags summary
- Exact duplicate groups
- Move/copy preview
- Move/copy execution log

Later PDF reports:

- Duplicate report
- Tag report
- Move/copy report

## Development Milestones

### Milestone 1: App Skeleton and Scan Cache

- Scaffold Tauri + React + TypeScript app.
- Add SQLite database.
- Add scan roots management.
- Add configurable extension presets.
- Implement file scan and refresh behavior.
- Cache scan results.
- Mark missing files without hiding them.

### Milestone 2: Library UI and Metadata

- Build photo-library grid.
- Add system thumbnail support where feasible.
- Add detailed data-grid view.
- Display core metadata.
- Add column visibility controls.
- Add filter toggles.

### Milestone 3: Tagging

- Add tag database tables.
- Add tag autocomplete.
- Tag individual files.
- Tag selected files.
- Tag folders with cascading effective tags.
- Add tag browser view.
- Add CSV export for tag reports.

### Milestone 4: Thumbnail Extraction

- Add thumbnail database fields/tables.
- Generate cached thumbnails for videos.
- Generate cached thumbnails for HEIC/RAW where feasible.
- Add thumbnail queue/status handling.
- Add video metadata extraction using FFmpeg/ffprobe or equivalent.
- Display generated thumbnails in the library grid.

### Milestone 5: Exact Duplicates

- Add file hashing.
- Store hashes.
- Find exact duplicate groups.
- Build duplicate review UI.
- Export duplicate CSV report.

### Milestone 6: Move/Copy Planner

- Add destination picker.
- Add organization rule builder.
- Add move/copy preview.
- Add collision handling.
- Add execution with operation log.
- Export move/copy report.

### Milestone 7: Polish and Packaging

- Improve macOS styling and behavior.
- Improve Windows styling and behavior.
- Package Windows build.
- Package macOS build.
- Add app icons and installer polish.
- Validate large-library performance.

## Scale Assumption

The expected library size is usually thousands of files and may reach the low tens of thousands. The app should use indexed SQLite tables, background scanning, incremental refresh, and virtualized grids/lists, but it does not need an architecture optimized for hundreds of thousands or millions of media files in the first version.

## Open Questions

- Final app name: MediaTagger is the working name, but can be changed.
- Should folder tags apply only to files currently scanned, or should new files discovered later inherit the folder tag automatically? Recommended: new files should inherit folder tags automatically through effective tag resolution.
- Should folder tags be removable separately from direct file tags? Recommended: yes.
- Should missing files keep their tags? Recommended: yes, until the user removes the file record from the database.

## Known UI Follow-Ups

- Library details panel: portrait-oriented images can overflow the preview well and visually bleed into the metadata area. The preview container needs stricter image containment and max-height behavior so tall images stay fully inside the details preview region.
