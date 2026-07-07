use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter};
use crate::AppState;
use crate::core::db::DbClient;
use crate::core::scheduler::Scheduler;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: String,
    #[serde(rename = "userId")]
    pub user_id: String,
    pub text: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "readBy")]
    pub read_by: Vec<String>,
}

fn parse_msg(r: &Value) -> ChatMessage {
    let created_at = r["created_at"].as_str()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.timestamp_millis())
        .unwrap_or(0);
    ChatMessage {
        id: str_v(r, "id"),
        user_id: str_v(r, "user_id"),
        text: str_v(r, "text"),
        created_at,
        read_by: r["read_by"].as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default(),
    }
}

pub async fn list_messages(db: &DbClient) -> Result<Vec<ChatMessage>, String> {
    let week_ago = (chrono::Utc::now() - chrono::Duration::days(7))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let rows = db.select("chat_messages", &format!(
        "select=*&created_at=gte.{}&order=created_at.asc",
        week_ago
    )).await?;
    Ok(rows.iter().map(parse_msg).collect())
}

pub async fn send_message(db: &DbClient, user_id: &str, text: &str) -> Result<(), String> {
    db.insert("chat_messages", json!({
        "user_id": user_id,
        "text": text,
        "read_by": [],
    })).await
}

pub async fn delete_message(db: &DbClient, id: &str, user_id: &str) -> Result<(), String> {
    db.delete("chat_messages", &format!("id=eq.{}&user_id=eq.{}", id, user_id)).await
}

pub async fn mark_read(db: &DbClient, user_id: &str) -> Result<(), String> {
    let rows = db.select("chat_messages", "select=id,read_by,user_id").await?;
    for row in &rows {
        let msg_uid = row["user_id"].as_str().unwrap_or("");
        let read_by: Vec<String> = row["read_by"].as_array()
            .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default();
        if msg_uid != user_id && !read_by.contains(&user_id.to_string()) {
            if let Some(id) = row["id"].as_str() {
                let mut updated = read_by;
                updated.push(user_id.to_string());
                let _ = db.update("chat_messages", &format!("id=eq.{}", id),
                    json!({ "read_by": updated })).await;
            }
        }
    }
    Ok(())
}


fn str_v(v: &Value, k: &str) -> String {
    v[k].as_str().unwrap_or("").to_string()
}

// ── 채팅 1초 폴링 ─────────────────────────────────────────────────────────────

pub fn start_poll(sched: Scheduler, state: Arc<AppState>, app: AppHandle) {
    let gen = state.chat_poll_gen.fetch_add(1, Ordering::SeqCst) + 1;
    schedule_refresh(sched, state, app, gen);
}

fn schedule_refresh(sched: Scheduler, state: Arc<AppState>, app: AppHandle, gen: u64) {
    let sched2 = sched.clone();
    sched.after("chat-refresh", 1_000, move || async move {
        do_refresh(sched2, state, app, gen).await;
    });
}

async fn do_refresh(sched: Scheduler, state: Arc<AppState>, app: AppHandle, gen: u64) {
    if gen != state.chat_poll_gen.load(Ordering::SeqCst) {
        return;
    }
    let guard = state.db.lock().await;
    if let Some(db) = guard.as_ref() {
        match list_messages(db).await {
            Ok(_)  => { app.emit("refresh", ()).ok(); }
            Err(e) => { state.log(&format!("chat: refresh err={}", e)); }
        }
    }
    drop(guard);
    schedule_refresh(sched, state, app, gen);
}
