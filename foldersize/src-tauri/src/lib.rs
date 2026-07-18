mod core;

use core::db;
use core::scan::{self, FolderChild};
use core::system;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};

pub struct AppState {
    pub app_dir:  PathBuf,
    pub log_path: PathBuf,
    pub cancel:   Arc<AtomicBool>,
    pub db:       Mutex<Option<rusqlite::Connection>>,
}

impl AppState {
    pub fn log(&self, msg: &str) {
        system::log(&self.log_path, msg);
    }
}

type AS<'r> = State<'r, Arc<AppState>>;

fn with_db<T, F: FnOnce(&rusqlite::Connection) -> T>(state: &AppState, f: F) -> Option<T> {
    state.db.lock().ok().and_then(|g| g.as_ref().map(f))
}

// ── commands: window ────────────────────────────────────────────────────────

#[tauri::command]
fn close_window(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.close();
    }
}

// ── commands: scan ───────────────────────────────────────────────────────────

#[tauri::command]
fn list_drives() -> Vec<String> {
    scan::list_drives()
}

#[tauri::command]
async fn scan_folder(
    path: String,
    force: Option<bool>,
    app: AppHandle,
    state: AS<'_>,
) -> Result<Vec<FolderChild>, String> {
    if !force.unwrap_or(false) {
        if let Some(cached) = with_db(&state, |c| db::load_cached_children(c, &path)).flatten() {
            state.log(&format!("scan: cache hit {} ({} item(s))", path, cached.len()));
            return Ok(cached);
        }
    }

    state.cancel.store(false, Ordering::SeqCst);
    let cancel = Arc::clone(&state.cancel);
    state.log(&format!("scan: start {}", path));

    let app_clone = app.clone();
    let path_clone = path.clone();
    let handle = tauri::async_runtime::spawn_blocking(move || {
        scan::scan_one_level(&path_clone, &cancel, |done, total, name| {
            let _ = app_clone.emit("scan:progress", serde_json::json!({
                "done": done, "total": total, "name": name
            }));
        })
    });

    let result = handle.await.map_err(|e| e.to_string())?;
    match &result {
        Ok(children) => {
            state.log(&format!("scan: done, {} item(s)", children.len()));
            with_db(&state, |c| { let _ = db::save_children(c, &path, children); });
        }
        Err(e) => state.log(&format!("scan: error {}", e)),
    }
    result
}

#[tauri::command]
fn scan_cancel(state: AS<'_>) {
    state.cancel.store(true, Ordering::SeqCst);
}

// ── commands: file ops ────────────────────────────────────────────────────────

#[cfg(windows)]
fn reveal_in_explorer(state: &AppState, full_path: &str) {
    use std::os::windows::process::CommandExt;
    let raw = format!("/select,\"{}\"", full_path);
    let result = std::process::Command::new("explorer")
        .raw_arg(&raw)
        .creation_flags(0x08000000)
        .spawn();
    state.log(&format!("reveal: path={} spawn={:?}", full_path, result.map(|c| c.id())));
}

#[tauri::command]
fn reveal_path(full_path: String, state: AS<'_>) {
    #[cfg(windows)]
    reveal_in_explorer(&state, &full_path);
}

#[tauri::command]
async fn delete_path(full_path: String, state: AS<'_>) -> Result<(), String> {
    let path = full_path.clone();
    tauri::async_runtime::spawn_blocking(move || trash::delete(&path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

    state.log(&format!("delete: moved to trash {}", full_path));
    with_db(&state, |c| { let _ = db::purge_path(c, &full_path); });
    Ok(())
}

#[cfg(windows)]
fn spawn_no_window(program: &str, args: &[&str]) {
    use std::os::windows::process::CommandExt;
    let _ = std::process::Command::new(program).args(args).creation_flags(0x08000000).spawn();
}

#[tauri::command]
fn open_url(url: String) {
    #[cfg(windows)]
    spawn_no_window("cmd", &["/c", "start", "", &url]);
}

#[cfg(windows)]
fn clear_recycle_bin(drive_letter: char) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    let cmd = format!("Clear-RecycleBin -DriveLetter {} -Force", drive_letter);
    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-Command", &cmd])
        .creation_flags(0x08000000)
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[tauri::command]
async fn empty_recycle_bin(full_path: String, state: AS<'_>) -> Result<(), String> {
    let drive_letter = full_path.chars().next().ok_or("invalid path")?;
    let result = tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        { clear_recycle_bin(drive_letter) }
        #[cfg(not(windows))]
        { let _ = drive_letter; Err("unsupported platform".to_string()) }
    }).await.map_err(|e| e.to_string())?;

    match &result {
        Ok(()) => state.log(&format!("recycle-bin: emptied {}:", drive_letter)),
        Err(e) => state.log(&format!("recycle-bin: failed {}: {}", drive_letter, e)),
    }
    result
}

// ── run ───────────────────────────────────────────────────────────────────────

pub fn run() {
    let app_dir  = system::app_dir();
    let log_path = system::log_path(&app_dir);

    {
        let lp = log_path.clone();
        std::panic::set_hook(Box::new(move |info| {
            system::log(&lp, &format!("PANIC: {}", info));
        }));
    }

    let db_path = system::db_path(&app_dir);
    let db_conn = db::open_db(&db_path).ok();
    if db_conn.is_none() {
        system::log(&log_path, &format!("db: failed to open {}", db_path.display()));
    }

    let state = Arc::new(AppState {
        app_dir,
        log_path: log_path.clone(),
        cancel: Arc::new(AtomicBool::new(false)),
        db: Mutex::new(db_conn),
    });

    system::log(&log_path, "*************** family_foldersize starting ***************");

    let state_setup = Arc::clone(&state);

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_focus();
            }
        }))
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            close_window,
            list_drives,
            scan_folder,
            scan_cancel,
            reveal_path,
            delete_path,
            empty_recycle_bin,
            open_url,
        ])
        .setup(move |app| {
            let data_dir = state_setup.app_dir.join("webview-data");
            let _ = std::fs::create_dir_all(&data_dir);
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::default())
                .title("Family FolderSize")
                .inner_size(1000.0, 680.0)
                .visible(true)
                .data_directory(data_dir)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            system::log(&log_path, &format!("fatal: {}", e));
        });
}
