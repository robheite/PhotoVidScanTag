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
