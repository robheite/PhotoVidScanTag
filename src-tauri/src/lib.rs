use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
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

#[derive(Debug, Serialize)]
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

        for entry in WalkDir::new(&root_path).follow_links(false).into_iter() {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    response.errors.push(error.to_string());
                    continue;
                }
            };

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

            match cache_media_file(&conn, path, &root_string, scan_run_id, started_at) {
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
        .query_map([], |row| {
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
                file_size_mb: (file_size_bytes as f64 / 1_048_576.0 * 10.0).round() / 10.0,
                created_unix: row.get(7)?,
                modified_unix: row.get(8)?,
                date_taken_unix: row.get(9)?,
                date_source: row.get(10)?,
                width,
                height,
                megapixels,
                missing: row.get::<_, i64>(13)? == 1,
                scanned_at_unix: row.get(14)?,
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

        CREATE INDEX IF NOT EXISTS idx_media_scan_root ON media_files(scan_root);
        CREATE INDEX IF NOT EXISTS idx_media_extension ON media_files(extension);
        CREATE INDEX IF NOT EXISTS idx_media_missing ON media_files(missing);
        CREATE INDEX IF NOT EXISTS idx_media_date_taken ON media_files(date_taken_unix);
        ",
    )
}

fn cache_media_file(
    conn: &Connection,
    path: &Path,
    scan_root: &str,
    scan_run_id: i64,
    scanned_at: i64,
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

    if existing == Some((file_size_bytes, modified_unix)) {
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
            width, height, missing, last_seen_scan_id, scanned_at_unix
         )
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0, ?13, ?14)
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

fn list_media_count(conn: &Connection) -> rusqlite::Result<usize> {
    conn.query_row("SELECT COUNT(*) FROM media_files", [], |row| row.get::<_, i64>(0))
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

fn system_time_to_unix(time: SystemTime) -> Option<i64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs() as i64)
}

fn unix_now() -> i64 {
    system_time_to_unix(SystemTime::now()).unwrap_or_default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| Box::<dyn std::error::Error>::from(error))?;
            fs::create_dir_all(&app_data_dir)?;
            let db_path = app_data_dir.join("mediatagger.sqlite3");
            let conn = Connection::open(&db_path)?;
            init_db(&conn)?;
            app.manage(AppState {
                db_path: Mutex::new(db_path),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            health_check,
            supported_extensions,
            scan_media,
            list_media
        ])
        .run(tauri::generate_context!())
        .expect("error while running MediaTagger");
}
