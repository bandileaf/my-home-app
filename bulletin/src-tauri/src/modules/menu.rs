use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;
use crate::AppState;
use crate::core::db::DbClient;
use super::admin;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MenuOption {
    pub id: String,
    pub text: String,
    #[serde(rename = "addedBy")]
    pub added_by: String,
    #[serde(rename = "addedAt")]
    pub added_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MenuVote {
    #[serde(rename = "userId")]
    pub user_id: String,
    #[serde(rename = "optionId")]
    pub option_id: String,
    #[serde(rename = "votedAt")]
    pub voted_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MenuPoll {
    pub id: String,
    #[serde(rename = "createdBy")]
    pub created_by: String,
    pub title: String,
    pub options: Vec<MenuOption>,
    pub votes: Vec<MenuVote>,
    pub deadline: i64,
    pub closed: bool,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
}

fn parse_options(v: &Value) -> Vec<MenuOption> {
    v.as_array().map(|arr| arr.iter().map(|r| MenuOption {
        id: str_v(r, "id"),
        text: str_v(r, "text"),
        added_by: str_v(r, "added_by"),
        added_at: r["added_at"].as_i64().unwrap_or(0),
    }).collect()).unwrap_or_default()
}

fn parse_votes(v: &Value) -> Vec<MenuVote> {
    v.as_array().map(|arr| arr.iter().map(|r| MenuVote {
        user_id: str_v(r, "user_id"),
        option_id: str_v(r, "option_id"),
        voted_at: r["voted_at"].as_i64().unwrap_or(0),
    }).collect()).unwrap_or_default()
}

fn parse_poll(r: &Value) -> MenuPoll {
    MenuPoll {
        id: str_v(r, "id"),
        created_by: str_v(r, "created_by"),
        title: str_v(r, "title"),
        options: parse_options(&r["options"]),
        votes: parse_votes(&r["votes"]),
        deadline: r["deadline"].as_i64().unwrap_or(0),
        closed: r["closed"].as_bool().unwrap_or(false),
        created_at: r["created_at"].as_i64().unwrap_or(0),
    }
}

pub async fn list_polls(db: &DbClient) -> Result<Vec<MenuPoll>, String> {
    let rows = db.select("menu_polls", "select=*&order=created_at.desc").await?;
    Ok(rows.iter().map(parse_poll).collect())
}

pub async fn get_poll(db: &DbClient, poll_id: &str) -> Result<Option<MenuPoll>, String> {
    let row = db.select_one("menu_polls", &format!("id=eq.{}", poll_id)).await?;
    Ok(row.map(|r| parse_poll(&r)))
}

pub async fn create_poll(db: &DbClient, user_id: &str, title: &str, deadline: i64) -> Result<MenuPoll, String> {
    let poll = MenuPoll {
        id: Uuid::new_v4().to_string(),
        created_by: user_id.to_string(),
        title: title.to_string(),
        options: vec![],
        votes: vec![],
        deadline,
        closed: false,
        created_at: now_ms(),
    };
    db.insert("menu_polls", json!({
        "id": poll.id, "created_by": poll.created_by, "title": poll.title,
        "options": Vec::<Value>::new(), "votes": Vec::<Value>::new(),
        "deadline": poll.deadline, "closed": false, "created_at": poll.created_at,
    })).await?;
    Ok(poll)
}

pub async fn add_option(db: &DbClient, poll_id: &str, user_id: &str, text: &str) -> Result<(), String> {
    let row = db.select_one("menu_polls", &format!("id=eq.{}&select=options", poll_id)).await?
        .ok_or_else(|| "poll not found".to_string())?;
    let mut options = row["options"].as_array().cloned().unwrap_or_default();
    options.push(json!({
        "id": Uuid::new_v4().to_string(),
        "text": text, "added_by": user_id, "added_at": now_ms(),
    }));
    db.update("menu_polls", &format!("id=eq.{}", poll_id), json!({ "options": options })).await
}

pub async fn cast_vote(db: &DbClient, poll_id: &str, user_id: &str, option_id: &str) -> Result<(), String> {
    let row = db.select_one("menu_polls", &format!("id=eq.{}&select=votes,closed", poll_id)).await?
        .ok_or_else(|| "poll not found".to_string())?;
    if row["closed"].as_bool().unwrap_or(false) {
        return Err("poll is closed".to_string());
    }
    let mut votes: Vec<Value> = row["votes"].as_array().cloned().unwrap_or_default()
        .into_iter().filter(|v| v["user_id"].as_str() != Some(user_id)).collect();
    votes.push(json!({ "user_id": user_id, "option_id": option_id, "voted_at": now_ms() }));
    db.update("menu_polls", &format!("id=eq.{}", poll_id), json!({ "votes": votes })).await
}

pub async fn close_poll(db: &DbClient, poll_id: &str) -> Result<(), String> {
    db.update("menu_polls", &format!("id=eq.{}", poll_id), json!({ "closed": true })).await
}

pub async fn delete_poll(db: &DbClient, poll_id: &str, user_id: &str) -> Result<(), String> {
    db.delete("menu_polls", &format!("id=eq.{}&created_by=eq.{}", poll_id, user_id)).await
}

// 하루 지난 투표는 메뉴 화면 진입 시 정리
pub async fn purge_old(db: &DbClient) -> Result<(), String> {
    let cutoff = now_ms() - 24 * 60 * 60 * 1000;
    db.delete("menu_polls", &format!("created_at=lt.{}", cutoff)).await
}

// ── 메뉴 화면 진입 ───────────────────────────────────────────────────────────
pub fn enter(state: Arc<AppState>, app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let guard = state.db.lock().await;
        if let Some(db) = guard.as_ref() {
            let _ = purge_old(db).await;
            match list_polls(db).await {
                Ok(_)  => { app.emit("refresh", ()).ok(); }
                Err(e) => { state.log(&format!("menu: enter refresh err={}", e)); }
            }
        }
    });
}

// 로그인 중인 다른 기기들에 즉시 push (병렬 발사 — stale 기기 하나가 나머지를 지연시키지 않도록)
pub async fn push_to_others(db: &DbClient, my_id: &str, poll_id: &str, title: &str) {
    let Ok(rows) = db.select("users", "select=id,ip&is_online=eq.true").await else { return };
    let mut handles = Vec::new();
    for row in &rows {
        if row["id"].as_str() == Some(my_id) { continue; }
        let Some(ip) = row["ip"].as_str() else { continue };
        let (ip, poll_id, title) = (ip.to_string(), poll_id.to_string(), title.to_string());
        handles.push(tokio::spawn(async move {
            let _ = admin::send_menu(&ip, &poll_id, &title).await;
        }));
    }
    for h in handles { let _ = h.await; }
}

fn str_v(v: &Value, k: &str) -> String {
    v[k].as_str().unwrap_or("").to_string()
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
