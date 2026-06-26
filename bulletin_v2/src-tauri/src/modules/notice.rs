use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;
use crate::core::db::DbClient;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Reply {
    pub id: String,
    #[serde(rename = "userId")]
    pub user_id: String,
    pub text: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vote {
    #[serde(rename = "userId")]
    pub user_id: String,
    pub vote: String,
    #[serde(rename = "votedAt")]
    pub voted_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notice {
    pub id: String,
    #[serde(rename = "userId")]
    pub user_id: String,
    pub kind: String,
    pub text: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    pub replies: Vec<Reply>,
    pub votes: Vec<Vote>,
}

fn parse_replies(v: &Value) -> Vec<Reply> {
    v.as_array().map(|arr| arr.iter().map(|r| Reply {
        id: str_v(r, "id"),
        user_id: str_v(r, "user_id"),
        text: str_v(r, "text"),
        created_at: r["created_at"].as_i64().unwrap_or(0),
    }).collect()).unwrap_or_default()
}

fn parse_votes(v: &Value) -> Vec<Vote> {
    v.as_array().map(|arr| arr.iter().map(|r| Vote {
        user_id: str_v(r, "user_id"),
        vote: str_v(r, "vote"),
        voted_at: r["voted_at"].as_i64().unwrap_or(0),
    }).collect()).unwrap_or_default()
}

fn parse_notice(r: &Value) -> Notice {
    Notice {
        id: str_v(r, "id"),
        user_id: str_v(r, "user_id"),
        kind: r["kind"].as_str().unwrap_or("sticker").to_string(),
        text: str_v(r, "text"),
        created_at: r["created_at"].as_i64().unwrap_or(0),
        replies: parse_replies(&r["replies"]),
        votes: parse_votes(&r["votes"]),
    }
}

pub async fn list_notices(db: &DbClient) -> Result<Vec<Notice>, String> {
    let rows = db.select("notices", "select=*&order=created_at.desc").await?;
    Ok(rows.iter().map(parse_notice).collect())
}

pub async fn create_notice(db: &DbClient, user_id: &str, text: &str, kind: &str) -> Result<Notice, String> {
    let notice = Notice {
        id: Uuid::new_v4().to_string(),
        user_id: user_id.to_string(),
        kind: kind.to_string(),
        text: text.to_string(),
        created_at: now_ms(),
        replies: vec![],
        votes: vec![],
    };
    db.insert("notices", json!({
        "id": notice.id, "user_id": notice.user_id,
        "kind": notice.kind, "text": notice.text,
        "created_at": notice.created_at,
    })).await?;
    Ok(notice)
}

pub async fn create_reply(db: &DbClient, notice_id: &str, user_id: &str, text: &str) -> Result<(), String> {
    let row = db.select_one("notices", &format!("id=eq.{}&select=replies", notice_id)).await?
        .ok_or_else(|| "notice not found".to_string())?;
    let mut replies = row["replies"].as_array().cloned().unwrap_or_default();
    replies.push(json!({
        "id": Uuid::new_v4().to_string(),
        "user_id": user_id, "text": text,
        "created_at": now_ms(),
    }));
    db.update("notices", &format!("id=eq.{}", notice_id), json!({ "replies": replies })).await
}

pub async fn cast_vote(db: &DbClient, notice_id: &str, user_id: &str, vote: &str) -> Result<(), String> {
    let row = db.select_one("notices", &format!("id=eq.{}&select=votes", notice_id)).await?
        .ok_or_else(|| "notice not found".to_string())?;
    let mut votes: Vec<Value> = row["votes"].as_array().cloned().unwrap_or_default()
        .into_iter().filter(|v| v["user_id"].as_str() != Some(user_id)).collect();
    votes.push(json!({ "user_id": user_id, "vote": vote, "voted_at": now_ms() }));
    db.update("notices", &format!("id=eq.{}", notice_id), json!({ "votes": votes })).await
}

pub async fn update_notice(db: &DbClient, notice_id: &str, text: &str) -> Result<(), String> {
    db.update("notices", &format!("id=eq.{}", notice_id), json!({ "text": text })).await
}

pub async fn delete_notice(db: &DbClient, notice_id: &str, user_id: &str) -> Result<(), String> {
    db.delete("notices", &format!("id=eq.{}&user_id=eq.{}", notice_id, user_id)).await
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
