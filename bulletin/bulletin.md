# bulletin_v2 아키텍처

## 기술 스택
- **Rust** (백엔드) + **React + TypeScript** (프론트엔드)
- **Tauri v2** — 두 레이어를 묶는 프레임워크 (브릿지 역할)
- **Supabase** — REST API 방식으로 직접 호출 (JS SDK 없음)

---

## 파일 구조

```
bulletin/
├── src-ui/                       ← React 프론트엔드
│   ├── main.tsx                  ← 진입점: label='main'→App, label='toast'→ToastApp
│   ├── App.tsx                   ← 라우터, 전역 상태
│   ├── Toast.tsx                 ← 토스트 알림 창 (독립 WebviewWindow)
│   ├── types.ts                  ← 공유 타입 단일 정의
│   ├── utils.ts                  ← display_name_of, initials_of
│   ├── dashboard.css             ← 전체 스타일
│   ├── hooks/
│   │   ├── useNotices.ts
│   │   ├── useChat.ts
│   │   ├── useSchedules.ts
│   │   └── useUsers.ts
│   └── components/
│       ├── Sidebar.tsx
│       ├── NoticePage.tsx
│       ├── ChatPage.tsx
│       ├── CalendarPage.tsx
│       ├── AdminPage.tsx
│       ├── NoSettingsPage.tsx
│       └── DisabledPage.tsx
│
└── src-tauri/src/                ← Rust 백엔드
    ├── lib.rs                    ← AppState, 명령 등록, 폴링, 제어 서버
    ├── main.rs                   ← 진입점 (lib::run() 호출만)
    ├── core/
    │   ├── system.rs             ← Settings 읽기/쓰기, 로그, device_id
    │   ├── db.rs                 ← DbClient (Supabase REST)
    │   ├── http.rs               ← 범용 HTTP 유틸
    │   ├── notify.rs             ← 알림 큐 + toast 창 생애주기 관리
    │   ├── scheduler.rs          ← 지연 실행 큐 (ticker 기반 작업 스케줄러)
    │   ├── update.rs             ← 자동 업데이트 (GitHub Releases)
    │   └── window.rs             ← WindowState (페이지/가시성 추적)
    └── modules/
        ├── notice.rs
        ├── chat.rs
        ├── calendar.rs
        ├── user.rs
        └── admin.rs
```

---

## 전체 아키텍처

```
┌──────────────────────────────────────────────────────────────────────┐
│                        React (UI 레이어)                              │
│                                                                       │
│  ┌─────────────────────────────┐   ┌──────────────────────────────┐  │
│  │        main 창 (App.tsx)    │   │  toast 창 (Toast.tsx)        │  │
│  │                             │   │  동적 생성/삭제               │  │
│  │  hooks: useNotices          │   │                              │  │
│  │         useChat             │   │  마운트 시:                   │  │
│  │         useSchedules        │   │  get_pending_toasts()        │  │
│  │         useUsers            │   │                              │  │
│  │                             │   │  listen('toast', handler)    │  │
│  │  listen('refresh', cb)      │   │                              │  │
│  │  listen('settings_changed') │   │  내용 없을 때 → win.destroy()│  │
│  └──────────────┬──────────────┘   └──────────────────────────────┘  │
└─────────────────┼────────────────────────────────────────────────────┘
                  │ invoke() / emit()          ▲ emit('toast', event)
             [Tauri IPC 브릿지]               │
                  │                            │
┌─────────────────▼────────────────────────────┼─────────────────────┐
│                      Rust (백엔드 레이어)     │                      │
│                                              │                      │
│  ┌──────────────────────────────────────┐    │                      │
│  │  AppState (Arc<AppState>)            │    │                      │
│  │   ├── db: Mutex<Option<DbClient>>    │    │                      │
│  │   ├── session: Mutex<Option<..>>     │    │                      │
│  │   ├── window: WindowState            │    │                      │
│  │   └── notify: NotifyQueue ───────────┼────┘                      │
│  └──────────────────────────────────────┘    ▲                      │
│                                              │ .chat() / .notice()  │
│  ┌────────────────┐   ┌────────────────┐     │ .update_start()      │
│  │   Scheduler    │   │  NotifyQueue   │─────┘                      │
│  │  (독립 인스턴스)│   │  (독립 인스턴스)│                            │
│  │                │   │                │                            │
│  │  .after(ms, f) │   │ 알림 이벤트 큐 │                            │
│  │  재등록 → 루프 │   │ toast 창 생성/ │                            │
│  │  미등록 → 종료 │   │ destroy 관리   │                            │
│  └───────┬────────┘   └────────────────┘                            │
│          │                                                           │
│  start_polling() — 10s 재등록 루프                                   │
│  (chat 폴링 → notify.chat() 또는 emit('refresh'))                    │
│                                                                      │
│  [제어 서버 :61799]                                                   │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ HTTP REST
                                   ▼
                             [Supabase DB]
```

---

## 핵심 컴포넌트 설명

### `core/notify.rs` — 알림 큐 + Toast 창 생애주기
```
다른 모듈 → NotifyQueue.chat() / .notice() / .update_start()
                          │
                    mpsc 채널 (큐)
                          │
                  run_scheduler() [async task]
                          │
          ┌───────────────┴───────────────────┐
          │ toast 창 없음                     │ toast 창 있음
          ▼                                   ▼
  PendingToasts state에 저장           app.emit("toast", event)
  + WebviewWindow 생성                        │
          │                                   ▼
          ▼                          listen('toast') → 카드 렌더
  React 마운트 → get_pending_toasts()
  → 카드 렌더 → 내용 소멸 → win.destroy()
```

**알림 타입별 동작:**
| 타입 | X버튼 | 사라지는 시점 |
|------|-------|-------------|
| Chat | 없음 | N초 자동 fadeout |
| Notice | 있음 | X 수동 닫기 |
| Update | 없음 | `handle.done()` 후 2초 |

### `core/scheduler.rs` — 지연 실행 큐
```
caller → sched.after(delay_ms, async_fn)
                │
          mpsc 채널 (Ticket 큐)
                │
          run loop [tokio spawn]
                │
         delay 후 async_fn() 실행
                │
         (fn 내부에서 sched.after() 재호출 → 루프 유지)
         (재호출 안 하면 → 루프 종료)
```

**사용 패턴:**
```rust
fn start_chat_poll(sched: Scheduler, state: Arc<AppState>, app: AppHandle) {
    let s = sched.clone();
    sched.after(1_000, move || async move {
        refresh_chat(&state, &app).await;
        if state.window.is_on_chat_page() {
            start_chat_poll(s, state, app);  // 재등록 → 루프
        }
        // 조건 불충족 → 재등록 없음 → 루프 종료
    });
}
```

---

## 데이터 흐름

### React → DB (쓰기)
```
컴포넌트 → hook.create() → invoke('create_notice', {...})
  → Rust create_notice() → notice::create_notice(&db)
  → DbClient.insert("notices", json)
  → POST {supabase_url}/rest/v1/notices
```

### DB → React (폴링 기반 갱신)
```
Scheduler (10s 루프)
  → chat::list_messages(&db) → 새 메시지 감지
  → notify.chat() → toast 창 생성 + 카드 표시
     또는
  → app.emit("refresh") → listen('refresh') → hook.refresh()
```

### 알림 흐름 (toast 창 없는 경우)
```
notify.chat("홍길동", "안녕")
  → NotifyQueue → mpsc 채널
  → run_scheduler() 깨어남
  → PendingToasts state에 push
  → WebviewWindow::new("toast") 생성
  → React 마운트 → invoke('get_pending_toasts') → 카드 렌더
  → 6초 후 fadeout → destroy()
```

### 알림 흐름 (toast 창 이미 열린 경우)
```
notify.notice("공지-id", "저녁 메뉴")
  → run_scheduler() → app.emit("toast", Notice{...})
  → Toast.tsx listen('toast', handler) → 카드 추가
```

---

## Rust 모듈 의존성

```
lib.rs
 ├── core::system    (의존 없음)
 ├── core::db        (reqwest)
 ├── core::http      (reqwest)
 ├── core::notify    (tauri::Emitter, tokio::mpsc)
 ├── core::scheduler (tokio::mpsc, tokio::spawn)
 ├── core::update    (core::notify::NotifyQueue, reqwest, futures_util)
 ├── core::window    (의존 없음)
 ├── modules::notice (core::db)
 ├── modules::chat   (core::db)
 ├── modules::calendar (core::db)
 ├── modules::user   (core::db)
 └── modules::admin  (core::http, tokio::net)
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
| `hide_window` | 메인 창 숨기기 |
| `show_window` | 메인 창 표시 |
| `set_active_page` | 활성 페이지 변경 |
| `cancel_update` | 업데이트 취소 |
| `get_pending_toasts` | 대기 중인 toast 이벤트 조회 (toast 창 마운트 시 호출) |
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
