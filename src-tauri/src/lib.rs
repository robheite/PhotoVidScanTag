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
fn save_text_report(path: String, contents: String) -> Result<(), String> {
    let report_path = PathBuf::from(&path);
    if let Some(parent) = report_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    fs::write(report_path, contents).map_err(|error| error.to_string())
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

    Ok(DuplicateScanResponse {
        groups,
        duplicate_files,
        wasted_size_bytes,
        wasted_size_mb: round_mb(wasted_size_bytes),
        hashed_files,
    })
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

fn init_db(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "
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

        CREATE INDEX IF NOT EXISTS idx_media_scan_root ON media_files(scan_root);
        CREATE INDEX IF NOT EXISTS idx_media_extension ON media_files(extension);
        CREATE INDEX IF NOT EXISTS idx_media_missing ON media_files(missing);
        CREATE INDEX IF NOT EXISTS idx_media_date_taken ON media_files(date_taken_unix);
        CREATE INDEX IF NOT EXISTS idx_file_tags_tag_id ON file_tags(tag_id);
        CREATE INDEX IF NOT EXISTS idx_scan_folders_root ON scan_folders(scan_root);
        ",
    )?;

    ensure_column(conn, "media_files", "file_hash", "TEXT")?;
    ensure_column(conn, "media_files", "hash_updated_at_unix", "INTEGER")?;
    Ok(())
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
    let (date_taken_unix, date_source) = if created_unix.is_some() {
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

fn round_mb(bytes: i64) -> f64 {
    (bytes as f64 / 1_048_576.0 * 10.0).round() / 10.0
}

fn system_time_to_unix(time: SystemTime) -> Option<i64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs() as i64)
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
            list_media,
            list_scan_roots,
            list_scan_folders,
            list_tags,
            apply_tags,
            remove_tag_from_files,
            find_duplicates
        ])
        .on_window_event(|_window, event| {
            write_startup_log(&format!("window event: {event:?}"));
        })
        .run(tauri::generate_context!())
        .expect("error while running MediaTagger");
}
