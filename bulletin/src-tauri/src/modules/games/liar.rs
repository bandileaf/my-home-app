use rand::seq::SliceRandom;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;
use crate::core::db::DbClient;
use super::super::admin;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiarParticipant {
    #[serde(rename = "userId")]
    pub user_id: String,
    #[serde(rename = "joinedAt")]
    pub joined_at: i64,
    pub ready: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiarVote {
    #[serde(rename = "userId")]
    pub user_id: String,
    #[serde(rename = "targetUserId")]
    pub target_user_id: String,
    #[serde(rename = "votedAt")]
    pub voted_at: i64,
}

// DB에 저장되는 내부 표현 — word/liar_user_id를 그대로 담고 있어 절대 프론트에 직접 반환하면 안 됨
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiarRoom {
    pub id: String,
    pub phase: String,
    pub participants: Vec<LiarParticipant>,
    pub word: Option<String>,
    pub liar_user_id: Option<String>,
    pub votes: Vec<LiarVote>,
    pub result: Option<String>,
    pub muted_user_ids: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

// 방 참가자 전용 대화 — 가족 전체 메신저와 별개 (참가하지 않은 사람에게 알림이 가지 않도록)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiarMessage {
    pub id: String,
    #[serde(rename = "userId")]
    pub user_id: String,
    pub text: String,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
}

// 요청자(my_id) 기준으로 비밀이 redaction된, 프론트에 실제로 내려주는 뷰
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiarRoomView {
    pub id: String,
    pub phase: String,
    pub participants: Vec<LiarParticipant>,
    #[serde(rename = "yourRole")]
    pub your_role: Option<String>,
    pub word: Option<String>,
    #[serde(rename = "liarUserId")]
    pub liar_user_id: Option<String>,
    pub votes: Vec<LiarVote>,
    pub result: Option<String>,
    #[serde(rename = "mutedUserIds")]
    pub muted_user_ids: Vec<String>,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
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

fn parse_participants(v: &Value) -> Vec<LiarParticipant> {
    v.as_array().map(|arr| arr.iter().map(|r| LiarParticipant {
        user_id: str_v(r, "user_id"),
        joined_at: r["joined_at"].as_i64().unwrap_or(0),
        ready: r["ready"].as_bool().unwrap_or(false),
    }).collect()).unwrap_or_default()
}

fn parse_votes(v: &Value) -> Vec<LiarVote> {
    v.as_array().map(|arr| arr.iter().map(|r| LiarVote {
        user_id: str_v(r, "user_id"),
        target_user_id: str_v(r, "target_user_id"),
        voted_at: r["voted_at"].as_i64().unwrap_or(0),
    }).collect()).unwrap_or_default()
}

fn parse_muted(v: &Value) -> Vec<String> {
    v.as_array().map(|arr| arr.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default()
}

fn parse_room(r: &Value) -> LiarRoom {
    LiarRoom {
        id: str_v(r, "id"),
        phase: str_v(r, "phase"),
        participants: parse_participants(&r["participants"]),
        word: r["word"].as_str().map(String::from),
        liar_user_id: r["liar_user_id"].as_str().map(String::from),
        votes: parse_votes(&r["votes"]),
        result: r["result"].as_str().map(String::from),
        muted_user_ids: parse_muted(&r["muted_user_ids"]),
        created_at: r["created_at"].as_i64().unwrap_or(0),
        updated_at: r["updated_at"].as_i64().unwrap_or(0),
    }
}

fn participants_json(participants: &[LiarParticipant]) -> Vec<Value> {
    participants.iter().map(|p| json!({ "user_id": p.user_id, "joined_at": p.joined_at, "ready": p.ready })).collect()
}

fn votes_json(votes: &[LiarVote]) -> Vec<Value> {
    votes.iter().map(|v| json!({
        "user_id": v.user_id, "target_user_id": v.target_user_id, "voted_at": v.voted_at,
    })).collect()
}

// 요청자 기준으로 word/liar_user_id를 가려서 내려준다 — 라이어에게는 word를, 나머지에게는
// liar_user_id를 게임이 끝나기 전까지 절대 노출하지 않는다.
pub fn to_view(room: &LiarRoom, my_id: &str) -> LiarRoomView {
    let is_liar = room.liar_user_id.as_deref() == Some(my_id);

    let your_role = if room.phase == "waiting" {
        None
    } else if is_liar {
        Some("liar".to_string())
    } else if room.participants.iter().any(|p| p.user_id == my_id) {
        Some("citizen".to_string())
    } else {
        None
    };

    let word = match room.phase.as_str() {
        "waiting" => None,
        "ended"   => room.word.clone(),
        _         => if is_liar { None } else { room.word.clone() },
    };

    let liar_user_id = if room.phase == "ended" { room.liar_user_id.clone() } else { None };

    LiarRoomView {
        id: room.id.clone(),
        phase: room.phase.clone(),
        participants: room.participants.clone(),
        your_role,
        word,
        liar_user_id,
        votes: room.votes.clone(),
        result: room.result.clone(),
        muted_user_ids: room.muted_user_ids.clone(),
        created_at: room.created_at,
        updated_at: room.updated_at,
    }
}

pub async fn get_room(db: &DbClient, room_id: &str) -> Result<Option<LiarRoom>, String> {
    let row = db.select_one("game_liar_rooms", &format!("id=eq.{}", room_id)).await?;
    Ok(row.map(|r| parse_room(&r)))
}

pub async fn get_latest(db: &DbClient) -> Result<Option<LiarRoom>, String> {
    let row = db.select_one("game_liar_rooms", "order=created_at.desc&limit=1").await?;
    Ok(row.map(|r| parse_room(&r)))
}

async fn create_room(db: &DbClient, user_id: &str) -> Result<LiarRoom, String> {
    let id = Uuid::new_v4().to_string();
    let now = now_ms();
    db.insert("game_liar_rooms", json!({
        "id": id, "phase": "waiting",
        "participants": vec![json!({ "user_id": user_id, "joined_at": now, "ready": false })],
        "word": Value::Null, "liar_user_id": Value::Null,
        "votes": Vec::<Value>::new(), "result": Value::Null,
        "muted_user_ids": Vec::<Value>::new(),
        "created_at": now, "updated_at": now,
    })).await?;
    get_room(db, &id).await?.ok_or_else(|| "room not found after create".to_string())
}

pub async fn join(db: &DbClient, user_id: &str) -> Result<LiarRoom, String> {
    match get_latest(db).await? {
        None => create_room(db, user_id).await,
        Some(room) if room.phase == "ended" => create_room(db, user_id).await,
        Some(room) if room.phase == "waiting" => {
            if room.participants.iter().any(|p| p.user_id == user_id) {
                return Ok(room);
            }
            let mut participants = room.participants.clone();
            participants.push(LiarParticipant { user_id: user_id.to_string(), joined_at: now_ms(), ready: false });
            db.update("game_liar_rooms", &format!("id=eq.{}", room.id), json!({
                "participants": participants_json(&participants), "updated_at": now_ms(),
            })).await?;
            get_room(db, &room.id).await?.ok_or_else(|| "room not found after join".to_string())
        }
        Some(room) => Ok(room),
    }
}

pub async fn leave(db: &DbClient, user_id: &str) -> Result<Option<LiarRoom>, String> {
    let Some(room) = get_latest(db).await? else { return Ok(None) };
    if room.phase != "waiting" { return Ok(None); }
    if !room.participants.iter().any(|p| p.user_id == user_id) { return Ok(None); }
    let remaining: Vec<LiarParticipant> = room.participants.into_iter().filter(|p| p.user_id != user_id).collect();
    db.update("game_liar_rooms", &format!("id=eq.{}", room.id), json!({
        "participants": participants_json(&remaining), "updated_at": now_ms(),
    })).await?;
    get_room(db, &room.id).await
}

// 참가자 각자 준비(READY) 상태를 토글 — 전원이 준비되면 그 즉시(마지막으로 준비를 누른
// 사람의 요청 안에서) 제시어/라이어를 뽑아 바로 게임을 시작한다. 별도의 "시작" 버튼 없음.
pub async fn toggle_ready(db: &DbClient, room_id: &str, user_id: &str) -> Result<LiarRoom, String> {
    let room = get_room(db, room_id).await?.ok_or("room not found")?;
    if room.phase != "waiting" { return Err("이미 시작된 게임입니다".to_string()); }
    if !room.participants.iter().any(|p| p.user_id == user_id) {
        return Err("참가자가 아닙니다".to_string());
    }

    let participants: Vec<LiarParticipant> = room.participants.iter().map(|p| {
        if p.user_id == user_id {
            LiarParticipant { ready: !p.ready, ..p.clone() }
        } else {
            p.clone()
        }
    }).collect();

    let all_ready = !participants.is_empty() && participants.iter().all(|p| p.ready);

    let mut body = json!({ "participants": participants_json(&participants), "updated_at": now_ms() });

    if all_ready {
        let word_rows = db.select("game_liar_words", "select=word").await?;
        let words: Vec<String> = word_rows.iter().filter_map(|r| r["word"].as_str().map(String::from)).collect();
        if words.is_empty() {
            return Err("등록된 제시어가 없습니다. game_liar_words 테이블에 단어를 추가해주세요".to_string());
        }

        // ThreadRng는 Send가 아니라 await 경계를 넘길 수 없으므로, 값을 뽑아 소유권을 가진 뒤 즉시 drop한다
        let (word, liar_user_id) = {
            let mut rng = rand::thread_rng();
            let word = words.choose(&mut rng).cloned().unwrap_or_default();
            let liar = participants.choose(&mut rng).ok_or("no participants")?;
            (word, liar.user_id.clone())
        };

        body["phase"] = json!("playing");
        body["word"] = json!(word);
        body["liar_user_id"] = json!(liar_user_id);
    }

    db.update("game_liar_rooms", &format!("id=eq.{}", room_id), body).await?;
    get_room(db, room_id).await?.ok_or_else(|| "room not found after toggle_ready".to_string())
}

pub async fn open_voting(db: &DbClient, room_id: &str) -> Result<LiarRoom, String> {
    let room = get_room(db, room_id).await?.ok_or("room not found")?;
    if room.phase != "playing" { return Err("게임 진행 중이 아닙니다".to_string()); }
    db.update("game_liar_rooms", &format!("id=eq.{}", room_id), json!({
        "phase": "voting", "votes": Vec::<Value>::new(), "updated_at": now_ms(),
    })).await?;
    get_room(db, room_id).await?.ok_or_else(|| "room not found after open_voting".to_string())
}

pub async fn cast_vote(db: &DbClient, room_id: &str, user_id: &str, target_user_id: &str) -> Result<LiarRoom, String> {
    let room = get_room(db, room_id).await?.ok_or("room not found")?;
    if room.phase != "voting" { return Err("투표 중이 아닙니다".to_string()); }
    if !room.participants.iter().any(|p| p.user_id == user_id) {
        return Err("참가자가 아닙니다".to_string());
    }

    let mut votes: Vec<LiarVote> = room.votes.into_iter().filter(|v| v.user_id != user_id).collect();
    votes.push(LiarVote { user_id: user_id.to_string(), target_user_id: target_user_id.to_string(), voted_at: now_ms() });

    let mut body = json!({ "votes": votes_json(&votes), "updated_at": now_ms() });

    // 전원 투표 완료 → 자동 집계 후 라운드 종료
    if votes.len() >= room.participants.len() {
        let mut counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
        for v in &votes {
            *counts.entry(v.target_user_id.clone()).or_insert(0) += 1;
        }
        let max = counts.values().copied().max().unwrap_or(0);
        let top: Vec<&String> = counts.iter().filter(|(_, &c)| c == max).map(|(k, _)| k).collect();
        let liar_id = room.liar_user_id.clone().unwrap_or_default();
        let found = top.len() == 1 && top[0] == &liar_id;

        let muted: Vec<String> = if found {
            vec![]
        } else {
            votes.iter().filter(|v| v.target_user_id != liar_id).map(|v| v.user_id.clone()).collect()
        };

        body["phase"] = json!("ended");
        body["result"] = json!(if found { "citizens_win" } else { "liar_win" });
        body["muted_user_ids"] = json!(muted);
    }

    db.update("game_liar_rooms", &format!("id=eq.{}", room_id), body).await?;
    get_room(db, room_id).await?.ok_or_else(|| "room not found after vote".to_string())
}

// 최신 라운드가 종료됐고 내가 오답자 목록에 있으면 채팅 차단 — 새 라운드가 시작되는 순간
// (최신 방이 바뀌므로) 자연히 해제된다.
pub async fn is_muted(db: &DbClient, user_id: &str) -> bool {
    match get_latest(db).await {
        Ok(Some(room)) => room.phase == "ended" && room.muted_user_ids.iter().any(|m| m == user_id),
        _ => false,
    }
}

fn parse_messages(rows: &[Value]) -> Vec<LiarMessage> {
    rows.iter().map(|r| LiarMessage {
        id: str_v(r, "id"),
        user_id: str_v(r, "user_id"),
        text: str_v(r, "text"),
        created_at: r["created_at"].as_i64().unwrap_or(0),
    }).collect()
}

pub async fn list_messages(db: &DbClient, room_id: &str) -> Result<Vec<LiarMessage>, String> {
    let rows = db.select("game_liar_messages", &format!("room_id=eq.{}&order=created_at.asc", room_id)).await?;
    Ok(parse_messages(&rows))
}

pub async fn send_message(db: &DbClient, room_id: &str, user_id: &str, text: &str) -> Result<(), String> {
    if is_muted(db, user_id).await {
        return Err("라이어 게임에서 라이어를 찾지 못해 채팅이 제한되었습니다".to_string());
    }
    db.insert("game_liar_messages", json!({
        "id": Uuid::new_v4().to_string(),
        "room_id": room_id, "user_id": user_id, "text": text,
        "created_at": now_ms(),
    })).await
}

// 방 참가자에게만 조용히 refresh ping (참가하지 않은 사람에게는 절대 가지 않음, 토스트 없음, 병렬 발사)
pub async fn push_to_others(db: &DbClient, room_id: &str, my_id: &str) {
    let Ok(Some(room)) = get_room(db, room_id).await else { return };
    let Ok(rows) = db.select("users", "select=id,ip&is_online=eq.true").await else { return };
    let mut handles = Vec::new();
    for row in &rows {
        let Some(id) = row["id"].as_str() else { continue };
        if id == my_id || !room.participants.iter().any(|p| p.user_id == id) { continue; }
        let Some(ip) = row["ip"].as_str() else { continue };
        let ip = ip.to_string();
        handles.push(tokio::spawn(async move {
            let _ = admin::send_game_ping(&ip).await;
        }));
    }
    for h in handles { let _ = h.await; }
}

// 라이어 게임 데이터(방/대화) 전체 초기화 — 막힌 방 등을 정리하고 완전히 새로 시작할 때 사용
pub async fn reset(db: &DbClient) -> Result<(), String> {
    const NIL: &str = "00000000-0000-0000-0000-000000000000";
    db.delete("game_liar_messages", &format!("id=neq.{}", NIL)).await?;
    db.delete("game_liar_rooms", &format!("id=neq.{}", NIL)).await?;
    Ok(())
}

// 초기화 사실을 참가 여부와 무관하게 모든 온라인 기기에 알림 (조용히 refresh만)
pub async fn push_reset_to_all(db: &DbClient, my_id: &str) {
    let Ok(rows) = db.select("users", "select=id,ip&is_online=eq.true").await else { return };
    let mut handles = Vec::new();
    for row in &rows {
        if row["id"].as_str() == Some(my_id) { continue; }
        let Some(ip) = row["ip"].as_str() else { continue };
        let ip = ip.to_string();
        handles.push(tokio::spawn(async move {
            let _ = admin::send_game_ping(&ip).await;
        }));
    }
    for h in handles { let _ = h.await; }
}
