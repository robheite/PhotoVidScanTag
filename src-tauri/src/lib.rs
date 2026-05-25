use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{Manager, State};
use walkdir::WalkDir;

struct AppState {
    db_path: Mutex<PathBuf>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OperationHistoryEntry {
    id: i64,
    operation_type: String,
    status: String,
    summary: String,
    details: Option<String>,
    created_at_unix: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppSettings {
    selected_extensions: Vec<String>,
    default_thumbnail_size: String,
    default_library_page_size: i64,
    filter_presets: Vec<FilterPreset>,
    history_retention_count: i64,
    log_report_exports: bool,
    log_successful_operations: bool,
    app_data_dir: String,
    database_path: String,
    startup_log_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FilterPreset {
    name: String,
    media_type_filter: String,
    extension_filter: String,
    missing_filter_mode: String,
    tag_filter_input: String,
    tag_match_mode: String,
    date_from_input: String,
    date_to_input: String,
    min_file_size_mb: String,
    max_file_size_mb: String,
    min_megapixels: String,
    max_megapixels: String,
    date_source_filter: String,
    selected_tag_filter: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ScanRequest {
    paths: Vec<String>,
    extensions: Vec<String>,
    force_rescan: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanResponse {
    scanned_files: usize,
    cached_files: usize,
    skipped_unchanged: usize,
    missing_files: usize,
    errors: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MediaFile {
    id: i64,
    path: String,
    scan_root: String,
    filename: String,
    extension: String,
    media_type: String,
    file_size_bytes: i64,
    file_size_mb: f64,
    created_unix: Option<i64>,
    modified_unix: Option<i64>,
    date_taken_unix: Option<i64>,
    date_source: Option<String>,
    width: Option<i64>,
    height: Option<i64>,
    megapixels: Option<f64>,
    missing: bool,
    scanned_at_unix: i64,
    tags: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanRoot {
    path: String,
    enabled: bool,
    updated_at_unix: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanFolder {
    path: String,
    scan_root: String,
    missing: bool,
    last_seen_scan_id: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct TagSummary {
    id: i64,
    name: String,
    file_count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DuplicateGroup {
    key: String,
    hash: String,
    file_count: usize,
    wasted_size_bytes: i64,
    wasted_size_mb: f64,
    items: Vec<MediaFile>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DuplicateScanResponse {
    groups: Vec<DuplicateGroup>,
    duplicate_files: usize,
    wasted_size_bytes: i64,
    wasted_size_mb: f64,
    hashed_files: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteMoveCopyRequest {
    mode: String,
    collision_policy: String,
    items: Vec<ExecuteMoveCopyItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteMoveCopyItem {
    source_path: String,
    destination_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteMoveCopyResponse {
    processed_items: usize,
    copied_items: usize,
    moved_items: usize,
    renamed_items: usize,
    skipped_existing: usize,
    skipped_same_path: usize,
    failed_items: usize,
    item_results: Vec<MoveCopyItemResult>,
    errors: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MoveCopyItemResult {
    source_path: String,
    requested_destination_path: String,
    final_destination_path: Option<String>,
    status: String,
    action: String,
    note: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CleanupDuplicatesRequest {
    mode: String,
    collision_policy: String,
    destination_folder: Option<String>,
    paths: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CleanupDuplicatesResponse {
    processed_items: usize,
    moved_items: usize,
    deleted_items: usize,
    renamed_items: usize,
    skipped_existing: usize,
    failed_items: usize,
    errors: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyTagsRequest {
    file_ids: Vec<i64>,
    tags: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RemoveTagRequest {
    file_ids: Vec<i64>,
    tag: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveAppSettingsRequest {
    selected_extensions: Vec<String>,
    default_thumbnail_size: String,
    default_library_page_size: i64,
    filter_presets: Option<Vec<FilterPreset>>,
    history_retention_count: Option<i64>,
    log_report_exports: Option<bool>,
    log_successful_operations: Option<bool>,
}

#[tauri::command]
fn health_check() -> &'static str {
    "ok"
}

#[tauri::command]
fn supported_extensions() -> Vec<String> {
    [
        "jpg", "jpeg", "png", "gif", "bmp", "tif", "tiff", "webp", "heic", "heif", "mov", "m4v",
        "mp4", "avi", "mkv", "mpg", "mpeg", "webm", "dng", "nef", "nrw", "arw", "srf", "sr2",
        "cr2", "cr3", "raf", "orf", "rw2", "pef",
    ]
    .into_iter()
    .map(String::from)
    .collect()
}

#[tauri::command]
fn scan_media(request: ScanRequest, state: State<'_, AppState>) -> Result<ScanResponse, String> {
    let db_path = state
        .db_path
        .lock()
        .map_err(|_| "Database state is unavailable".to_string())?
        .clone();
    let conn = Connection::open(db_path).map_err(|error| error.to_string())?;
    init_db(&conn).map_err(|error| error.to_string())?;

    let normalized_extensions = normalize_extensions(&request.extensions);
    let started_at = unix_now();
    conn.execute(
        "INSERT INTO scan_runs (started_at_unix) VALUES (?1)",
        params![started_at],
    )
    .map_err(|error| error.to_string())?;
    let scan_run_id = conn.last_insert_rowid();

    let mut response = ScanResponse {
        scanned_files: 0,
        cached_files: list_media_count(&conn).unwrap_or(0),
        skipped_unchanged: 0,
        missing_files: 0,
        errors: Vec::new(),
    };

    for root in request.paths.iter().map(|path| path.trim()).filter(|path| !path.is_empty()) {
        let root_path = PathBuf::from(root);
        if !root_path.exists() {
            response.errors.push(format!("Path does not exist: {root}"));
            continue;
        }

        let root_string = root_path.to_string_lossy().to_string();
        conn.execute(
            "INSERT INTO scan_roots (path, enabled, updated_at_unix)
             VALUES (?1, 1, ?2)
             ON CONFLICT(path) DO UPDATE SET enabled = 1, updated_at_unix = excluded.updated_at_unix",
            params![root_string, started_at],
        )
        .map_err(|error| error.to_string())?;

        cache_scan_folder(&conn, &root_path, &root_string, scan_run_id)
            .map_err(|error| error.to_string())?;

        for entry in WalkDir::new(&root_path).follow_links(false).into_iter() {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    response.errors.push(error.to_string());
                    continue;
                }
            };

            if entry.file_type().is_dir() {
                if let Err(error) = cache_scan_folder(&conn, entry.path(), &root_string, scan_run_id)
                {
                    response
                        .errors
                        .push(format!("{}: {error}", entry.path().display()));
                }
                continue;
            }

            if !entry.file_type().is_file() {
                continue;
            }

            let path = entry.path();
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.to_ascii_lowercase())
                .unwrap_or_default();

            if !normalized_extensions.contains(&extension) {
                continue;
            }

            match cache_media_file(
                &conn,
                path,
                &root_string,
                scan_run_id,
                started_at,
                request.force_rescan,
            ) {
                Ok(true) => response.scanned_files += 1,
                Ok(false) => response.skipped_unchanged += 1,
                Err(error) => response.errors.push(format!("{}: {error}", path.display())),
            }
        }

        conn.execute(
            "UPDATE media_files
             SET missing = 1
             WHERE scan_root = ?1 AND last_seen_scan_id != ?2",
            params![root_string, scan_run_id],
        )
        .map_err(|error| error.to_string())?;
        conn.execute(
            "UPDATE scan_folders
             SET missing = 1
             WHERE scan_root = ?1 AND last_seen_scan_id != ?2",
            params![root_string, scan_run_id],
        )
        .map_err(|error| error.to_string())?;
    }

    response.cached_files = list_media_count(&conn).map_err(|error| error.to_string())?;
    response.missing_files = missing_media_count(&conn).map_err(|error| error.to_string())?;
    let operation_type = if request.force_rescan {
        "full_scan"
    } else {
        "refresh_scan"
    };
    let status = if response.errors.is_empty() {
        "success"
    } else if response.scanned_files > 0 || response.skipped_unchanged > 0 {
        "partial"
    } else {
        "failed"
    };
    let summary = format!(
        "{} across {} path(s): {} processed, {} unchanged, {} missing",
        if request.force_rescan {
            "Full scan"
        } else {
            "Refresh scan"
        },
        request.paths.len(),
        response.scanned_files,
        response.skipped_unchanged,
        response.missing_files
    );
    let details = if response.errors.is_empty() {
        None
    } else {
        Some(compose_error_details(&response.errors))
    };
    record_operation(&conn, operation_type, status, &summary, details.as_deref())
        .map_err(|error| error.to_string())?;
    Ok(response)
}

#[tauri::command]
fn list_media(state: State<'_, AppState>) -> Result<Vec<MediaFile>, String> {
    let db_path = state
        .db_path
        .lock()
        .map_err(|_| "Database state is unavailable".to_string())?
        .clone();
    let conn = Connection::open(db_path).map_err(|error| error.to_string())?;
    init_db(&conn).map_err(|error| error.to_string())?;

    let mut statement = conn
        .prepare(
            "SELECT id, path, scan_root, filename, extension, media_type, file_size_bytes,
                    created_unix, modified_unix, date_taken_unix, date_source,
                    width, height, missing, scanned_at_unix
             FROM media_files
             ORDER BY missing ASC, date_taken_unix DESC, filename ASC
             LIMIT 500",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| map_media_row(row))
        .map_err(|error| error.to_string())?;

    let mut files = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    for file in &mut files {
        file.tags = query_tags_for_file(&conn, file.id)?;
    }

    Ok(files)
}

#[tauri::command]
fn list_tags(state: State<'_, AppState>) -> Result<Vec<TagSummary>, String> {
    let db_path = state
        .db_path
        .lock()
        .map_err(|_| "Database state is unavailable".to_string())?
        .clone();
    let conn = Connection::open(db_path).map_err(|error| error.to_string())?;
    init_db(&conn).map_err(|error| error.to_string())?;

    query_tags(&conn)
}

#[tauri::command]
fn apply_tags(
    request: ApplyTagsRequest,
    state: State<'_, AppState>,
) -> Result<Vec<TagSummary>, String> {
    let db_path = state
        .db_path
        .lock()
        .map_err(|_| "Database state is unavailable".to_string())?
        .clone();
    let mut conn = Connection::open(db_path).map_err(|error| error.to_string())?;
    init_db(&conn).map_err(|error| error.to_string())?;

    let file_count = request.file_ids.len();
    let tag_count = request.tags.len();
    let normalized_tags: Vec<String> = request
        .tags
        .into_iter()
        .map(|tag| tag.trim().to_string())
        .filter(|tag| !tag.is_empty())
        .collect();

    if request.file_ids.is_empty() || normalized_tags.is_empty() {
        return query_tags(&conn);
    }

    let now = unix_now();
    let transaction = conn.transaction().map_err(|error| error.to_string())?;
    for tag_name in normalized_tags {
        transaction
            .execute(
                "INSERT INTO tags (name, created_at_unix)
                 VALUES (?1, ?2)
                 ON CONFLICT(name) DO NOTHING",
                params![tag_name, now],
            )
            .map_err(|error| error.to_string())?;
        let tag_id: i64 = transaction
            .query_row(
                "SELECT id FROM tags WHERE name = ?1",
                params![tag_name],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;

        for file_id in &request.file_ids {
            transaction
                .execute(
                    "INSERT INTO file_tags (file_id, tag_id, created_at_unix)
                     VALUES (?1, ?2, ?3)
                     ON CONFLICT(file_id, tag_id) DO NOTHING",
                    params![file_id, tag_id, now],
                )
                .map_err(|error| error.to_string())?;
        }
    }
    transaction.commit().map_err(|error| error.to_string())?;
    let summary = format!(
        "Applied {} tag(s) to {} file(s)",
        tag_count,
        file_count
    );
    record_operation(&conn, "tag_apply", "success", &summary, None)
        .map_err(|error| error.to_string())?;

    query_tags(&conn)
}

#[tauri::command]
fn remove_tag_from_files(
    request: RemoveTagRequest,
    state: State<'_, AppState>,
) -> Result<Vec<TagSummary>, String> {
    let db_path = state
        .db_path
        .lock()
        .map_err(|_| "Database state is unavailable".to_string())?
        .clone();
    let mut conn = Connection::open(db_path).map_err(|error| error.to_string())?;
    init_db(&conn).map_err(|error| error.to_string())?;

    let tag_name = request.tag.trim().to_string();
    if request.file_ids.is_empty() || tag_name.is_empty() {
        return query_tags(&conn);
    }

    let tag_id = conn
        .query_row(
            "SELECT id FROM tags WHERE name = ?1",
            params![tag_name],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;

    if let Some(tag_id) = tag_id {
        let transaction = conn.transaction().map_err(|error| error.to_string())?;
        for file_id in request.file_ids {
            transaction
                .execute(
                    "DELETE FROM file_tags WHERE file_id = ?1 AND tag_id = ?2",
                    params![file_id, tag_id],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())?;
        let summary = format!("Removed tag '{}' from selected files", tag_name);
        record_operation(&conn, "tag_remove", "success", &summary, None)
            .map_err(|error| error.to_string())?;
    }

    query_tags(&conn)
}

#[tauri::command]
fn open_file_location(path: String) -> Result<(), String> {
    let target = PathBuf::from(path.trim());
    if !target.exists() {
        return Err("File does not exist".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &target.to_string_lossy()])
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&target)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let parent = target
            .parent()
            .ok_or_else(|| "Unable to resolve parent folder".to_string())?;
        std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}

#[tauri::command]
fn open_file_path(path: String) -> Result<(), String> {
    let file_path = PathBuf::from(&path);
    if !file_path.exists() {
        return Err(format!("File does not exist: {path}"));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|error| error.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|error| error.to_string())?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

#[tauri::command]
fn save_text_report(path: String, contents: String, state: State<'_, AppState>) -> Result<(), String> {
    let report_path = PathBuf::from(&path);
    if let Some(parent) = report_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    fs::write(&report_path, contents).map_err(|error| error.to_string())?;

    let db_path = state
        .db_path
        .lock()
        .map_err(|_| "Database state is unavailable".to_string())?
        .clone();
    let conn = Connection::open(&db_path).map_err(|error| error.to_string())?;
    init_db(&conn).map_err(|error| error.to_string())?;
    let settings = read_app_settings(&conn, &db_path)?;
    if settings.log_report_exports {
        let summary = format!("Saved report to {}", report_path.display());
        record_operation(&conn, "export_report", "success", &summary, None)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn execute_move_copy(
    request: ExecuteMoveCopyRequest,
    state: State<'_, AppState>,
) -> Result<ExecuteMoveCopyResponse, String> {
    let mode = request.mode.trim().to_ascii_lowercase();
    if mode != "copy" && mode != "move" {
        return Err(format!("Unsupported move/copy mode: {}", request.mode));
    }
    let collision_policy = normalize_collision_policy(&request.collision_policy);
    let db_path = state
        .db_path
        .lock()
        .map_err(|_| "Database state is unavailable".to_string())?
        .clone();
    let conn = Connection::open(db_path).map_err(|error| error.to_string())?;
    init_db(&conn).map_err(|error| error.to_string())?;

    let mut response = ExecuteMoveCopyResponse {
        processed_items: request.items.len(),
        copied_items: 0,
        moved_items: 0,
        renamed_items: 0,
        skipped_existing: 0,
        skipped_same_path: 0,
        failed_items: 0,
        item_results: Vec::new(),
        errors: Vec::new(),
    };

    for item in request.items {
        let source_path = PathBuf::from(item.source_path.trim());
        let requested_destination_path = PathBuf::from(item.destination_path.trim());

        if !source_path.exists() {
            response.failed_items += 1;
            let message = format!("Source does not exist: {}", source_path.display());
            response.errors.push(message.clone());
            response.item_results.push(MoveCopyItemResult {
                source_path: source_path.to_string_lossy().to_string(),
                requested_destination_path: requested_destination_path.to_string_lossy().to_string(),
                final_destination_path: None,
                status: "failed".to_string(),
                action: mode.clone(),
                note: message,
            });
            continue;
        }

        let canonical_source = source_path
            .canonicalize()
            .unwrap_or_else(|_| source_path.clone());
        let canonical_destination_parent = requested_destination_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(PathBuf::new);

        if !canonical_destination_parent.as_os_str().is_empty() {
            fs::create_dir_all(&canonical_destination_parent).map_err(|error| {
                format!(
                    "Failed to create destination folder {}: {error}",
                    canonical_destination_parent.display()
                )
            })?;
        }

        let destination_exists = requested_destination_path.exists();
        if destination_exists {
            let canonical_destination = requested_destination_path
                .canonicalize()
                .unwrap_or_else(|_| requested_destination_path.clone());
            if canonical_destination == canonical_source {
                response.skipped_same_path += 1;
                response.item_results.push(MoveCopyItemResult {
                    source_path: source_path.to_string_lossy().to_string(),
                    requested_destination_path: requested_destination_path.to_string_lossy().to_string(),
                    final_destination_path: Some(requested_destination_path.to_string_lossy().to_string()),
                    status: "skipped_same_path".to_string(),
                    action: mode.clone(),
                    note: "Source and destination resolve to the same file".to_string(),
                });
                continue;
            } else if collision_policy == "skip" {
                response.skipped_existing += 1;
                response.item_results.push(MoveCopyItemResult {
                    source_path: source_path.to_string_lossy().to_string(),
                    requested_destination_path: requested_destination_path.to_string_lossy().to_string(),
                    final_destination_path: Some(requested_destination_path.to_string_lossy().to_string()),
                    status: "skipped_existing".to_string(),
                    action: mode.clone(),
                    note: "Destination already exists".to_string(),
                });
                continue;
            }
        }

        let destination_path = if collision_policy == "rename" {
            next_available_destination_path(&requested_destination_path)
                .map_err(|error| error.to_string())?
        } else {
            requested_destination_path.clone()
        };

        if destination_path == source_path {
            response.skipped_same_path += 1;
            response.item_results.push(MoveCopyItemResult {
                source_path: source_path.to_string_lossy().to_string(),
                requested_destination_path: requested_destination_path.to_string_lossy().to_string(),
                final_destination_path: Some(destination_path.to_string_lossy().to_string()),
                status: "skipped_same_path".to_string(),
                action: mode.clone(),
                note: "Source and destination are the same path".to_string(),
            });
            continue;
        }

        if destination_path != PathBuf::from(item.destination_path.trim()) {
            response.renamed_items += 1;
        }

        let operation_result = if mode == "copy" {
            fs::copy(&source_path, &destination_path)
                .map(|_| {
                    response.copied_items += 1;
                })
                .map_err(|error| error.to_string())
        } else {
            fs::rename(&source_path, &destination_path)
                .or_else(|_| {
                    fs::copy(&source_path, &destination_path)?;
                    fs::remove_file(&source_path)?;
                    Ok::<(), std::io::Error>(())
                })
                .map(|_| {
                    response.moved_items += 1;
                })
                .map_err(|error| error.to_string())
        };

        if let Err(error) = operation_result {
            response.failed_items += 1;
            let message = format!(
                "{} -> {}: {error}",
                source_path.display(),
                destination_path.display()
            );
            response.errors.push(message.clone());
            response.item_results.push(MoveCopyItemResult {
                source_path: source_path.to_string_lossy().to_string(),
                requested_destination_path: requested_destination_path.to_string_lossy().to_string(),
                final_destination_path: Some(destination_path.to_string_lossy().to_string()),
                status: "failed".to_string(),
                action: mode.clone(),
                note: message,
            });
        } else {
            response.item_results.push(MoveCopyItemResult {
                source_path: source_path.to_string_lossy().to_string(),
                requested_destination_path: requested_destination_path.to_string_lossy().to_string(),
                final_destination_path: Some(destination_path.to_string_lossy().to_string()),
                status: if destination_path != requested_destination_path {
                    "completed_renamed".to_string()
                } else {
                    "completed".to_string()
                },
                action: mode.clone(),
                note: if destination_path != requested_destination_path {
                    "Completed with renamed destination".to_string()
                } else {
                    "Completed".to_string()
                },
            });
        }
    }

    let completed_items = if mode == "copy" {
        response.copied_items
    } else {
        response.moved_items
    };
    let status = if response.failed_items == 0 {
        if completed_items == 0 && response.skipped_existing > 0 {
            "partial"
        } else {
            "success"
        }
    } else if completed_items > 0 || response.skipped_existing > 0 || response.skipped_same_path > 0 {
        "partial"
    } else {
        "failed"
    };
    let summary = format!(
        "{} run: {} completed, {} renamed, {} skipped existing, {} skipped same-path, {} failed",
        if mode == "copy" { "Copy" } else { "Move" },
        completed_items,
        response.renamed_items,
        response.skipped_existing,
        response.skipped_same_path,
        response.failed_items
    );
    let details = if response.errors.is_empty() {
        Some(format!(
            "Collision policy: {}. Processed {} planned item(s).",
            collision_policy, response.processed_items
        ))
    } else {
        Some(format!(
            "Collision policy: {}. {}",
            collision_policy,
            compose_error_details(&response.errors)
        ))
    };
    record_operation(&conn, "move_copy_execute", status, &summary, details.as_deref())
        .map_err(|error| error.to_string())?;

    Ok(response)
}

#[tauri::command]
fn cleanup_duplicates(
    request: CleanupDuplicatesRequest,
    state: State<'_, AppState>,
) -> Result<CleanupDuplicatesResponse, String> {
    let mode = request.mode.trim().to_ascii_lowercase();
    if mode != "move" && mode != "delete" {
        return Err(format!("Unsupported duplicate cleanup mode: {}", request.mode));
    }

    if request.paths.is_empty() {
        return Err("Select one or more duplicate files before cleanup".to_string());
    }

    let collision_policy = normalize_collision_policy(&request.collision_policy);
    let destination_folder = request
        .destination_folder
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);

    if mode == "move" && destination_folder.is_none() {
        return Err("Choose a cleanup folder before moving duplicate files".to_string());
    }

    let db_path = state
        .db_path
        .lock()
        .map_err(|_| "Database state is unavailable".to_string())?
        .clone();
    let conn = Connection::open(db_path).map_err(|error| error.to_string())?;
    init_db(&conn).map_err(|error| error.to_string())?;

    let mut response = CleanupDuplicatesResponse {
        processed_items: request.paths.len(),
        moved_items: 0,
        deleted_items: 0,
        renamed_items: 0,
        skipped_existing: 0,
        failed_items: 0,
        errors: Vec::new(),
    };

    for path in request.paths {
        let source_path = PathBuf::from(path.trim());
        if source_path.as_os_str().is_empty() {
            continue;
        }

        if !source_path.exists() {
            mark_media_file_missing(&conn, &source_path).map_err(|error| error.to_string())?;
            response.failed_items += 1;
            response
                .errors
                .push(format!("Source does not exist: {}", source_path.display()));
            continue;
        }

        let operation_result = if mode == "delete" {
            fs::remove_file(&source_path)
                .map(|_| {
                    response.deleted_items += 1;
                })
                .map_err(|error| error.to_string())
        } else {
            let cleanup_root = destination_folder
                .as_ref()
                .cloned()
                .unwrap_or_else(PathBuf::new);
            let requested_destination = cleanup_root.join(
                source_path
                    .file_name()
                    .map(|name| name.to_os_string())
                    .unwrap_or_default(),
            );

            if let Some(parent) = requested_destination.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    format!("Failed to create cleanup folder {}: {error}", parent.display())
                })?;
            }

            if requested_destination.exists() {
                let canonical_destination = requested_destination
                    .canonicalize()
                    .unwrap_or_else(|_| requested_destination.clone());
                let canonical_source = source_path
                    .canonicalize()
                    .unwrap_or_else(|_| source_path.clone());
                if canonical_destination == canonical_source {
                    response.failed_items += 1;
                    response.errors.push(format!(
                        "Cleanup destination resolves to the same file: {}",
                        source_path.display()
                    ));
                    continue;
                } else if collision_policy == "skip" {
                    response.skipped_existing += 1;
                    continue;
                }
            }

            let destination_path = if collision_policy == "rename" {
                next_available_destination_path(&requested_destination)
                    .map_err(|error| error.to_string())?
            } else {
                requested_destination
            };

            if destination_path != cleanup_root.join(source_path.file_name().unwrap_or_default()) {
                response.renamed_items += 1;
            }

            fs::rename(&source_path, &destination_path)
                .or_else(|_| {
                    fs::copy(&source_path, &destination_path)?;
                    fs::remove_file(&source_path)?;
                    Ok::<(), std::io::Error>(())
                })
                .map(|_| {
                    response.moved_items += 1;
                })
                .map_err(|error| error.to_string())
        };

        match operation_result {
            Ok(()) => {
                mark_media_file_missing(&conn, &source_path).map_err(|error| error.to_string())?;
            }
            Err(error) => {
                response.failed_items += 1;
                response.errors.push(format!("{}: {error}", source_path.display()));
            }
        }
    }

    let completed_items = if mode == "delete" {
        response.deleted_items
    } else {
        response.moved_items
    };
    let status = if response.failed_items == 0 {
        if completed_items == 0 && response.skipped_existing > 0 {
            "partial"
        } else {
            "success"
        }
    } else if completed_items > 0 || response.skipped_existing > 0 {
        "partial"
    } else {
        "failed"
    };
    let summary = if mode == "delete" {
        format!(
            "Duplicate cleanup delete: {} deleted, {} failed",
            response.deleted_items, response.failed_items
        )
    } else {
        format!(
            "Duplicate cleanup move: {} moved, {} renamed, {} skipped existing, {} failed",
            response.moved_items, response.renamed_items, response.skipped_existing, response.failed_items
        )
    };
    let details = if response.errors.is_empty() {
        if mode == "move" {
            Some(format!(
                "Collision policy: {}. Processed {} selected duplicate file(s).",
                collision_policy, response.processed_items
            ))
        } else {
            Some(format!(
                "Processed {} selected duplicate file(s).",
                response.processed_items
            ))
        }
    } else {
        Some(compose_error_details(&response.errors))
    };
    record_operation(&conn, "duplicate_cleanup", status, &summary, details.as_deref())
        .map_err(|error| error.to_string())?;

    Ok(response)
}

#[tauri::command]
fn get_app_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let db_path = state
        .db_path
        .lock()
        .map_err(|_| "Database state is unavailable".to_string())?
        .clone();
    let conn = Connection::open(&db_path).map_err(|error| error.to_string())?;
    init_db(&conn).map_err(|error| error.to_string())?;
    read_app_settings(&conn, &db_path)
}

#[tauri::command]
fn save_app_settings(
    request: SaveAppSettingsRequest,
    state: State<'_, AppState>,
) -> Result<AppSettings, String> {
    let db_path = state
        .db_path
        .lock()
        .map_err(|_| "Database state is unavailable".to_string())?
        .clone();
    let conn = Connection::open(&db_path).map_err(|error| error.to_string())?;
    init_db(&conn).map_err(|error| error.to_string())?;

    let selected_extensions = normalize_extensions(&request.selected_extensions)
        .into_iter()
        .collect::<Vec<_>>();
    let default_thumbnail_size = normalize_thumbnail_size(&request.default_thumbnail_size);
    let default_library_page_size = normalize_library_page_size(request.default_library_page_size);
    let history_retention_count = normalize_history_retention_count(request.history_retention_count.unwrap_or(200));
    let log_report_exports = request.log_report_exports.unwrap_or(true);
    let log_successful_operations = request.log_successful_operations.unwrap_or(true);
    let filter_presets = request
        .filter_presets
        .unwrap_or_default()
        .into_iter()
        .filter_map(normalize_filter_preset)
        .collect::<Vec<_>>();

    set_setting_value(
        &conn,
        "selected_extensions",
        &serde_json::to_string(&selected_extensions).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    set_setting_value(
        &conn,
        "default_thumbnail_size",
        &default_thumbnail_size,
    )
    .map_err(|error| error.to_string())?;
    set_setting_value(
        &conn,
        "default_library_page_size",
        &default_library_page_size.to_string(),
    )
    .map_err(|error| error.to_string())?;
    set_setting_value(
        &conn,
        "history_retention_count",
        &history_retention_count.to_string(),
    )
    .map_err(|error| error.to_string())?;
    set_setting_value(
        &conn,
        "log_report_exports",
        if log_report_exports { "1" } else { "0" },
    )
    .map_err(|error| error.to_string())?;
    set_setting_value(
        &conn,
        "log_successful_operations",
        if log_successful_operations { "1" } else { "0" },
    )
    .map_err(|error| error.to_string())?;
    set_setting_value(
        &conn,
        "filter_presets",
        &serde_json::to_string(&filter_presets).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let summary = format!(
        "Saved settings: {} file types, default {} thumbnails, {} items per page, {} filter presets, history {}",
        selected_extensions.len(),
        default_thumbnail_size,
        default_library_page_size,
        filter_presets.len(),
        history_retention_count
    );
    record_operation(&conn, "settings_save", "success", &summary, None)
        .map_err(|error| error.to_string())?;

    read_app_settings(&conn, &db_path)
}

#[tauri::command]
fn find_duplicates(state: State<'_, AppState>) -> Result<DuplicateScanResponse, String> {
    let db_path = state
        .db_path
        .lock()
        .map_err(|_| "Database state is unavailable".to_string())?
        .clone();
    let conn = Connection::open(db_path).map_err(|error| error.to_string())?;
    init_db(&conn).map_err(|error| error.to_string())?;

    let mut statement = conn
        .prepare(
            "SELECT id, path, file_size_bytes, COALESCE(file_hash, '')
             FROM media_files
             WHERE missing = 0
               AND file_size_bytes IN (
                 SELECT file_size_bytes
                 FROM media_files
                 WHERE missing = 0
                 GROUP BY file_size_bytes
                 HAVING COUNT(*) > 1
               )
             ORDER BY file_size_bytes DESC, path ASC",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|error| error.to_string())?;

    let candidates = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    let mut grouped_file_ids: HashMap<(i64, String), Vec<i64>> = HashMap::new();
    let mut hashed_files = 0usize;

    for (file_id, path, file_size_bytes, stored_hash) in candidates {
        let hash = if stored_hash.is_empty() {
            let computed = compute_file_hash(Path::new(&path))
                .map_err(|error| format!("{path}: {error}"))?;
            conn.execute(
                "UPDATE media_files
                 SET file_hash = ?1, hash_updated_at_unix = ?2
                 WHERE id = ?3",
                params![computed, unix_now(), file_id],
            )
            .map_err(|error| error.to_string())?;
            hashed_files += 1;
            computed
        } else {
            stored_hash
        };

        grouped_file_ids
            .entry((file_size_bytes, hash))
            .or_default()
            .push(file_id);
    }

    let mut groups = Vec::new();
    for ((file_size_bytes, hash), file_ids) in grouped_file_ids {
        if file_ids.len() < 2 {
            continue;
        }

        let mut items = Vec::with_capacity(file_ids.len());
        for file_id in file_ids {
            items.push(query_media_file(&conn, file_id)?);
        }

        items.sort_by(|left, right| left.path.cmp(&right.path));
        let wasted_size_bytes = file_size_bytes * (items.len() as i64 - 1);
        groups.push(DuplicateGroup {
            key: format!("{hash}:{file_size_bytes}"),
            hash,
            file_count: items.len(),
            wasted_size_bytes,
            wasted_size_mb: round_mb(wasted_size_bytes),
            items,
        });
    }

    groups.sort_by(|left, right| {
        right
            .wasted_size_bytes
            .cmp(&left.wasted_size_bytes)
            .then_with(|| right.file_count.cmp(&left.file_count))
            .then_with(|| left.key.cmp(&right.key))
    });

    let duplicate_files = groups.iter().map(|group| group.file_count).sum();
    let wasted_size_bytes = groups.iter().map(|group| group.wasted_size_bytes).sum();

    let response = DuplicateScanResponse {
        groups,
        duplicate_files,
        wasted_size_bytes,
        wasted_size_mb: round_mb(wasted_size_bytes),
        hashed_files,
    };
    let summary = if response.groups.is_empty() {
        format!("Duplicate check finished: hashed {} files, no exact duplicates found", response.hashed_files)
    } else {
        format!(
            "Duplicate check finished: {} groups across {} files, {:.1} MB reclaimable",
            response.groups.len(),
            response.duplicate_files,
            response.wasted_size_mb
        )
    };
    record_operation(&conn, "duplicate_scan", "success", &summary, None)
        .map_err(|error| error.to_string())?;
    Ok(response)
}

#[tauri::command]
fn list_operation_history(state: State<'_, AppState>) -> Result<Vec<OperationHistoryEntry>, String> {
    let db_path = state
        .db_path
        .lock()
        .map_err(|_| "Database state is unavailable".to_string())?
        .clone();
    let conn = Connection::open(&db_path).map_err(|error| error.to_string())?;
    init_db(&conn).map_err(|error| error.to_string())?;
    let settings = read_app_settings(&conn, &db_path)?;

    let mut statement = conn
        .prepare(
            "SELECT id, operation_type, status, summary, details, created_at_unix
             FROM operation_history
             ORDER BY created_at_unix DESC, id DESC
             LIMIT ?1",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map(params![settings.history_retention_count], |row| {
            Ok(OperationHistoryEntry {
                id: row.get(0)?,
                operation_type: row.get(1)?,
                status: row.get(2)?,
                summary: row.get(3)?,
                details: row.get(4)?,
                created_at_unix: row.get(5)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn clear_operation_history(state: State<'_, AppState>) -> Result<(), String> {
    let db_path = state
        .db_path
        .lock()
        .map_err(|_| "Database state is unavailable".to_string())?
        .clone();
    let conn = Connection::open(&db_path).map_err(|error| error.to_string())?;
    init_db(&conn).map_err(|error| error.to_string())?;
    conn.execute("DELETE FROM operation_history", [])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn list_scan_roots(state: State<'_, AppState>) -> Result<Vec<ScanRoot>, String> {
    let db_path = state
        .db_path
        .lock()
        .map_err(|_| "Database state is unavailable".to_string())?
        .clone();
    let conn = Connection::open(db_path).map_err(|error| error.to_string())?;
    init_db(&conn).map_err(|error| error.to_string())?;

    let mut statement = conn
        .prepare(
            "SELECT path, enabled, updated_at_unix
             FROM scan_roots
             ORDER BY path ASC",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| {
            Ok(ScanRoot {
                path: row.get(0)?,
                enabled: row.get::<_, i64>(1)? == 1,
                updated_at_unix: row.get(2)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_scan_folders(state: State<'_, AppState>) -> Result<Vec<ScanFolder>, String> {
    let db_path = state
        .db_path
        .lock()
        .map_err(|_| "Database state is unavailable".to_string())?
        .clone();
    let conn = Connection::open(db_path).map_err(|error| error.to_string())?;
    init_db(&conn).map_err(|error| error.to_string())?;

    let mut statement = conn
        .prepare(
            "SELECT path, scan_root, missing, last_seen_scan_id
             FROM scan_folders
             WHERE missing = 0
             ORDER BY scan_root ASC, path ASC",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| {
            Ok(ScanFolder {
                path: row.get(0)?,
                scan_root: row.get(1)?,
                missing: row.get::<_, i64>(2)? == 1,
                last_seen_scan_id: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn read_app_settings(conn: &Connection, db_path: &Path) -> Result<AppSettings, String> {
    let selected_extensions = get_setting_value(conn, "selected_extensions")
        .map_err(|error| error.to_string())?
        .and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
        .map(|value| {
            normalize_extensions(&value)
                .into_iter()
                .collect::<Vec<_>>()
        })
        .filter(|value| !value.is_empty())
        .unwrap_or_else(supported_extensions);

    let default_thumbnail_size = get_setting_value(conn, "default_thumbnail_size")
        .map_err(|error| error.to_string())?
        .map(|value| normalize_thumbnail_size(&value))
        .unwrap_or_else(|| "medium".to_string());

    let default_library_page_size = get_setting_value(conn, "default_library_page_size")
        .map_err(|error| error.to_string())?
        .and_then(|value| value.parse::<i64>().ok())
        .map(normalize_library_page_size)
        .unwrap_or(50);
    let filter_presets = get_setting_value(conn, "filter_presets")
        .map_err(|error| error.to_string())?
        .and_then(|value| serde_json::from_str::<Vec<FilterPreset>>(&value).ok())
        .unwrap_or_default()
        .into_iter()
        .filter_map(normalize_filter_preset)
        .collect::<Vec<_>>();
    let history_retention_count = get_setting_value(conn, "history_retention_count")
        .map_err(|error| error.to_string())?
        .and_then(|value| value.parse::<i64>().ok())
        .map(normalize_history_retention_count)
        .unwrap_or(200);
    let log_report_exports = get_setting_value(conn, "log_report_exports")
        .map_err(|error| error.to_string())?
        .map(|value| value == "1")
        .unwrap_or(true);
    let log_successful_operations = get_setting_value(conn, "log_successful_operations")
        .map_err(|error| error.to_string())?
        .map(|value| value == "1")
        .unwrap_or(true);

    let app_data_dir = db_path
        .parent()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();

    Ok(AppSettings {
        selected_extensions,
        default_thumbnail_size,
        default_library_page_size,
        filter_presets,
        history_retention_count,
        log_report_exports,
        log_successful_operations,
        app_data_dir,
        database_path: db_path.to_string_lossy().to_string(),
        startup_log_path: startup_log_path().to_string_lossy().to_string(),
    })
}

fn init_db(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS scan_roots (
            path TEXT PRIMARY KEY NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            updated_at_unix INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS scan_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at_unix INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS scan_folders (
            path TEXT PRIMARY KEY NOT NULL,
            scan_root TEXT NOT NULL,
            missing INTEGER NOT NULL DEFAULT 0,
            last_seen_scan_id INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS media_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT UNIQUE NOT NULL,
            scan_root TEXT NOT NULL,
            filename TEXT NOT NULL,
            extension TEXT NOT NULL,
            media_type TEXT NOT NULL,
            file_size_bytes INTEGER NOT NULL,
            created_unix INTEGER,
            modified_unix INTEGER,
            date_taken_unix INTEGER,
            date_source TEXT,
            width INTEGER,
            height INTEGER,
            missing INTEGER NOT NULL DEFAULT 0,
            last_seen_scan_id INTEGER NOT NULL,
            scanned_at_unix INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL COLLATE NOCASE,
            created_at_unix INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS file_tags (
            file_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            created_at_unix INTEGER NOT NULL,
            PRIMARY KEY (file_id, tag_id),
            FOREIGN KEY (file_id) REFERENCES media_files(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS operation_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operation_type TEXT NOT NULL,
            status TEXT NOT NULL,
            summary TEXT NOT NULL,
            details TEXT,
            created_at_unix INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_media_scan_root ON media_files(scan_root);
        CREATE INDEX IF NOT EXISTS idx_media_extension ON media_files(extension);
        CREATE INDEX IF NOT EXISTS idx_media_missing ON media_files(missing);
        CREATE INDEX IF NOT EXISTS idx_media_date_taken ON media_files(date_taken_unix);
        CREATE INDEX IF NOT EXISTS idx_file_tags_tag_id ON file_tags(tag_id);
        CREATE INDEX IF NOT EXISTS idx_scan_folders_root ON scan_folders(scan_root);
        CREATE INDEX IF NOT EXISTS idx_operation_history_created_at ON operation_history(created_at_unix DESC);
        ",
    )?;

    ensure_column(conn, "media_files", "file_hash", "TEXT")?;
    ensure_column(conn, "media_files", "hash_updated_at_unix", "INTEGER")?;
    Ok(())
}

fn normalize_filter_preset(preset: FilterPreset) -> Option<FilterPreset> {
    let name = preset.name.trim().to_string();
    if name.is_empty() {
        return None;
    }

    Some(FilterPreset {
        name,
        media_type_filter: match preset.media_type_filter.as_str() {
            "image" | "video" => preset.media_type_filter,
            _ => "all".to_string(),
        },
        extension_filter: if preset.extension_filter.trim().is_empty() {
            "all".to_string()
        } else {
            preset.extension_filter.trim().to_lowercase()
        },
        missing_filter_mode: match preset.missing_filter_mode.as_str() {
            "include" | "only" => preset.missing_filter_mode,
            _ => "hide".to_string(),
        },
        tag_filter_input: preset.tag_filter_input.trim().to_string(),
        tag_match_mode: match preset.tag_match_mode.as_str() {
            "all" => "all".to_string(),
            _ => "any".to_string(),
        },
        date_from_input: preset.date_from_input.trim().to_string(),
        date_to_input: preset.date_to_input.trim().to_string(),
        min_file_size_mb: preset.min_file_size_mb.trim().to_string(),
        max_file_size_mb: preset.max_file_size_mb.trim().to_string(),
        min_megapixels: preset.min_megapixels.trim().to_string(),
        max_megapixels: preset.max_megapixels.trim().to_string(),
        date_source_filter: match preset.date_source_filter.as_str() {
            "metadata" | "filesystem-created" | "filesystem-modified" | "unknown" => {
                preset.date_source_filter
            }
            _ => "all".to_string(),
        },
        selected_tag_filter: preset
            .selected_tag_filter
            .and_then(|value| {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            }),
    })
}

fn cache_scan_folder(
    conn: &Connection,
    path: &Path,
    scan_root: &str,
    scan_run_id: i64,
) -> rusqlite::Result<()> {
    let path_string = path.to_string_lossy().to_string();
    conn.execute(
        "INSERT INTO scan_folders (path, scan_root, missing, last_seen_scan_id)
         VALUES (?1, ?2, 0, ?3)
         ON CONFLICT(path) DO UPDATE SET
            scan_root = excluded.scan_root,
            missing = 0,
            last_seen_scan_id = excluded.last_seen_scan_id",
        params![path_string, scan_root, scan_run_id],
    )?;
    Ok(())
}

fn query_tags(conn: &Connection) -> Result<Vec<TagSummary>, String> {
    let mut statement = conn
        .prepare(
            "SELECT tags.id, tags.name, COUNT(file_tags.file_id) AS file_count
             FROM tags
             LEFT JOIN file_tags ON file_tags.tag_id = tags.id
             GROUP BY tags.id, tags.name
             ORDER BY tags.name COLLATE NOCASE ASC",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| {
            Ok(TagSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                file_count: row.get(2)?,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn record_operation(
    conn: &Connection,
    operation_type: &str,
    status: &str,
    summary: &str,
    details: Option<&str>,
) -> rusqlite::Result<()> {
    let log_successful_operations = get_setting_value(conn, "log_successful_operations")
        .ok()
        .flatten()
        .map(|value| value == "1")
        .unwrap_or(true);
    if status == "success" && !log_successful_operations {
        return Ok(());
    }

    conn.execute(
        "INSERT INTO operation_history (operation_type, status, summary, details, created_at_unix)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![operation_type, status, summary, details, unix_now()],
    )?;
    trim_operation_history(conn)?;
    Ok(())
}

fn trim_operation_history(conn: &Connection) -> rusqlite::Result<()> {
    let retention = get_setting_value(conn, "history_retention_count")
        .ok()
        .flatten()
        .and_then(|value| value.parse::<i64>().ok())
        .map(normalize_history_retention_count)
        .unwrap_or(200);
    conn.execute(
        "DELETE FROM operation_history
         WHERE id NOT IN (
             SELECT id FROM operation_history
             ORDER BY created_at_unix DESC, id DESC
             LIMIT ?1
         )",
        params![retention],
    )?;
    Ok(())
}

fn mark_media_file_missing(conn: &Connection, path: &Path) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE media_files
         SET missing = 1, scanned_at_unix = ?2
         WHERE path = ?1",
        params![path.to_string_lossy().to_string(), unix_now()],
    )?;
    Ok(())
}

fn compose_error_details(errors: &[String]) -> String {
    if errors.is_empty() {
        return String::new();
    }

    let mut details = errors.iter().take(5).cloned().collect::<Vec<_>>().join(" | ");
    if errors.len() > 5 {
        details.push_str(&format!(" | +{} more", errors.len() - 5));
    }
    details
}

fn query_tags_for_file(conn: &Connection, file_id: i64) -> Result<Vec<String>, String> {
    let mut statement = conn
        .prepare(
            "SELECT tags.name
             FROM tags
             INNER JOIN file_tags ON file_tags.tag_id = tags.id
             WHERE file_tags.file_id = ?1
             ORDER BY tags.name COLLATE NOCASE ASC",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map(params![file_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn query_media_file(conn: &Connection, file_id: i64) -> Result<MediaFile, String> {
    let mut statement = conn
        .prepare(
            "SELECT id, path, scan_root, filename, extension, media_type, file_size_bytes,
                    created_unix, modified_unix, date_taken_unix, date_source,
                    width, height, missing, scanned_at_unix
             FROM media_files
             WHERE id = ?1",
        )
        .map_err(|error| error.to_string())?;

    let mut file = statement
        .query_row(params![file_id], |row| map_media_row(row))
        .map_err(|error| error.to_string())?;
    file.tags = query_tags_for_file(conn, file.id)?;
    Ok(file)
}

fn cache_media_file(
    conn: &Connection,
    path: &Path,
    scan_root: &str,
    scan_run_id: i64,
    scanned_at: i64,
    force_rescan: bool,
) -> rusqlite::Result<bool> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) => return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(error))),
    };

    let path_string = path.to_string_lossy().to_string();
    let file_size_bytes = metadata.len() as i64;
    let modified_unix = metadata.modified().ok().and_then(system_time_to_unix);
    let existing = conn
        .query_row(
            "SELECT file_size_bytes, modified_unix FROM media_files WHERE path = ?1",
            params![path_string],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<i64>>(1)?)),
        )
        .optional()?;

    if !force_rescan && existing == Some((file_size_bytes, modified_unix)) {
        conn.execute(
            "UPDATE media_files
             SET missing = 0, last_seen_scan_id = ?1, scanned_at_unix = ?2
             WHERE path = ?3",
            params![scan_run_id, scanned_at, path_string],
        )?;
        return Ok(false);
    }

    let filename = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_string();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    let created_unix = metadata.created().ok().and_then(system_time_to_unix);
    let filename_date_unix = parse_filename_timestamp(&filename);
    let (date_taken_unix, date_source) = if filename_date_unix.is_some() {
        (filename_date_unix, Some("filename timestamp".to_string()))
    } else if created_unix.is_some() {
        (created_unix, Some("filesystem created".to_string()))
    } else {
        (modified_unix, Some("filesystem modified".to_string()))
    };
    let (width, height) = image::image_dimensions(path)
        .map(|(width, height)| (Some(width as i64), Some(height as i64)))
        .unwrap_or((None, None));

    conn.execute(
        "INSERT INTO media_files (
            path, scan_root, filename, extension, media_type, file_size_bytes,
            created_unix, modified_unix, date_taken_unix, date_source,
            width, height, missing, last_seen_scan_id, scanned_at_unix, file_hash, hash_updated_at_unix
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0, ?13, ?14, NULL, NULL)
         ON CONFLICT(path) DO UPDATE SET
            scan_root = excluded.scan_root,
            filename = excluded.filename,
            extension = excluded.extension,
            media_type = excluded.media_type,
            file_size_bytes = excluded.file_size_bytes,
            created_unix = excluded.created_unix,
            modified_unix = excluded.modified_unix,
            date_taken_unix = excluded.date_taken_unix,
            date_source = excluded.date_source,
            width = excluded.width,
            height = excluded.height,
            file_hash = NULL,
            hash_updated_at_unix = NULL,
            missing = 0,
            last_seen_scan_id = excluded.last_seen_scan_id,
            scanned_at_unix = excluded.scanned_at_unix",
        params![
            path_string,
            scan_root,
            filename,
            extension,
            media_type(&extension),
            file_size_bytes,
            created_unix,
            modified_unix,
            date_taken_unix,
            date_source,
            width,
            height,
            scan_run_id,
            scanned_at
        ],
    )?;

    Ok(true)
}

fn normalize_extensions(extensions: &[String]) -> HashSet<String> {
    let source = if extensions.is_empty() {
        supported_extensions()
    } else {
        extensions.to_vec()
    };

    source
        .into_iter()
        .map(|extension| {
            extension
                .trim()
                .trim_start_matches('.')
                .to_ascii_lowercase()
        })
        .filter(|extension| !extension.is_empty())
        .collect()
}

fn compute_file_hash(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 8192];

    loop {
        let bytes_read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

fn media_type(extension: &str) -> &'static str {
    match extension {
        "jpg" | "jpeg" | "png" | "gif" | "bmp" | "tif" | "tiff" | "webp" | "heic" | "heif" => {
            "image"
        }
        "mov" | "m4v" | "mp4" | "avi" | "mkv" | "mpg" | "mpeg" | "webm" => "video",
        "dng" | "nef" | "nrw" | "arw" | "srf" | "sr2" | "cr2" | "cr3" | "raf" | "orf"
        | "rw2" | "pef" => "raw",
        _ => "media",
    }
}

fn map_media_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<MediaFile> {
    let file_size_bytes: i64 = row.get(6)?;
    let width: Option<i64> = row.get(11)?;
    let height: Option<i64> = row.get(12)?;
    let megapixels = width
        .zip(height)
        .map(|(width, height)| ((width * height) as f64 / 1_000_000.0 * 10.0).round() / 10.0);

    Ok(MediaFile {
        id: row.get(0)?,
        path: row.get(1)?,
        scan_root: row.get(2)?,
        filename: row.get(3)?,
        extension: row.get(4)?,
        media_type: row.get(5)?,
        file_size_bytes,
        file_size_mb: round_mb(file_size_bytes),
        created_unix: row.get(7)?,
        modified_unix: row.get(8)?,
        date_taken_unix: row.get(9)?,
        date_source: row.get(10)?,
        width,
        height,
        megapixels,
        missing: row.get::<_, i64>(13)? == 1,
        scanned_at_unix: row.get(14)?,
        tags: Vec::new(),
    })
}

fn list_media_count(conn: &Connection) -> rusqlite::Result<usize> {
    conn.query_row("SELECT COUNT(*) FROM media_files", [], |row| {
        row.get::<_, i64>(0)
    })
    .map(|count| count as usize)
}

fn missing_media_count(conn: &Connection) -> rusqlite::Result<usize> {
    conn.query_row(
        "SELECT COUNT(*) FROM media_files WHERE missing = 1",
        [],
        |row| row.get::<_, i64>(0),
    )
    .map(|count| count as usize)
}

fn ensure_column(
    conn: &Connection,
    table_name: &str,
    column_name: &str,
    column_definition: &str,
) -> rusqlite::Result<()> {
    let mut statement = conn.prepare(&format!("PRAGMA table_info({table_name})"))?;
    let rows = statement.query_map([], |row| row.get::<_, String>(1))?;
    let column_names = rows.collect::<Result<Vec<_>, _>>()?;

    if !column_names.iter().any(|name| name == column_name) {
        conn.execute(
            &format!("ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}"),
            [],
        )?;
    }

    Ok(())
}

fn get_setting_value(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT value FROM app_settings WHERE key = ?1",
        params![key],
        |row| row.get::<_, String>(0),
    )
    .optional()
}

fn set_setting_value(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO app_settings (key, value)
         VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

fn normalize_thumbnail_size(value: &str) -> String {
    match value {
        "small" | "medium" | "large" => value.to_string(),
        _ => "medium".to_string(),
    }
}

fn normalize_library_page_size(value: i64) -> i64 {
    match value {
        25 | 50 | 100 | 200 => value,
        _ => 50,
    }
}

fn normalize_history_retention_count(value: i64) -> i64 {
    value.clamp(25, 1000)
}

fn normalize_collision_policy(value: &str) -> String {
    match value {
        "rename" => "rename".to_string(),
        _ => "skip".to_string(),
    }
}

fn next_available_destination_path(path: &Path) -> Result<PathBuf, std::io::Error> {
    if !path.exists() {
        return Ok(path.to_path_buf());
    }

    let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("");

    for index in 1..10_000 {
        let candidate_name = if extension.is_empty() {
            format!("{stem} ({index})")
        } else {
            format!("{stem} ({index}).{extension}")
        };
        let candidate_path = parent.join(candidate_name);
        if !candidate_path.exists() {
            return Ok(candidate_path);
        }
    }

    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        format!("Unable to find an available destination name for {}", path.display()),
    ))
}

fn round_mb(bytes: i64) -> f64 {
    (bytes as f64 / 1_048_576.0 * 10.0).round() / 10.0
}

fn system_time_to_unix(time: SystemTime) -> Option<i64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs() as i64)
}

fn parse_filename_timestamp(filename: &str) -> Option<i64> {
    let stem = Path::new(filename)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or(filename);
    let digits = stem
        .chars()
        .filter(|character| character.is_ascii_digit())
        .collect::<String>();
    if digits.len() < 14 {
        return None;
    }

    for start in 0..=digits.len().saturating_sub(14) {
        let candidate = &digits[start..start + 14];
        let year = candidate[0..4].parse::<i32>().ok()?;
        let month = candidate[4..6].parse::<u32>().ok()?;
        let day = candidate[6..8].parse::<u32>().ok()?;
        let hour = candidate[8..10].parse::<u32>().ok()?;
        let minute = candidate[10..12].parse::<u32>().ok()?;
        let second = candidate[12..14].parse::<u32>().ok()?;

        if !(1900..=2100).contains(&year)
            || !(1..=12).contains(&month)
            || !(1..=31).contains(&day)
            || hour > 23
            || minute > 59
            || second > 59
        {
            continue;
        }

        let days = days_from_civil(year, month, day)?;
        return Some(days * 86_400 + hour as i64 * 3_600 + minute as i64 * 60 + second as i64);
    }

    None
}

fn days_from_civil(year: i32, month: u32, day: u32) -> Option<i64> {
    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap_year(year) => 29,
        2 => 28,
        _ => return None,
    };
    if day == 0 || day > max_day {
        return None;
    }

    let adjusted_year = year - if month <= 2 { 1 } else { 0 };
    let era = if adjusted_year >= 0 {
        adjusted_year / 400
    } else {
        (adjusted_year - 399) / 400
    };
    let year_of_era = adjusted_year - era * 400;
    let month_index = month as i32;
    let day_of_year = (153 * (month_index + if month_index > 2 { -3 } else { 9 }) + 2) / 5 + day as i32 - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    Some((era * 146_097 + day_of_era - 719_468) as i64)
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

fn unix_now() -> i64 {
    system_time_to_unix(SystemTime::now()).unwrap_or_default()
}

fn startup_log_path() -> PathBuf {
    let base = dirs::data_local_dir()
        .or_else(dirs::cache_dir)
        .unwrap_or_else(std::env::temp_dir);
    base.join("MediaTagger").join("startup.log")
}

fn write_startup_log(message: &str) {
    let path = startup_log_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "[{}] {message}", unix_now());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    std::panic::set_hook(Box::new(|panic_info| {
        write_startup_log(&format!("panic: {panic_info}"));
    }));
    write_startup_log("run() entered");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            write_startup_log("setup() started");
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| Box::<dyn std::error::Error>::from(error))?;
            write_startup_log(&format!("app data dir: {}", app_data_dir.display()));
            fs::create_dir_all(&app_data_dir)?;
            let db_path = app_data_dir.join("mediatagger.sqlite3");
            write_startup_log(&format!("db path: {}", db_path.display()));
            let conn = Connection::open(&db_path)?;
            init_db(&conn)?;
            app.manage(AppState {
                db_path: Mutex::new(db_path),
            });
            write_startup_log("setup() completed");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            health_check,
            supported_extensions,
            scan_media,
            open_file_path,
            open_file_location,
            save_text_report,
            execute_move_copy,
            get_app_settings,
            save_app_settings,
            list_media,
            list_scan_roots,
            list_scan_folders,
            list_tags,
            apply_tags,
            remove_tag_from_files,
            find_duplicates,
            list_operation_history,
            clear_operation_history,
            cleanup_duplicates
        ])
        .on_window_event(|_window, event| {
            write_startup_log(&format!("window event: {event:?}"));
        })
        .run(tauri::generate_context!())
        .expect("error while running MediaTagger");
}
