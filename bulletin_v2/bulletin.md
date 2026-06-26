# bulletin_v2 아키텍처

## 기술 스택
- **Rust** (백엔드) + **React + TypeScript** (프론트엔드)
- **Tauri v2** — 두 레이어를 묶는 프레임워크 (브릿지 역할)
- **Supabase** — REST API 방식으로 직접 호출 (JS SDK 없음)

---

## 파일 구조

```
bulletin_v2/
├── src/                          ← React 프론트엔드
│   ├── main.tsx                  ← React 진입점
│   ├── App.tsx                   ← 라우터, 전역 상태
│   ├── types.ts                  ← 공유 타입 단일 정의 (single source of truth)
│   ├── utils.ts                  ← display_name_of, initials_of
│   ├── dashboard.css             ← 전체 스타일
│   ├── hooks/
│   │   ├── useNotices.ts         ← 알림장 CRUD
│   │   ├── useChat.ts            ← 채팅 CRUD
│   │   ├── useSchedules.ts       ← 캘린더 CRUD
│   │   └── useUsers.ts           ← 사용자 세션/목록
│   └── components/
│       ├── Sidebar.tsx           ← 탭 네비게이션 + 프로필
│       ├── ProfilePanel.tsx      ← 프로필 편집 패널
│       ├── NoticePage.tsx        ← 알림장 페이지
│       ├── NoticeCard.tsx        ← 알림 카드 (답글/투표 포함)
│       ├── ChatPage.tsx          ← 채팅 페이지
│       ├── CalendarPage.tsx      ← 달력 페이지 (플로팅 입력 패널)
│       ├── AdminPage.tsx         ← 관리 페이지 (서브넷 스캔)
│       ├── NoSettingsPage.tsx    ← settings.json 없을 때
│       ├── DisabledPage.tsx      ← hub.disabled=true 일 때
│       ├── NavRound.tsx          ← 좌/우 페이지 전환 버튼
│       └── Dots.tsx              ← 페이지 위치 표시 점
│
└── src-tauri/src/                ← Rust 백엔드
    ├── lib.rs                    ← AppState, 명령 등록, 폴링, 제어 서버
    ├── main.rs                   ← 진입점 (lib::run() 호출만)
    ├── core/
    │   ├── mod.rs
    │   ├── system.rs             ← Settings 읽기/쓰기, 로그, device_id, hostname
    │   ├── db.rs                 ← DbClient (Supabase REST)
    │   └── http.rs               ← 범용 HTTP 유틸 (관리자 스캔용)
    └── modules/
        ├── mod.rs
        ├── notice.rs             ← Notice, Reply, Vote
        ├── chat.rs               ← ChatMessage
        ├── calendar.rs           ← Schedule
        ├── user.rs               ← UserProfile, UserSession
        └── admin.rs              ← DeviceStatus, 서브넷 스캔
```

---

## 아키텍처 계층도

```
┌─────────────────────────────────────────────────┐
│                  React (UI 레이어)               │
│                                                  │
│  App.tsx                                         │
│   ├── hooks/useNotices   → invoke('list_notices')│
│   ├── hooks/useChat      → invoke('list_messages')│
│   ├── hooks/useSchedules → invoke('list_schedules')│
│   └── hooks/useUsers     → invoke('get_session') │
│                                                  │
│  listen('refresh') ←── Rust emit() 10초 폴링    │
└───────────────────────┬─────────────────────────┘
                        │ invoke() / emit()
                   [Tauri IPC 브릿지]
                        │
┌───────────────────────▼─────────────────────────┐
│                  Rust (백엔드 레이어)             │
│                                                  │
│  lib.rs (AppState + 명령 핸들러)                 │
│   ├── core/system.rs   ← 설정, 로그, 신원        │
│   ├── core/db.rs       ← Supabase REST 클라이언트│
│   ├── core/http.rs     ← 범용 HTTP               │
│   ├── modules/notice.rs                          │
│   ├── modules/chat.rs                            │
│   ├── modules/calendar.rs                        │
│   ├── modules/user.rs                            │
│   └── modules/admin.rs                           │
│                                                  │
│  [제어 서버 :61799]  [10초 폴링 루프]            │
└───────────────────────┬─────────────────────────┘
                        │ HTTP REST
                        ▼
                  [Supabase DB]
```

---

## 데이터 흐름

### React → DB (쓰기)
```
컴포넌트 → hook.create() → invoke('create_notice', {...})
  → Rust cmd_create_notice() → notice::create_notice(&db)
  → DbClient.insert("notices", json)
  → POST {supabase_url}/rest/v1/notices
```

### DB → React (읽기 / 실시간)
```
Rust 폴링 루프 (10초)
  → app.emit("refresh", ())
  → React listen('refresh', cb)
  → hook.refresh() → invoke('list_notices')
  → Rust → DbClient.select("notices")
  → GET {supabase_url}/rest/v1/notices?select=*
```

### 원격 제어 (관리자)
```
AdminPage → invoke('scan_subnet')
  → admin::scan_subnet() → TCP probe :61799 → GET /status
  → 발견된 IP 목록 반환

invoke('admin_send_settings', {ip, body})
  → admin::send_settings() → POST http://{ip}:61799/settings
  → 대상 기기 control server → settings.json 저장 → 앱 재시작
```

---

## Rust 모듈 의존성

```
lib.rs
 ├── core::system    (의존 없음 — 외부: chrono, mac_address)
 ├── core::db        (의존: reqwest)
 ├── core::http      (의존: reqwest)
 ├── modules::notice (의존: core::db)
 ├── modules::chat   (의존: core::db, chrono)
 ├── modules::calendar (의존: core::db)
 ├── modules::user   (의존: core::db)
 └── modules::admin  (의존: core::http, tokio::net)
```

---

## React 컴포넌트 계층도

```
App.tsx
 ├── [hooks] useNotices, useChat, useSchedules, useUsers
 ├── Sidebar
 │    └── ProfilePanel
 ├── NoticePage
 │    └── NoticeCard (× n)
 ├── ChatPage
 ├── CalendarPage         ← 플로팅 입력 패널 내장
 ├── AdminPage
 ├── NoSettingsPage       ← settings.json 없을 때 분기
 ├── DisabledPage         ← hub.disabled=true 분기
 ├── NavRound (좌/우)
 └── Dots
```

---

## Tauri 명령어 목록

| 명령어 | 설명 |
|--------|------|
| `list_notices` | 알림 목록 |
| `create_notice` | 알림 생성 |
| `create_reply` | 알림 답글 |
| `cast_vote` | Yes/No 투표 |
| `update_notice` | 알림 수정 |
| `delete_notice` | 알림 삭제 |
| `list_messages` | 채팅 목록 |
| `send_message` | 메시지 전송 |
| `delete_message` | 메시지 삭제 |
| `mark_read` | 읽음 처리 |
| `list_schedules` | 일정 목록 |
| `create_schedule` | 일정 생성 |
| `delete_schedule` | 일정 삭제 |
| `get_session` | 현재 세션 |
| `list_users` | 사용자 목록 |
| `save_alias` | 닉네임 저장 |
| `save_avatar` | 아바타 저장 |
| `get_settings` | settings.json 읽기 |
| `save_settings_cmd` | settings.json 쓰기 |
| `has_settings` | settings.json 존재 여부 |
| `is_admin` | 관리자 여부 |
| `scan_subnet` | 서브넷 스캔 |
| `admin_fetch_log` | 원격 로그 조회 |
| `admin_fetch_settings` | 원격 설정 조회 |
| `admin_send_settings` | 원격 설정 전송 |
| `admin_restart` | 원격 재시작 |
| `admin_update` | 원격 업데이트 |
| `admin_disable` | 원격 정지 |
| `admin_enable` | 원격 정지 해제 |

---

## 제어 서버 엔드포인트 (:61799)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/status` | deviceId, hostname, version, has_settings, disabled |
| GET | `/settings` | settings.json 내용 |
| GET | `/log` | 로그 파일 내용 |
| POST | `/settings` | settings.json 교체 |
| POST | `/restart` | 앱 재시작 |
| POST | `/update` | hub.tag 초기화 후 재시작 (업데이트 강제) |
| POST | `/disable` | hub.disabled=true 저장 |
| POST | `/enable` | hub.disabled 제거 |
