mod core;
mod modules;

use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::menu::{Menu, MenuItem};

use core::{db::DbClient, system::{self, Settings}, update, window::{WindowState, Page}, notify::{self, NotifyQueue, PendingEvents}, scheduler::{Scheduler, self}};
use modules::{notice, chat, calendar, user, admin};

// 테스트용: UpdateHandle 임시 보관
pub struct TestHandle(pub std::sync::Mutex<Option<notify::UpdateHandle>>);

pub struct AppState {
    pub settings_path: String,
    pub log_path: String,
    pub device_id: String,
    pub hostname: String,
    pub db: Mutex<Option<DbClient>>,
    pub session: Mutex<Option<user::UserSession>>,
    pub window: WindowState,
    pub notify: NotifyQueue,
    pub sched: Scheduler,
    pub chat_poll_gen: Arc<AtomicU64>,
}

impl AppState {
    #[track_caller]
    pub fn log(&self, msg: &str) {
        let loc = std::panic::Location::caller();
        let file = loc.file();
        let fname = file.rsplit(['/', '\\']).next().unwrap_or(file);
        system::log(&self.log_path, &format!("[{}] {}", fname, msg));
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

// ─── commands: window ────────────────────────────────────────────────────────

fn sep(label: &str, ch: char) -> String {
    let total = 52usize;
    let inner = format!(" {} ", label);
    let fill  = total.saturating_sub(inner.len());
    let left  = fill / 2;
    format!("{}{}{}", ch.to_string().repeat(left), inner, ch.to_string().repeat(fill - left))
}

fn page_label(page: &str) -> &str {
    match page {
        "messenger" => "CHAT",
        "notices"   => "NOTICES",
        "calendar"  => "CALENDAR",
        "admin"     => "ADMIN",
        other       => other,
    }
}

#[tauri::command]
fn hide_window(app: AppHandle, state: State<'_, Arc<AppState>>) {
    state.log(&sep("TO TRAY", '='));
    if let Some(w) = app.get_webview_window("main") { let _ = w.hide(); }
    state.window.set_visible(false);
}

#[tauri::command]
fn show_window(app: AppHandle, state: State<'_, Arc<AppState>>) {
    state.log(&sep("FROM TRAY", '='));
    if let Some(w) = app.get_webview_window("main") {
        let monitor = w.current_monitor().ok().flatten()
            .and_then(|m| m.name().map(|s| s.to_string()));
        state.window.set_monitor(monitor);
        let _ = w.show();
        let _ = w.set_focus();
    }
    state.window.set_visible(true);
}

#[tauri::command]
fn set_active_page(state: State<'_, Arc<AppState>>, page: String) {
    state.log(&sep(&format!("ENTER {}", page_label(&page)), '-'));
    if page != "messenger" {
        state.chat_poll_gen.fetch_add(1, Ordering::SeqCst);
    }
    state.window.set_page(Page::from_str(&page));
}

#[tauri::command]
fn chat_enter(state: State<'_, Arc<AppState>>, app: AppHandle) {
    chat::start_poll(state.sched.clone(), state.inner().clone(), app);
}

#[tauri::command]
fn cancel_update(state: State<'_, Arc<AppState>>) {
    state.notify.cancel_update();
}

#[tauri::command]
fn get_toast_event(window: tauri::WebviewWindow, pending: State<'_, PendingEvents>) -> Option<notify::ToastEvent> {
    pending.0.lock().unwrap().remove(window.label())
}

#[tauri::command]
fn toast_closed(window: tauri::WebviewWindow, state: State<'_, Arc<AppState>>) {
    let label = window.label().to_string();
    state.log(&format!("toast_closed cmd: label={}", label));
    state.notify.window_closed(label);
}

#[tauri::command]
fn log_msg(msg: String, state: State<'_, Arc<AppState>>) {
    state.log(&format!("[front] {}", msg));
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
            let reason_path = std::path::Path::new(sp).parent().unwrap_or(std::path::Path::new(".")).join(".restart_reason");
            let _ = std::fs::write(&reason_path, "admin-reboot");
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
            let reason_path = std::path::Path::new(sp).parent().unwrap_or(std::path::Path::new(".")).join(".restart_reason");
            let _ = std::fs::write(&reason_path, "update");
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
        // CORS preflight
        ("OPTIONS", _) => {
            "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nContent-Length: 0\r\n\r\n".to_string()
        }
        // 테스트용: 알림 직접 발생
        ("POST", "/test") => {
            let b = match body { Some(b) if !b.is_empty() => b, _ => return http_json(400, r#"{"error":"no body"}"#) };
            let v = match serde_json::from_str::<serde_json::Value>(b) {
                Ok(v) => v,
                Err(_) => return http_json(400, r#"{"error":"invalid json"}"#),
            };
            match v["type"].as_str() {
                Some("chat") => {
                    let sender = v["sender"].as_str().unwrap_or("테스트").to_string();
                    let text   = v["text"].as_str().unwrap_or("테스트 메시지").to_string();
                    state.notify.chat(sender, text);
                    http_json(200, r#"{"ok":true}"#)
                }
                Some("notice") => {
                    let notice_id = v["notice_id"].as_str().unwrap_or("test-id").to_string();
                    let title     = v["title"].as_str().unwrap_or("테스트 공지").to_string();
                    state.notify.notice(notice_id, title);
                    http_json(200, r#"{"ok":true}"#)
                }
                Some("update_start") => {
                    let version = v["version"].as_str().unwrap_or("v0.0.0").to_string();
                    let handle = state.notify.update_start(version);
                    if let Some(ts) = app.try_state::<TestHandle>() {
                        *ts.0.lock().unwrap() = Some(handle);
                    }
                    http_json(200, r#"{"ok":true}"#)
                }
                Some("update_progress") => {
                    let pct = v["pct"].as_u64().unwrap_or(50) as u8;
                    if let Some(ts) = app.try_state::<TestHandle>() {
                        if let Some(h) = ts.0.lock().unwrap().as_ref() { h.progress(pct); }
                    }
                    http_json(200, r#"{"ok":true}"#)
                }
                Some("update_done") => {
                    if let Some(ts) = app.try_state::<TestHandle>() {
                        if let Some(h) = ts.0.lock().unwrap().take() { h.done(); }
                    }
                    http_json(200, r#"{"ok":true}"#)
                }
                Some("update_cancel") => {
                    state.notify.cancel_update();
                    if let Some(ts) = app.try_state::<TestHandle>() {
                        *ts.0.lock().unwrap() = None;
                    }
                    http_json(200, r#"{"ok":true}"#)
                }
                _ => http_json(400, r#"{"error":"unknown type"}"#),
            }
        }
        _ => {
            state.log(&format!("control: 404 {} {}", method, path));
            http_json(404, "{\"error\":\"not found\"}")
        }
    }
}

// ─── polling ──────────────────────────────────────────────────────────────────

fn start_polling(sched: Scheduler, state: Arc<AppState>, app: AppHandle, last_chat_id: Option<String>, poll_count: u32) {
    let sched2 = sched.clone();
    sched.after("poll", 60_000, move || async move {
        let count = poll_count + 1;
        let guard = state.db.lock().await;
        let mut next_chat_id = last_chat_id.clone();

        if let Some(db) = guard.as_ref() {
            if let Ok(msgs) = chat::list_messages(db).await {
                if let Some(latest) = msgs.first() {
                    let is_new = last_chat_id.as_ref().map(|id| id != &latest.id).unwrap_or(true);
                    let my_id  = state.session.lock().await.as_ref().map(|s| s.user_id.clone());
                    let is_mine = my_id.as_ref().map(|id| id == &latest.user_id).unwrap_or(false);

                    if is_new && last_chat_id.is_some() && !is_mine {
                        let should_notify = state.window.should_notify_chat();
                        state.log(&format!("poll#{}: 새 chat from={} notify={}", count, latest.user_id, should_notify));
                        if should_notify {
                            state.notify.chat(latest.user_id.clone(), latest.text.clone());
                        } else {
                            app.emit("refresh", ()).ok();
                        }
                    } else if is_new && last_chat_id.is_none() {
                        state.log(&format!("poll#{}: chat 초기화 latest={}", count, latest.id));
                    }
                    next_chat_id = Some(latest.id.clone());
                }
            }
        }
        drop(guard);
        app.emit("refresh", ()).ok();

        // 재등록 → 10s 루프 유지
        start_polling(sched2, state, app, next_chat_id, count);
    });
}

// ─── init ─────────────────────────────────────────────────────────────────────

async fn init_db_and_session(state: Arc<AppState>, app: AppHandle) {
    let settings = match system::read_settings(&state.settings_path) {
        Some(s) if !s.supabase_url.is_empty() && !s.supabase_key.is_empty() => s,
        _ => { state.log("init: no supabase settings"); return; }
    };

    // autostart (Windows 레지스트리)
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let exe = std::env::current_exe().unwrap_or_default().to_string_lossy().to_string();
        if settings.autostart {
            let _ = std::process::Command::new("reg")
                .args(["add", "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
                    "/v", "family_bulletin", "/t", "REG_SZ",
                    "/d", &format!("\"{}\" --autostart", exe), "/f"])
                .creation_flags(0x08000000).output();
        } else {
            let _ = std::process::Command::new("reg")
                .args(["delete", "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run",
                    "/v", "family_bulletin", "/f"])
                .creation_flags(0x08000000).output();
        }
        state.log(&format!("autostart: {}", settings.autostart));
    }

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
            state.log(&format!("user upsert 완료. userId={} alias={}", session.user_id, session.alias.as_deref().unwrap_or("null")));
            // 창 크기 복원
            if let (Some(w), Some(win)) = (session.width, app.get_webview_window("main")) {
                if let Some(h) = session.height {
                    let _ = win.set_size(tauri::Size::Physical(tauri::PhysicalSize { width: w, height: h }));
                    state.log(&format!("win: restore size {}x{}", w, h));
                }
            }
            *state.session.lock().await = Some(session);
        }
        Err(e) => state.log(&format!("user upsert failed: {}", e)),
    }

    *state.db.lock().await = Some(db);
    state.log("init: db ready");

    // 업데이트 체크 (app did-finish-load 대신 DB ready 후 실행)
    let sp = state.settings_path.clone();
    let exe = std::env::current_exe().unwrap_or_default();
    let base_dir = exe.parent().unwrap_or(std::path::Path::new(".")).to_string_lossy().to_string();
    let log_fn = {
        let state = state.clone();
        move |msg: &str| state.log(msg)
    };
    let should_quit = update::run_update_check(&sp, &base_dir, "hub.bulletin.zip", &state.notify, log_fn).await;
    if should_quit {
        state.log("update: quitting for update");
        tokio::time::sleep(tokio::time::Duration::from_millis(1800)).await;
        app.exit(0);
    }
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
        let log_dir = dir.join("log");
        let _ = std::fs::create_dir_all(&log_dir);
        log_dir.join(format!("{}.log", env!("CARGO_PKG_NAME"))).to_string_lossy().to_string()
    };
    let hostname = system::get_hostname();
    let device_id = system::get_device_id()
        .unwrap_or_else(|| system::get_mac_addresses().into_iter().next().unwrap_or_else(|| "unknown".to_string()));

    let reason_path = {
        let exe = std::env::current_exe().unwrap_or_default();
        let dir = exe.parent().unwrap_or(std::path::Path::new("."));
        dir.join(".restart_reason").to_string_lossy().to_string()
    };
    let startup_reason = if let Ok(r) = std::fs::read_to_string(&reason_path) {
        let _ = std::fs::remove_file(&reason_path);
        match r.trim() {
            "admin-reboot" => "원격 재시작".to_string(),
            "update"       => "원격 업데이트 재시작".to_string(),
            other          => other.to_string(),
        }
    } else {
        let args: Vec<String> = std::env::args().collect();
        let reason_flag = args.iter().find(|a| a.starts_with("--reason=")).map(|a| a.trim_start_matches("--reason="));
        if args.contains(&"--autostart".to_string())       { "PC 부팅 자동 실행".to_string() }
        else if args.contains(&"--post-update".to_string()) { "업데이트 완료 재시작".to_string() }
        else if args.contains(&"--post-restart".to_string()){ "재시작".to_string() }
        else if reason_flag == Some("remote-restart")       { "원격 재시작".to_string() }
        else if reason_flag == Some("remote-update")        { "원격 업데이트 재시작".to_string() }
        else                                                { "수동 실행".to_string() }
    };

    let tag = system::read_settings(&settings_path).and_then(|s| s.tag).unwrap_or_else(|| "(none)".to_string());
    system::log(&log_path, &format!("SESSION START pid={} tag={} reason={}", std::process::id(), tag, startup_reason));

    let (notify_queue, notify_rx) = notify::create();
    let sched = scheduler::create(log_path.clone());

    let state = Arc::new(AppState {
        settings_path,
        log_path,
        device_id,
        hostname,
        db: Mutex::new(None),
        session: Mutex::new(None),
        window: WindowState::new(),
        notify: notify_queue,
        sched: sched.clone(),
        chat_poll_gen: Arc::new(AtomicU64::new(0)),
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .manage(state.clone())
        .manage(PendingEvents(std::sync::Mutex::new(std::collections::HashMap::new())))
        .manage(TestHandle(std::sync::Mutex::new(None)))
        .setup(move |app| {
            let handle = app.handle().clone();

            app.manage(sched.clone());

            // notify 스케줄러 (별도 task) — 큐가 비면 대기, 들어오면 자율 동작
            tauri::async_runtime::spawn(notify::run_scheduler(
                notify_rx, handle.clone(), state.log_path.clone(),
            ));

            let macs = system::get_mac_addresses();
            let ip = system::get_local_ip().unwrap_or_else(|| "null".to_string());
            state.log(&format!("identity: deviceId={} hostname={} mac=[{}] ip={}", state.device_id, state.hostname, macs.join(", "), ip));
            let has_settings = std::path::Path::new(&state.settings_path).exists();
            state.log(&format!("settings.json: {}", if has_settings { "있음" } else { "없음 — 관리자 대기 모드" }));

            let state_init = state.clone();
            let state_poll = state.clone();
            let state_ctrl = state.clone();
            let handle_ctrl = handle.clone();

            // tray icon
            let open_item = MenuItem::with_id(app, "open", "열기", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "종료", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Family Bulletin")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => {
                        if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); }
                        if let Some(s) = app.try_state::<Arc<AppState>>() { s.window.set_visible(true); }
                    }
                    "quit" => {
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Some(state) = app.try_state::<Arc<AppState>>() {
                                if let Some(w) = app.get_webview_window("main") {
                                    if let Ok(size) = w.inner_size() {
                                        let guard = state.db.lock().await;
                                        let session_guard = state.session.lock().await;
                                        if let (Some(db), Some(session)) = (guard.as_ref(), session_guard.as_ref()) {
                                            let _ = user::set_offline(db, &session.user_id).await;
                                            let _ = user::save_window_bounds(db, &session.user_id, size.width, size.height).await;
                                            state.log(&format!("app: before-quit — bounds saved {}x{}", size.width, size.height));
                                        }
                                    }
                                }
                            }
                            app.exit(0);
                        });
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); }
                        if let Some(s) = app.try_state::<Arc<AppState>>() { s.window.set_visible(true); }
                    }
                })
                .build(app)?;

            // window: X 버튼 → hide (종료 아님)
            if let Some(w) = app.get_webview_window("main") {
                let w2 = w.clone();
                let state_win = state.clone();
                w.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        state_win.log(&sep("TO TRAY", '='));
                        let _ = w2.hide();
                        state_win.window.set_visible(false);
                    }
                });
                // settings 없으면 창 표시 (관리자 대기 모드)
                if !has_settings {
                    let _ = w.show();
                    state.window.set_visible(true);
                }
            }

            let handle_poll = handle.clone();

            // init DB + user in background
            tauri::async_runtime::spawn(async move {
                init_db_and_session(state_init, handle.clone()).await;
            });

            // polling (스케줄러 기반 — DB 준비 후 첫 tick 발행)
            start_polling(state.sched.clone(), state_poll, handle_poll, None, 0);

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
            list_messages, send_message, delete_message, mark_read, chat_enter,
            // calendar
            list_schedules, create_schedule, delete_schedule,
            // users
            get_session, list_users, save_alias, save_avatar,
            // window
            hide_window, show_window, set_active_page, cancel_update,
            get_toast_event, toast_closed, log_msg,
            // system
            get_settings, save_settings_cmd, has_settings, is_admin,
            // admin
            scan_subnet, admin_fetch_log, admin_fetch_settings,
            admin_send_settings, admin_restart, admin_update, admin_disable, admin_enable,
        ])
        .run(tauri::generate_context!())
        .expect("error running app");
}
