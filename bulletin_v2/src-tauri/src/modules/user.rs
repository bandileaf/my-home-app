use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;
use crate::core::db::DbClient;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub id: String,
    #[serde(rename = "deviceId")]
    pub device_id: String,
    pub hostname: String,
    pub alias: Option<String>,
    pub avatar: Option<String>,
    #[serde(rename = "isOnline")]
    pub is_online: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserSession {
    #[serde(rename = "userId")]
    pub user_id: String,
    pub alias: Option<String>,
    pub avatar: Option<String>,
}

pub async fn upsert_user(
    db: &DbClient,
    hostname: &str,
    mac_addresses: &[String],
    ip: Option<&str>,
    device_id: &str,
    version: Option<&str>,
) -> Result<UserSession, String> {
    let now = now_ms();

    let existing = db.select_one("users",
        &format!("device_id=eq.{}&select=id,alias,avatar,app_info", device_id)).await?;

    if let Some(row) = existing {
        let user_id = str_v(&row, "id");
        let alias = row["alias"].as_str().map(String::from);
        let avatar = row["avatar"].as_str().map(String::from);
        let mut app_info = row["app_info"].clone();
        if let Some(v) = version {
            app_info["version"] = json!(v);
        }
        db.update("users", &format!("id=eq.{}", user_id), json!({
            "hostname": hostname, "ip": ip,
            "is_online": true, "last_seen": now, "app_info": app_info,
        })).await?;
        return Ok(UserSession { user_id, alias, avatar });
    }

    let user_id = Uuid::new_v4().to_string();
    let app_info = version.map(|v| json!({ "version": v })).unwrap_or(json!({}));
    db.insert("users", json!({
        "id": user_id, "hostname": hostname,
        "mac_addresses": mac_addresses, "ip": ip,
        "device_id": device_id, "is_online": true,
        "app_info": app_info, "last_seen": now, "created_at": now,
    })).await?;
    Ok(UserSession { user_id, alias: None, avatar: None })
}

pub async fn list_users(db: &DbClient) -> Result<Vec<UserProfile>, String> {
    let rows = db.select("users", "select=id,device_id,hostname,alias,avatar,is_online").await?;
    Ok(rows.iter().map(|r| UserProfile {
        id: str_v(r, "id"),
        device_id: str_v(r, "device_id"),
        hostname: str_v(r, "hostname"),
        alias: r["alias"].as_str().map(String::from),
        avatar: r["avatar"].as_str().map(String::from),
        is_online: r["is_online"].as_bool().unwrap_or(false),
    }).collect())
}

pub async fn save_alias(db: &DbClient, user_id: &str, alias: Option<&str>) -> Result<(), String> {
    db.update("users", &format!("id=eq.{}", user_id), json!({ "alias": alias })).await
}

pub async fn save_avatar(db: &DbClient, user_id: &str, avatar: Option<&str>) -> Result<(), String> {
    db.update("users", &format!("id=eq.{}", user_id), json!({ "avatar": avatar })).await
}

pub async fn set_offline(db: &DbClient, device_id: &str) -> Result<(), String> {
    db.update("users", &format!("device_id=eq.{}", device_id), json!({
        "is_online": false, "last_seen": now_ms(),
    })).await
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
