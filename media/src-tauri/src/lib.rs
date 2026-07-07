mod core;

use core::bins::{self, BinState, BinStatusEntry};
use core::convert as conv;
use core::db;
use core::indexer::{self, FileEntry, IndexProgress, IndexSummary};
use core::search::{self, SearchOptions, SearchResult};
use core::system;
use core::youtube::{self, YoutubeResult};

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::RwLock;
use notify::{EventKind, RecursiveMode, Watcher};
use notify::event::{ModifyKind, RenameMode};

// ── AppState ──────────────────────────────────────────────────────────────────

pub struct AppState {
    pub app_dir:      PathBuf,
    pub log_path:     PathBuf,
    pub settings_path: PathBuf,
    pub entries:      RwLock<Vec<FileEntry>>,
    pub current_dirs: RwLock<Vec<String>>,
    pub current_excl: RwLock<Vec<String>>,
    pub last_summary: RwLock<Option<IndexSummary>>,
    pub scanning:     AtomicBool,
    pub db:           Mutex<Option<rusqlite::Connection>>,
    // bins
    pub bins_status:  Mutex<Vec<BinStatusEntry>>,
    pub bins_ready:   Mutex<Option<HashMap<String, String>>>,
    // downloads & converts
    pub dl_audio:     Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub dl_video:     Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub cvt_cancel:   Mutex<HashMap<String, Arc<AtomicBool>>>,
    // file watch (individual files for settings editor etc.)
    pub file_watch:   Mutex<HashMap<String, Arc<AtomicBool>>>,
    // directory watcher (notify-based, kept alive as long as watcher is active)
    pub dir_watcher:  Mutex<Option<notify::RecommendedWatcher>>,
}

impl AppState {
    pub fn log(&self, msg: &str) {
        system::log(&self.log_path, msg);
    }
}

type AS<'r> = State<'r, Arc<AppState>>;

// ── helpers ───────────────────────────────────────────────────────────────────

fn with_db<T, F: FnOnce(&rusqlite::Connection) -> T>(state: &AppState, f: F) -> Option<T> {
    state.db.lock().ok().and_then(|g| g.as_ref().map(f))
}

fn start_dir_watch(
    dirs:    Vec<String>,
    exclude: globset::GlobSet,
    state:   Arc<AppState>,
    app:     AppHandle,
) {
    // Drop previous watcher before creating a new one
    *state.dir_watcher.lock().unwrap() = None;
    if dirs.is_empty() { return; }

    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher = match notify::RecommendedWatcher::new(tx, notify::Config::default()) {
        Ok(w)  => w,
        Err(_) => return,
    };
    for dir in &dirs {
        let _ = watcher.watch(std::path::Path::new(dir), RecursiveMode::Recursive);
    }
    *state.dir_watcher.lock().unwrap() = Some(watcher);

    std::thread::spawn(move || {
        for res in rx {
            let Ok(event) = res else { continue };

            let is_add = matches!(&event.kind,
                EventKind::Create(_) |
                EventKind::Modify(ModifyKind::Name(RenameMode::To))
            );
            let is_remove = matches!(&event.kind,
                EventKind::Remove(_) |
                EventKind::Modify(ModifyKind::Name(RenameMode::From))
            );

            for path in &event.paths {
                if is_add {
                    if !path.is_file() { continue; }
                    let rel = dirs.iter()
                        .find_map(|d| path.strip_prefix(d).ok())
                        .map(|r| indexer::to_posix(&r.to_string_lossy()))
                        .unwrap_or_default();
                    if exclude.is_match(&rel) { continue; }

                    if let Some(entry) = indexer::entry_from_path(path) {
                        { let g = state.db.lock().unwrap(); if let Some(c) = g.as_ref() { let _ = db::upsert_entry(c, &entry); } }
                        let mut entries = state.entries.blocking_write();
                        match entries.iter_mut().find(|e| e.full_path == entry.full_path) {
                            Some(e) => *e = entry.clone(),
                            None    => entries.push(entry.clone()),
                        }
                        let _ = app.emit("index:changed", serde_json::json!({ "added": entry.full_path }));
                    }
                } else if is_remove {
                    let path_str = path.to_string_lossy().to_string();
                    { let g = state.db.lock().unwrap(); if let Some(c) = g.as_ref() { let _ = db::delete_entry(c, &path_str); } }
                    state.entries.blocking_write().retain(|e| e.full_path != path_str);
                    let _ = app.emit("index:changed", serde_json::json!({ "removed": path_str }));
                }
            }
        }
    });
}

// ── commands: settings ────────────────────────────────────────────────────────

#[tauri::command]
async fn settings_status(state: AS<'_>) -> Result<serde_json::Value, String> {
    let path = state.settings_path.to_string_lossy().into_owned();
    let exists = state.settings_path.exists();
    Ok(serde_json::json!({ "path": path, "exists": exists }))
}

#[tauri::command]
async fn get_settings_path(state: AS<'_>) -> Result<String, String> {
    Ok(state.settings_path.to_string_lossy().into_owned())
}

#[tauri::command]
async fn create_default_settings(state: AS<'_>) -> Result<(), String> {
    std::fs::write(&state.settings_path, system::default_settings_text())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn read_file(path: String) -> Result<serde_json::Value, String> {
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "path": path, "text": text }))
}

#[tauri::command]
async fn write_file(path: String, text: String) -> Result<(), String> {
    std::fs::write(&path, text).map_err(|e| e.to_string())
}

// ── commands: indexing ────────────────────────────────────────────────────────

#[tauri::command]
async fn start_indexing(app: AppHandle, state: AS<'_>) -> Result<IndexSummary, String> {
    if state.scanning.swap(true, Ordering::SeqCst) {
        return Err("already scanning".into());
    }

    let settings = system::read_settings(&state.settings_path);
    let ms = system::load_music_settings(&settings);

    *state.current_dirs.write().await = ms.search_directories.clone();
    *state.current_excl.write().await = ms.exclude.clone();

    let db_path = system::db_path(&state.app_dir, &settings);
    {
        let mut guard = state.db.lock().unwrap();
        if guard.is_none() {
            *guard = Some(db::open_db(&db_path)?);
        }
    }

    let dirs    = ms.search_directories.clone();
    let excl    = ms.exclude.clone();
    let exclude = indexer::build_excluder(&excl);

    let missing: Vec<String> = dirs.iter()
        .filter(|d| !std::path::Path::new(d).exists())
        .cloned().collect();

    // Clear in-memory entries; dirs become searchable one-by-one as they complete
    state.entries.write().await.clear();

    let state_clone = Arc::clone(&state);
    let app_clone   = app.clone();
    let excl_clone  = exclude.clone();

    let handle = tokio::task::spawn_blocking(move || {
        let mut total_scanned  = 0u64;
        let mut total_excluded = 0u64;

        for root in &dirs {
            if !std::path::Path::new(root).exists() { continue; }

            // Load existing path→mtime map for incremental comparison
            let existing = {
                let g = state_clone.db.lock().unwrap();
                g.as_ref().map(|c| db::load_modified_for_dir(c, root)).unwrap_or_default()
            };

            let mut new_entries:   Vec<FileEntry> = vec![];
            let mut deleted_paths: Vec<String>    = vec![];

            let on_progress = {
                let app = app_clone.clone();
                move |p: IndexProgress| { let _ = app.emit("index:progress", &p); }
            };

            let (scanned, excluded) = indexer::scan_dir_incremental(
                root, &excl_clone, &on_progress,
                &existing, &mut new_entries, &mut deleted_paths,
            );
            total_scanned  += scanned;
            total_excluded += excluded;

            // Persist only changes to DB
            {
                let g = state_clone.db.lock().unwrap();
                if let Some(c) = g.as_ref() {
                    if !new_entries.is_empty()   { let _ = db::upsert_entries(c, &new_entries); }
                    if !deleted_paths.is_empty() { let _ = db::delete_entries_batch(c, &deleted_paths); }
                }
            }

            // Load final state for this dir from DB and make it searchable
            let dir_entries = {
                let g = state_clone.db.lock().unwrap();
                g.as_ref().map(|c| db::load_entries_for_dir(c, root)).unwrap_or_default()
            };
            state_clone.entries.blocking_write().extend(dir_entries);
        }

        let indexed = state_clone.entries.blocking_read().len() as u64;
        IndexSummary { scanned: total_scanned, indexed, excluded: total_excluded, has_target: !dirs.is_empty(), missing }
    });

    let summary = handle.await.map_err(|e| e.to_string())?;
    *state.last_summary.write().await = Some(summary.clone());
    state.scanning.store(false, Ordering::SeqCst);

    with_db(&state, |c| { let _ = db::save_summary(c, &summary); });

    // (Re)start directory watcher for live file add/remove detection
    let watch_dirs = state.current_dirs.read().await.clone();
    let watch_excl = state.current_excl.read().await.clone();
    start_dir_watch(watch_dirs, indexer::build_excluder(&watch_excl), Arc::clone(&state), app.clone());

    let _ = app.emit("index:done", &summary);
    Ok(summary)
}

#[tauri::command]
async fn search_files(
    query: String,
    options: Option<serde_json::Value>,
    state: AS<'_>,
) -> Result<SearchResult, String> {
    let opts: SearchOptions = options
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or(SearchOptions { extensions: None, limit: None, exclude_patterns: None, root_dirs: None });

    let entries: Vec<FileEntry> = state.entries.read().await.clone();
    let dirs:    Vec<String>    = state.current_dirs.read().await.clone();
    let excl:    Vec<String>    = state.current_excl.read().await.clone();

    let mut o = opts;
    if o.root_dirs.is_none()       { o.root_dirs = Some(dirs); }
    if o.exclude_patterns.is_none() { o.exclude_patterns = Some(excl); }

    Ok(search::search_files(&entries, &query, &o))
}

// ── commands: window ──────────────────────────────────────────────────────────

#[tauri::command]
fn close_window(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.close();
    }
}

// ── commands: file ops ────────────────────────────────────────────────────────

#[tauri::command]
fn reveal_file(full_path: String) {
    #[cfg(target_os = "windows")]
    { let _ = std::process::Command::new("explorer").args(["/select,", &full_path]).spawn(); }
}

#[tauri::command]
fn copy_file(_full_path: String) {
    // clipboard.writeText handled on frontend via navigator.clipboard
}

// ── commands: file watching ───────────────────────────────────────────────────

#[tauri::command]
fn watch_file(path: String, app: AppHandle, state: AS<'_>) {
    let cancel = Arc::new(AtomicBool::new(false));
    state.file_watch.lock().unwrap().insert(path.clone(), Arc::clone(&cancel));

    let path_clone = path.clone();
    tauri::async_runtime::spawn(async move {
        let mut last_modified = std::fs::metadata(&path_clone)
            .and_then(|m| m.modified()).ok();
        loop {
            if cancel.load(Ordering::Relaxed) { break; }
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            if cancel.load(Ordering::Relaxed) { break; }
            let current = std::fs::metadata(&path_clone)
                .and_then(|m| m.modified()).ok();
            if current != last_modified {
                last_modified = current;
                let _ = app.emit("file:changed", &path_clone);
            }
        }
    });
}

#[tauri::command]
fn unwatch_file(path: String, state: AS<'_>) {
    if let Some(cancel) = state.file_watch.lock().unwrap().remove(&path) {
        cancel.store(true, Ordering::Relaxed);
    }
}

// ── commands: app state (persistent KV) ──────────────────────────────────────

#[tauri::command]
async fn app_state_get(key: String, state: AS<'_>) -> Result<Option<String>, String> {
    Ok(with_db(&state, |c| db::get_state(c, &key)).flatten())
}

#[tauri::command]
fn app_state_set(key: String, value: String, state: AS<'_>) {
    with_db(&state, |c| { let _ = db::set_state(c, &key, &value); });
}

// ── commands: bins ────────────────────────────────────────────────────────────

#[tauri::command]
async fn get_bins_status(state: AS<'_>) -> Result<Vec<BinStatusEntry>, String> {
    Ok(state.bins_status.lock().unwrap().clone())
}

#[tauri::command]
async fn ensure_bins(app: AppHandle, state: AS<'_>) -> Result<HashMap<String, String>, String> {
    // Return cached result if available
    {
        let guard = state.bins_ready.lock().unwrap();
        if let Some(ref ready) = *guard {
            return Ok(ready.clone());
        }
    }

    let bins_dir = bins::bins_dir(&state.app_dir);
    let app_clone = app.clone();
    let state_clone = Arc::clone(&state);

    let result = bins::ensure_bins(&bins_dir, move |name, state_val, pct| {
        // Update status
        let mut statuses = state_clone.bins_status.lock().unwrap();
        if let Some(entry) = statuses.iter_mut().find(|e| e.name == name) {
            entry.state   = state_val.clone();
            entry.percent = pct;
        }
        // Emit events
        let _ = app_clone.emit("bins:status", serde_json::json!({ "name": name, "state": state_val }));
        if pct > 0 {
            let _ = app_clone.emit("bins:progress", serde_json::json!({ "name": name, "percent": pct }));
        }
    }).await;

    *state.bins_ready.lock().unwrap() = Some(result.clone());
    Ok(result)
}

// ── commands: youtube ─────────────────────────────────────────────────────────

fn ytdlp_path(state: &AppState) -> Option<PathBuf> {
    bins::bin_path(&state.app_dir, "yt-dlp.exe")
}

fn ffmpeg_path(state: &AppState) -> Option<PathBuf> {
    bins::bin_path(&state.app_dir, "ffmpeg.exe")
}

fn mp3val_path(state: &AppState) -> Option<PathBuf> {
    bins::bin_path(&state.app_dir, "mp3val.exe")
}

fn download_dir(state: &AppState) -> PathBuf {
    let settings = system::read_settings(&state.settings_path);
    let ms = system::load_music_settings(&settings);
    system::resolve_download_dir(&state.app_dir, &ms.download_directory)
}

#[tauri::command]
async fn youtube_search(query: String, state: AS<'_>) -> Result<Vec<YoutubeResult>, String> {
    let ytdlp = ytdlp_path(&state).ok_or("yt-dlp not installed")?;
    youtube::search(&ytdlp, &query).await
}

#[tauri::command]
fn youtube_download(url: String, audio_format: String, app: AppHandle, state: AS<'_>) {
    let Some(ytdlp) = ytdlp_path(&state) else { return };
    let out_dir = download_dir(&state);
    let cancel  = Arc::new(AtomicBool::new(false));
    state.dl_audio.lock().unwrap().insert(url.clone(), Arc::clone(&cancel));

    let app2 = app.clone();
    let app3 = app.clone();

    tauri::async_runtime::spawn(async move {
        let u1 = url.clone();
        let u2 = url.clone();
        let u3 = url.clone();
        youtube::download(
            &ytdlp, &u1, &out_dir, &audio_format, cancel,
            move |pct, speed, eta| {
                let _ = app.emit("youtube:progress", serde_json::json!({
                    "url": u2, "percent": pct, "speed": speed, "eta": eta
                }));
            },
            move |file_path| {
                let _ = app2.emit("youtube:done", serde_json::json!({ "url": u3, "filePath": file_path }));
            },
            move |msg| {
                let _ = app3.emit("youtube:error", serde_json::json!({ "url": url, "message": msg }));
            },
        ).await;
    });
}

#[tauri::command]
fn youtube_download_video(url: String, app: AppHandle, state: AS<'_>) {
    let Some(ytdlp) = ytdlp_path(&state) else { return };
    let out_dir = download_dir(&state);
    let cancel  = Arc::new(AtomicBool::new(false));
    state.dl_video.lock().unwrap().insert(url.clone(), Arc::clone(&cancel));

    let app2 = app.clone();
    let app3 = app.clone();

    tauri::async_runtime::spawn(async move {
        let u1 = url.clone();
        let u2 = url.clone();
        let u3 = url.clone();
        youtube::download_video(
            &ytdlp, &u1, &out_dir, cancel,
            move |pct, speed, eta| {
                let _ = app.emit("youtube:progress_video", serde_json::json!({
                    "url": u2, "percent": pct, "speed": speed, "eta": eta
                }));
            },
            move |file_path| {
                let _ = app2.emit("youtube:done_video", serde_json::json!({ "url": u3, "filePath": file_path }));
            },
            move |msg| {
                let _ = app3.emit("youtube:error_video", serde_json::json!({ "url": url, "message": msg }));
            },
        ).await;
    });
}

#[tauri::command]
fn youtube_cancel(url: String, state: AS<'_>) {
    if let Some(c) = state.dl_audio.lock().unwrap().remove(&url) {
        c.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
fn youtube_cancel_video(url: String, state: AS<'_>) {
    if let Some(c) = state.dl_video.lock().unwrap().remove(&url) {
        c.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
fn youtube_open_folder(file_path: String) {
    #[cfg(target_os = "windows")]
    { let _ = std::process::Command::new("explorer").args(["/select,", &file_path]).spawn(); }
}

#[tauri::command]
fn youtube_open_url(url: String) {
    #[cfg(target_os = "windows")]
    { let _ = std::process::Command::new("cmd").args(["/c", "start", "", &url]).spawn(); }
}

// ── commands: convert ─────────────────────────────────────────────────────────

#[tauri::command]
fn convert_scan_folder(dir: String, target_ext: String, app: AppHandle, state: AS<'_>) {
    let mp3val = mp3val_path(&state);
    tauri::async_runtime::spawn(async move {
        conv::scan_folder(
            std::path::Path::new(&dir),
            &target_ext,
            mp3val.as_deref(),
            move |item| { let _ = app.emit("convert:scan_item", &item); },
        ).await;
    });
}

#[tauri::command]
fn convert_start(
    src_path:        String,
    target_fmt:      String,
    delete_original: Option<bool>,
    needs_fix:       Option<bool>,
    fix_message:     Option<String>,
    app:             AppHandle,
    state:           AS<'_>,
) {
    let Some(ffmpeg) = ffmpeg_path(&state) else { return };
    let mp3val = mp3val_path(&state);
    let cancel = Arc::new(AtomicBool::new(false));
    state.cvt_cancel.lock().unwrap().insert(src_path.clone(), Arc::clone(&cancel));

    let src2 = src_path.clone();
    let src3 = src_path.clone();
    let app2 = app.clone();
    let app3 = app.clone();

    tauri::async_runtime::spawn(async move {
        let s0 = src_path.clone();
        let s1 = src_path.clone();
        let s2 = src_path.clone();
        conv::convert(
            &ffmpeg,
            mp3val.as_deref(),
            std::path::Path::new(&s0),
            &target_fmt,
            delete_original.unwrap_or(false),
            needs_fix.unwrap_or(false),
            cancel,
            move |pct| {
                let _ = app.emit("convert:progress", serde_json::json!({ "srcPath": s1, "percent": pct }));
            },
            move |dest| {
                let _ = app2.emit("convert:done", serde_json::json!({ "srcPath": s2, "destPath": dest }));
            },
            move |msg| {
                let _ = app3.emit("convert:error", serde_json::json!({ "srcPath": src_path, "message": msg }));
            },
        ).await;
    });
}

#[tauri::command]
fn convert_cancel(src_path: String, state: AS<'_>) {
    if let Some(c) = state.cvt_cancel.lock().unwrap().remove(&src_path) {
        c.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
fn convert_delete_file(file_path: String, app: AppHandle) -> Result<(), String> {
    std::fs::remove_file(&file_path).map_err(|e| e.to_string())?;
    let _ = app.emit("convert:file_deleted", serde_json::json!({ "path": file_path }));
    Ok(())
}

// ── run ───────────────────────────────────────────────────────────────────────

pub fn run() {
    let app_dir       = system::app_dir();
    let log_path      = system::log_path(&app_dir);
    let settings_path = system::settings_path(&app_dir);

    // Catch panics and write to log before the process dies
    {
        let lp = log_path.clone();
        std::panic::set_hook(Box::new(move |info| {
            system::log(&lp, &format!("PANIC: {}", info));
        }));
    }

    let initial_bins_status: Vec<BinStatusEntry> = bins::BINS.iter().map(|b| BinStatusEntry {
        name:    b.name.to_string(),
        state:   BinState::Pending,
        percent: 0,
    }).collect();

    let state = Arc::new(AppState {
        app_dir:       app_dir.clone(),
        log_path:      log_path.clone(),
        settings_path: settings_path.clone(),
        entries:       RwLock::new(vec![]),
        current_dirs:  RwLock::new(vec![]),
        current_excl:  RwLock::new(vec![]),
        last_summary:  RwLock::new(None),
        scanning:      AtomicBool::new(false),
        db:            Mutex::new(None),
        bins_status:   Mutex::new(initial_bins_status),
        bins_ready:    Mutex::new(None),
        dl_audio:      Mutex::new(HashMap::new()),
        dl_video:      Mutex::new(HashMap::new()),
        cvt_cancel:    Mutex::new(HashMap::new()),
        file_watch:    Mutex::new(HashMap::new()),
        dir_watcher:   Mutex::new(None),
    });

    system::log(&log_path, "family_media starting");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_focus();
            }
        }))
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![
            // window
            close_window,
            // settings
            settings_status,
            get_settings_path,
            create_default_settings,
            read_file,
            write_file,
            // indexing
            start_indexing,
            search_files,
            // file ops
            reveal_file,
            copy_file,
            watch_file,
            unwatch_file,
            // app state
            app_state_get,
            app_state_set,
            // bins
            get_bins_status,
            ensure_bins,
            // youtube
            youtube_search,
            youtube_download,
            youtube_download_video,
            youtube_cancel,
            youtube_cancel_video,
            youtube_open_folder,
            youtube_open_url,
            // convert
            convert_scan_folder,
            convert_start,
            convert_cancel,
            convert_delete_file,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            let state2 = state.clone();

            // Auto-start bins installation in background
            tauri::async_runtime::spawn(async move {
                let bins_dir = bins::bins_dir(&state2.app_dir);
                let h = handle.clone();
                let s = state2.clone();

                let result = bins::ensure_bins(&bins_dir, move |name, st, pct| {
                    let mut statuses = s.bins_status.lock().unwrap();
                    if let Some(e) = statuses.iter_mut().find(|e| e.name == name) {
                        e.state   = st.clone();
                        e.percent = pct;
                    }
                    let _ = h.emit("bins:status",   serde_json::json!({ "name": name, "state": st }));
                    let _ = h.emit("bins:progress", serde_json::json!({ "name": name, "percent": pct }));
                }).await;

                *state2.bins_ready.lock().unwrap() = Some(result);

                // Restore previous session's index from DB
                if state2.settings_path.exists() {
                    let settings = system::read_settings(&state2.settings_path);
                    let ms       = system::load_music_settings(&settings);
                    let db_path  = system::db_path(&state2.app_dir, &settings);

                    // Scope the MutexGuard so it's dropped before any await
                    let (entries, summary) = {
                        let mut guard = state2.db.lock().unwrap();
                        if guard.is_none() {
                            if let Ok(conn) = db::open_db(&db_path) {
                                *guard = Some(conn);
                            }
                        }
                        if let Some(conn) = guard.as_ref() {
                            (db::load_entries(conn), db::load_summary(conn))
                        } else {
                            (vec![], None)
                        }
                        // guard dropped here
                    };

                    let dirs = ms.search_directories;
                    let excl = ms.exclude;

                    *state2.entries.write().await      = entries;
                    *state2.current_dirs.write().await = dirs.clone();
                    *state2.current_excl.write().await = excl.clone();
                    if let Some(s) = summary {
                        *state2.last_summary.write().await = Some(s);
                    }

                    // Start watching dirs so live add/remove is detected without re-indexing
                    let excluder = indexer::build_excluder(&excl);
                    start_dir_watch(dirs, excluder, state2.clone(), handle.clone());
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            system::log(&log_path, &format!("fatal: {}", e));
        });
}
