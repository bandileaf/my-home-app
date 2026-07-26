pub mod liar;

use crate::core::db::DbClient;

// 채팅 모듈이 특정 게임을 몰라도 되도록 뮤트 여부를 여기서 통합 조회
pub async fn is_chat_blocked(db: &DbClient, user_id: &str) -> bool {
    liar::is_muted(db, user_id).await
}
