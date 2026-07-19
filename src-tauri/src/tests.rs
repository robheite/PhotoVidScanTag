use super::*;

fn unique_temp_dir(label: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock should be after Unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("mediatagger-{label}-{}-{nonce}", std::process::id()))
}

#[test]
fn video_preview_ignores_unsupported_extensions() {
    let root = unique_temp_dir("unsupported-video");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("notes.txt");
    fs::write(&source, b"not video").unwrap();

    let result = build_native_video_preview(&source, &root.join("app.db"), 512);
    assert_eq!(result.unwrap(), None);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn video_preview_reports_empty_files_before_launching_native_tools() {
    let root = unique_temp_dir("empty-video");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("empty.mp4");
    fs::write(&source, []).unwrap();

    let error = build_native_video_preview(&source, &root.join("app.db"), 512).unwrap_err();
    assert_eq!(error, "Video preview source is empty");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn preview_cache_key_changes_with_dimension_and_file_contents() {
    let root = unique_temp_dir("cache-key");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("clip.mp4");
    let db_path = root.join("database.sqlite");
    fs::write(&source, b"first").unwrap();

    let initial = native_preview_cache_path(&db_path, &source, 512, "png").unwrap();
    let resized = native_preview_cache_path(&db_path, &source, 1024, "png").unwrap();
    assert_ne!(initial, resized);

    fs::write(&source, b"different-length").unwrap();
    let changed = native_preview_cache_path(&db_path, &source, 512, "png").unwrap();
    assert_ne!(initial, changed);
    assert_eq!(initial.parent(), Some(preview_cache_dir(&db_path).as_path()));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn image_preview_ignores_files_handled_directly_by_webview() {
    let root = unique_temp_dir("direct-image");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("photo.jpg");
    fs::write(&source, b"not decoded because jpg is direct").unwrap();

    let result = build_native_image_preview(&source, &root.join("app.db"), 512);
    assert_eq!(result.unwrap(), None);

    fs::remove_dir_all(root).unwrap();
}

#[test]
#[cfg(target_os = "macos")]
fn playback_proxy_rejects_empty_sources_before_conversion() {
    let root = unique_temp_dir("empty-playback-proxy");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("empty.mov");
    fs::write(&source, []).unwrap();

    let error = build_video_playback_proxy(&source, &root.join("app.db")).unwrap_err();
    assert_eq!(error, "The source video is empty or incomplete");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn playback_proxy_cache_key_changes_when_source_changes() {
    let root = unique_temp_dir("playback-cache-key");
    fs::create_dir_all(&root).unwrap();
    let source = root.join("clip.mov");
    let db_path = root.join("database.sqlite");
    fs::write(&source, b"first").unwrap();

    let initial = playback_proxy_cache_path(&db_path, &source).unwrap();
    let repeated = playback_proxy_cache_path(&db_path, &source).unwrap();
    assert_eq!(initial, repeated);
    assert_eq!(initial.parent(), Some(playback_cache_dir(&db_path).as_path()));

    fs::write(&source, b"different-length").unwrap();
    let changed = playback_proxy_cache_path(&db_path, &source).unwrap();
    assert_ne!(initial, changed);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn parses_avconvert_progress_and_rejects_noise() {
    assert_eq!(parse_avconvert_progress("avconvert progress:  42.50% complete"), Some(42.5));
    assert_eq!(parse_avconvert_progress("avconvert progress:  125.00% complete"), Some(100.0));
    assert_eq!(parse_avconvert_progress("conversion started"), None);
}

#[test]
fn playback_cache_stats_and_clear_stay_inside_owned_files() {
    let root = unique_temp_dir("playback-cache-safety");
    let db_path = root.join("database.sqlite");
    let cache = playback_cache_dir(&db_path);
    fs::create_dir_all(cache.join("nested")).unwrap();
    fs::write(cache.join("ready.m4v"), b"ready").unwrap();
    fs::write(cache.join("job.partial.m4v"), b"partial").unwrap();
    fs::write(cache.join("keep.txt"), b"keep").unwrap();
    fs::write(cache.join("nested").join("nested.m4v"), b"nested").unwrap();

    let stats = playback_cache_stats(&db_path, 2).unwrap();
    assert_eq!(stats.file_count, 1);
    assert_eq!(stats.total_bytes, 5);
    assert_eq!(stats.active_jobs, 2);

    let cleared = clear_playback_cache_files(&db_path).unwrap();
    assert_eq!(cleared.files_removed, 2);
    assert_eq!(cleared.bytes_freed, 12);
    assert!(cache.join("keep.txt").exists());
    assert!(cache.join("nested").join("nested.m4v").exists());

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn scan_classifies_empty_media_and_repairs_it_when_content_arrives() {
    let root = unique_temp_dir("empty-classification");
    fs::create_dir_all(&root).unwrap();
    let db_path = root.join("database.sqlite");
    let source = root.join("empty.mp4");
    fs::write(&source, []).unwrap();
    let conn = Connection::open(&db_path).unwrap();
    init_db(&conn).unwrap();
    let mut index = HashMap::new();

    cache_media_file(&conn, &mut index, &source, &root.to_string_lossy(), 1, 1, false).unwrap();
    let (status, issue): (String, Option<String>) = conn
        .query_row(
            "SELECT content_status, content_issue FROM media_files WHERE path = ?1",
            params![source.to_string_lossy().to_string()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(status, "empty");
    assert!(issue.unwrap().contains("0 bytes"));

    fs::write(&source, b"media content").unwrap();
    cache_media_file(&conn, &mut index, &source, &root.to_string_lossy(), 2, 2, false).unwrap();
    let (status, issue): (String, Option<String>) = conn
        .query_row(
            "SELECT content_status, content_issue FROM media_files WHERE path = ?1",
            params![source.to_string_lossy().to_string()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(status, "available");
    assert_eq!(issue, None);

    drop(conn);
    fs::remove_dir_all(root).unwrap();
}
