use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;
use crate::core::db::DbClient;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Schedule {
    pub id: String,
    #[serde(rename = "userId")]
    pub user_id: String,
    pub title: String,
    pub date: String,
    #[serde(rename = "endDate")]
    pub end_date: Option<String>,
    #[serde(rename = "allDay")]
    pub all_day: bool,
    #[serde(rename = "startTime")]
    pub start_time: Option<String>,
    #[serde(rename = "endTime")]
    pub end_time: Option<String>,
    #[serde(rename = "repeatWeekly")]
    pub repeat_weekly: bool,
    #[serde(rename = "repeatMonthly")]
    pub repeat_monthly: bool,
    pub memo: Option<String>,
    pub color: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
}

fn parse_schedule(r: &Value) -> Schedule {
    Schedule {
        id: str_v(r, "id"),
        user_id: str_v(r, "user_id"),
        title: str_v(r, "title"),
        date: str_v(r, "date"),
        end_date: r["end_date"].as_str().map(String::from),
        all_day: r["all_day"].as_bool().unwrap_or(false),
        start_time: r["start_time"].as_str().map(String::from),
        end_time: r["end_time"].as_str().map(String::from),
        repeat_weekly: r["repeat_weekly"].as_bool().unwrap_or(false),
        repeat_monthly: r["repeat_monthly"].as_bool().unwrap_or(false),
        memo: r["memo"].as_str().map(String::from),
        color: r["color"].as_str().unwrap_or("#a78bfa").to_string(),
        created_at: r["created_at"].as_i64().unwrap_or(0),
    }
}

pub async fn list_schedules(db: &DbClient) -> Result<Vec<Schedule>, String> {
    let rows = db.select("schedules", "select=*&order=created_at.asc").await?;
    Ok(rows.iter().map(parse_schedule).collect())
}

pub async fn create_schedule(
    db: &DbClient,
    user_id: &str,
    title: &str,
    date: &str,
    end_date: Option<&str>,
    all_day: bool,
    start_time: Option<&str>,
    end_time: Option<&str>,
    repeat_weekly: bool,
    repeat_monthly: bool,
    memo: Option<&str>,
    color: &str,
) -> Result<(), String> {
    db.insert("schedules", json!({
        "id": Uuid::new_v4().to_string(),
        "user_id": user_id,
        "title": title,
        "date": date,
        "end_date": end_date,
        "all_day": all_day,
        "start_time": start_time,
        "end_time": end_time,
        "repeat_weekly": repeat_weekly,
        "repeat_monthly": repeat_monthly,
        "memo": memo,
        "color": color,
        "created_at": now_ms(),
    })).await
}

pub async fn delete_schedule(db: &DbClient, id: &str, user_id: &str) -> Result<(), String> {
    db.delete("schedules", &format!("id=eq.{}&user_id=eq.{}", id, user_id)).await
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
