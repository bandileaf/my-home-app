mod core;
mod modules;

use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

use core::{db::DbClient, system::{self, Settings}};
use modules::{notice, chat, calendar, user, admin};

pub struct AppState {
    pub settings_path: String,
    pub log_path: String,
    pub device_id: String,
    pub hostname: String,
    pub db: Mutex<Option<DbClient>>,
    pub session: Mutex<Option<user::UserSession>>,
}

impl AppState {
    fn log(&self, msg: &str) {
        system::log(&self.log_path, msg);
    }

    async fn get_db(&self) -> Result<tokio::sync::MutexGuard<'_, Option<DbClient>>, String> {
        Ok(self.db.lock().await)
    }

    async fn get_user_id(&self) -> Result<String, String> {
        let s = self.session.lock().await;
        s.as_ref().map(|s| s.user_id.clone()).ok_or_else(|| "not logged in".to_string())
    }
}

// ─── commands: notices ────────────────────────────────────────────────────────

#[tauri::command]
async fn list_notices(state: State<'_, Arc<AppState>>) -> Result<Vec<notice::Notice>, String> {
    let guard = state.db.lock().await;
    let db = guard.as_ref().ok_or("no db")?;
    notice::list_notices(db).await
}

#[tauri::command]
async fn create_notice(state: State<'_, Arc<AppState>>, text: String, kind: String) -> Result<notice::Notice, String> {
    let user_id = state.get_user_id().await?;
    let guard = state.db.lock().await;
    let db = guard.as_ref().ok_or("no db")?;
    notice::create_notice(db, &user_id, &text, &kind).await
}

#[tauri::command]
async fn create_reply(state: State<'_, Arc<AppState>>, notice_id: String, text: String) -> Result<(), String> {
    let user_id = state.get_user_id().await?;
    let guard = state.db.lock().await;
    let db = guard.as_ref().ok_or("no db")?;
    notice::create_reply(db, &notice_id, &user_id, &text).await
}

#[tauri::command]
async fn cast_vote(state: State<'_, Arc<AppState>>, notice_id: String, vote: String) -> Result<(), String> {
    let user_id = state.get_user_id().await?;
    let guard = state.db.lock().await;
    let db = guard.as_ref().ok_or("no db")?;
    notice::cast_vote(db, &notice_id, &user_id, &vote).await
}

#[tauri::command]
async fn update_notice(state: State<'_, Arc<AppState>>, notice_id: String, text: String) -> Result<(), String> {
    let guard = state.db.lock().await;
    let db = guard.as_ref().ok_or("no db")?;
    notice::update_notice(db, &notice_id, &text).await
}

#[tauri::command]
async fn delete_notice(state: State<'_, Arc<AppState>>, notice_id: String) -> Result<(), String> {
    let user_id = state.get_user_id().await?;
    let guard = state.db.lock().await;
    let db = guard.as_ref().ok_or("no db")?;
    notice::delete_notice(db, &notice_id, &user_id).await
}

// ─── commands: chat ───────────────────────────────────────────────────────────

#[tauri::command]
async fn list_messages(state: State<'_, Arc<AppState>>) -> Result<Vec<chat::ChatMessage>, String> {
    let guard = state.db.lock().await;
    let db = guard.as_ref().ok_or("no db")?;
    chat::list_messages(db).await
}

#[tauri::command]
async fn send_message(state: State<'_, Arc<AppState>>, text: String) -> Result<(), String> {
    let user_id = state.get_user_id().await?;
    let guard = state.db.lock().await;
    let db = guard.as_ref().ok_or("no db")?;
    chat::send_message(db, &user_id, &text).await
}

#[tauri::command]
async fn delete_message(state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    let user_id = state.get_user_id().await?;
    let guard = state.db.lock().await;
    let db = guard.as_ref().ok_or("no db")?;
    chat::delete_message(db, &id, &user_id).await
}

#[tauri::command]
async fn mark_read(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let user_id = state.get_user_id().await?;
    let guard = state.db.lock().await;
    let db = guard.as_ref().ok_or("no db")?;
    chat::mark_read(db, &user_id).await
}

// ─── commands: calendar ───────────────────────────────────────────────────────

#[tauri::command]
async fn list_schedules(state: State<'_, Arc<AppState>>) -> Result<Vec<calendar::Schedule>, String> {
    let guard = state.db.lock().await;
    let db = guard.as_ref().ok_or("no db")?;
    calendar::list_schedules(db).await
}

#[tauri::command]
async fn create_schedule(
    state: State<'_, Arc<AppState>>,
    title: String, date: String, end_date: Option<String>,
    all_day: bool, start_time: Option<String>, end_time: Option<String>,
    repeat_weekly: bool, repeat_monthly: bool,
    memo: Option<String>, color: String,
) -> Result<(), String> {
    let user_id = state.get_user_id().await?;
    let guard = state.db.lock().await;
    let db = guard.as_ref().ok_or("no db")?;
    calendar::create_schedule(
        db, &user_id, &title, &date,
        end_date.as_deref(), all_day,
        start_time.as_deref(), end_time.as_deref(),
        repeat_weekly, repeat_monthly,
        memo.as_deref(), &color,
    ).await
}

#[tauri::command]
async fn delete_schedule(state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    let user_id = state.get_user_id().await?;
    let guard = state.db.lock().await;
    let db = guard.as_ref().ok_or("no db")?;
    calendar::delete_schedule(db, &id, &user_id).await
}

// ─── commands: users ──────────────────────────────────────────────────────────

#[tauri::command]
async fn get_session(state: State<'_, Arc<AppState>>) -> Result<Option<user::UserSession>, String> {
    Ok(state.session.lock().await.clone())
}

#[tauri::command]
async fn list_users(state: State<'_, Arc<AppState>>) -> Result<Vec<user::UserProfile>, String> {
    let guard = state.db.lock().await;
    let db = guard.as_ref().ok_or("no db")?;
    user::list_users(db).await
}

#[tauri::command]
async fn save_alias(state: State<'_, Arc<AppState>>, alias: Option<String>) -> Result<(), String> {
    let user_id = state.get_user_id().await?;
    let guard = state.db.lock().await;
    let db = guard.as_ref().ok_or("no db")?;
    user::save_alias(db, &user_id, alias.as_deref()).await?;
    let mut s = state.session.lock().await;
    if let Some(ref mut session) = *s { session.alias = alias; }
    Ok(())
}

#[tauri::command]
async fn save_avatar(state: State<'_, Arc<AppState>>, avatar: Option<String>) -> Result<(), String> {
    let user_id = state.get_user_id().await?;
    let guard = state.db.lock().await;
    let db = guard.as_ref().ok_or("no db")?;
    user::save_avatar(db, &user_id, avatar.as_deref()).await?;
    let mut s = state.session.lock().await;
    if let Some(ref mut session) = *s { session.avatar = avatar; }
    Ok(())
}

// ─── commands: settings & system ─────────────────────────────────────────────

#[tauri::command]
async fn get_settings(state: State<'_, Arc<AppState>>) -> Result<Option<Settings>, String> {
    Ok(system::read_settings(&state.settings_path))
}

#[tauri::command]
async fn save_settings_cmd(state: State<'_, Arc<AppState>>, value: serde_json::Value) -> Result<(), String> {
    system::save_settings(&state.settings_path, &value).map_err(|e| e.to_string())
}

#[tauri::command]
async fn has_settings(state: State<'_, Arc<AppState>>) -> Result<bool, String> {
    Ok(std::path::Path::new(&state.settings_path).exists())
}

#[tauri::command]
async fn is_admin(state: State<'_, Arc<AppState>>) -> Result<bool, String> {
    Ok(system::read_settings(&state.settings_path).map(|s| s.admin).unwrap_or(false))
}

// ─── commands: admin ──────────────────────────────────────────────────────────

#[tauri::command]
async fn scan_subnet() -> Result<Vec<admin::DeviceStatus>, String> {
    admin::scan_subnet(None::<fn(String)>).await
}

#[tauri::command]
async fn admin_fetch_log(ip: String) -> Result<String, String> {
    admin::fetch_client_log(&ip).await
}

#[tauri::command]
async fn admin_fetch_settings(ip: String) -> Result<String, String> {
    admin::fetch_client_settings(&ip).await
}

#[tauri::command]
async fn admin_send_settings(ip: String, body: serde_json::Value) -> Result<serde_json::Value, String> {
    admin::send_settings(&ip, body).await
}

#[tauri::command]
async fn admin_restart(ip: String) -> Result<serde_json::Value, String> {
    admin::send_restart(&ip).await
}

#[tauri::command]
async fn admin_update(ip: String) -> Result<serde_json::Value, String> {
    admin::send_update(&ip).await
}

#[tauri::command]
async fn admin_disable(ip: String) -> Result<serde_json::Value, String> {
    admin::send_disable(&ip).await
}

#[tauri::command]
async fn admin_enable(ip: String) -> Result<serde_json::Value, String> {
    admin::send_enable(&ip).await
}

// ─── control server (HTTP :61799) ────────────────────────────────────────────

async fn run_control(state: Arc<AppState>, app: AppHandle) {
    use tokio::net::TcpListener;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let listener = match TcpListener::bind("0.0.0.0:61799").await {
        Ok(l) => l,
        Err(e) => { state.log(&format!("control: bind error: {}", e)); return; }
    };
    state.log("control: listening on :61799");

    loop {
        match listener.accept().await {
            Ok((mut stream, addr)) => {
                let from = addr.ip().to_string();
                let state = state.clone();
                let app = app.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 16384];
                    let n = stream.read(&mut buf).await.unwrap_or(0);
                    let raw = String::from_utf8_lossy(&buf[..n]);
                    let first = raw.lines().next().unwrap_or("");
                    let parts: Vec<&str> = first.splitn(3, ' ').collect();
                    if parts.len() < 2 { return; }
                    let method = parts[0];
                    let path = parts[1];
                    let body = raw.find("\r\n\r\n").map(|i| raw[i + 4..].trim_end_matches('\0').to_string());

                    state.log(&format!("control: {} {} from={}", method, path, from));

                    let resp = handle_control(method, path, body.as_deref(), &state, &app).await;
                    let _ = stream.write_all(resp.as_bytes()).await;
                });
            }
            Err(e) => state.log(&format!("control: accept error: {}", e)),
        }
    }
}

fn http_json(status: u16, body: &str) -> String {
    let reason = if status == 200 { "OK" } else { "Error" };
    format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\n\r\n{}",
        status, reason, body.len(), body
    )
}

fn http_text(body: &str) -> String {
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\n\r\n{}",
        body.len(), body
    )
}

async fn handle_control(method: &str, path: &str, body: Option<&str>, state: &Arc<AppState>, app: &AppHandle) -> String {
    let sp = &state.settings_path;
    match (method, path) {
        ("GET", "/status") => {
            let s = system::read_settings(sp);
            let info = serde_json::json!({
                "deviceId": state.device_id,
                "hostname": state.hostname,
                "version": env!("CARGO_PKG_VERSION"),
                "has_settings": s.is_some(),
                "disabled": s.map(|s| s.disabled).unwrap_or(false),
            });
            http_json(200, &info.to_string())
        }
        ("GET", "/settings") => {
            let content = std::fs::read_to_string(sp).unwrap_or_else(|_| "{}".to_string());
            http_text(&content)
        }
        ("GET", "/log") => {
            let content = std::fs::read_to_string(&state.log_path).unwrap_or_else(|_| "(no log)".to_string());
            http_text(&content)
        }
        ("POST", "/settings") => {
            let b = match body { Some(b) if !b.is_empty() => b, _ => return http_json(400, "{\"error\":\"no body\"}") };
            match serde_json::from_str::<serde_json::Value>(b) {
                Ok(v) => match system::save_settings(sp, &v) {
                    Ok(_) => {
                        state.log("control: settings saved");
                        app.emit("settings_changed", ()).ok();
                        http_json(200, "{\"ok\":true}")
                    }
                    Err(e) => http_json(500, &format!("{{\"error\":\"{}\"}}", e)),
                },
                Err(e) => http_json(400, &format!("{{\"error\":\"{}\"}}", e)),
            }
        }
        ("POST", "/restart") => {
            state.log("control: restart requested");
            let app = app.clone();
            tokio::spawn(async move {
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                app.restart();
            });
            http_json(200, "{\"ok\":true}")
        }
        ("POST", "/update") => {
            state.log("control: update triggered");
            if let Ok(c) = std::fs::read_to_string(sp) {
                if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&c) {
                    v.as_object_mut().map(|m| m.remove("hub.tag"));
                    let _ = system::save_settings(sp, &v);
                }
            }
            let app = app.clone();
            tokio::spawn(async move {
                tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;
                app.restart();
            });
            http_json(200, "{\"ok\":true}")
        }
        ("POST", "/disable") => {
            if let Ok(c) = std::fs::read_to_string(sp) {
                if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&c) {
                    v["hub.disabled"] = serde_json::json!(true);
                    let _ = system::save_settings(sp, &v);
                }
            }
            state.log("control: disabled");
            http_json(200, "{\"ok\":true}")
        }
        ("POST", "/enable") => {
            if let Ok(c) = std::fs::read_to_string(sp) {
                if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&c) {
                    v.as_object_mut().map(|m| m.remove("hub.disabled"));
                    let _ = system::save_settings(sp, &v);
                }
            }
            state.log("control: enabled");
            http_json(200, "{\"ok\":true}")
        }
        _ => {
            state.log(&format!("control: 404 {} {}", method, path));
            http_json(404, "{\"error\":\"not found\"}")
        }
    }
}

// ─── polling ──────────────────────────────────────────────────────────────────

async fn run_polling(state: Arc<AppState>, app: AppHandle) {
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(10)).await;
        let has_db = state.db.lock().await.is_some();
        if has_db {
            app.emit("refresh", ()).ok();
        }
    }
}

// ─── init ─────────────────────────────────────────────────────────────────────

async fn init_db_and_session(state: Arc<AppState>) {
    let settings = match system::read_settings(&state.settings_path) {
        Some(s) if !s.supabase_url.is_empty() && !s.supabase_key.is_empty() => s,
        _ => { state.log("init: no supabase settings"); return; }
    };

    let db = DbClient::new(&settings.supabase_url, &settings.supabase_key);

    let ip = system::get_local_ip();
    let mac_addrs = system::get_mac_addresses();
    let version = env!("CARGO_PKG_VERSION");

    let device_id = if !settings.device_id.is_empty() {
        settings.device_id.clone()
    } else {
        system::get_device_id().unwrap_or_else(|| mac_addrs.first().cloned().unwrap_or_else(|| "unknown".to_string()))
    };

    match user::upsert_user(&db, &state.hostname, &mac_addrs, ip.as_deref(), &device_id, Some(version)).await {
        Ok(session) => {
            state.log(&format!("init: userId={}", session.user_id));
            *state.session.lock().await = Some(session);
        }
        Err(e) => state.log(&format!("init: upsert_user failed: {}", e)),
    }

    *state.db.lock().await = Some(db);
    state.log("init: db ready");
}

// ─── entry point ──────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let settings_path = {
        let exe = std::env::current_exe().unwrap_or_default();
        let dir = exe.parent().unwrap_or(std::path::Path::new("."));
        dir.join("settings.json").to_string_lossy().to_string()
    };
    let log_path = {
        let exe = std::env::current_exe().unwrap_or_default();
        let dir = exe.parent().unwrap_or(std::path::Path::new("."));
        dir.join("bulletin.log").to_string_lossy().to_string()
    };
    let hostname = system::get_hostname();
    let device_id = system::get_device_id()
        .unwrap_or_else(|| system::get_mac_addresses().into_iter().next().unwrap_or_else(|| "unknown".to_string()));

    let state = Arc::new(AppState {
        settings_path,
        log_path,
        device_id,
        hostname,
        db: Mutex::new(None),
        session: Mutex::new(None),
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(state.clone())
        .setup(move |app| {
            let handle = app.handle().clone();
            let state_init = state.clone();
            let state_poll = state.clone();
            let state_ctrl = state.clone();
            let handle_poll = handle.clone();
            let handle_ctrl = handle.clone();

            // init DB + user in background
            tauri::async_runtime::spawn(async move {
                init_db_and_session(state_init).await;
            });

            // polling
            tauri::async_runtime::spawn(async move {
                run_polling(state_poll, handle_poll).await;
            });

            // control server
            tauri::async_runtime::spawn(async move {
                run_control(state_ctrl, handle_ctrl).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // notices
            list_notices, create_notice, create_reply, cast_vote, update_notice, delete_notice,
            // chat
            list_messages, send_message, delete_message, mark_read,
            // calendar
            list_schedules, create_schedule, delete_schedule,
            // users
            get_session, list_users, save_alias, save_avatar,
            // system
            get_settings, save_settings_cmd, has_settings, is_admin,
            // admin
            scan_subnet, admin_fetch_log, admin_fetch_settings,
            admin_send_settings, admin_restart, admin_update, admin_disable, admin_enable,
        ])
        .run(tauri::generate_context!())
        .expect("error running app");
}
