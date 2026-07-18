use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use crate::AppState;
use crate::core::db::DbClient;
use crate::modules::admin;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileMeta {
    pub id:   String,
    pub name: String,
    pub size: u64,
}

// DB 스키마 변경 없이 메시지 텍스트에 파일 메타정보를 마커로 인코딩
pub const FILE_PREFIX: &str = "[[FILE]]";

pub fn encode_file_message(meta: &FileMeta) -> String {
    format!("{}{}", FILE_PREFIX, serde_json::to_string(meta).unwrap_or_default())
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

pub async fn purge_old(db: &DbClient) -> Result<(), String> {
    let week_ago = (chrono::Utc::now() - chrono::Duration::days(7))
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    db.delete("chat_messages", &format!("created_at=lt.{}", week_ago)).await
}

pub async fn send_message(db: &DbClient, user_id: &str, text: &str) -> Result<(), String> {
    db.insert("chat_messages", json!({
        "user_id": user_id,
        "text": text,
        "read_by": [],
    })).await
}

// 로그인 중인 다른 기기들에 즉시 push (poll-sec는 push 실패 시의 fallback)
pub async fn push_to_others(db: &DbClient, my_id: &str, sender: &str, text: &str) {
    let Ok(rows) = db.select("users", "select=id,ip&is_online=eq.true").await else { return };
    for row in &rows {
        if row["id"].as_str() == Some(my_id) { continue; }
        let Some(ip) = row["ip"].as_str() else { continue };
        let _ = admin::send_chat(ip, sender, text).await;
    }
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

// ── 대화방 진입 ─────────────────────────────────────────────────────────────
// 이후 갱신은 /chat push로 처리 (poll-sec 폴링 제거됨). 진입 시 1회만 정리+갱신.

pub fn enter(state: Arc<AppState>, app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let guard = state.db.lock().await;
        if let Some(db) = guard.as_ref() {
            let _ = purge_old(db).await;
            match list_messages(db).await {
                Ok(_)  => { app.emit("refresh", ()).ok(); }
                Err(e) => { state.log(&format!("chat: enter refresh err={}", e)); }
            }
        }
    });
}
