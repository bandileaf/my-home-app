# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

FamilyHub: a home hub for sharing all the software a family needs. `media` is the main utility app (`family_media.exe`) and `bulletin` is the family notice board (`family_bulletin.exe`). Each app manages its own updates independently.

## 실행 환경 구분 (중요)

- **이 프로젝트(`D:\Workspace\my_home_app`)는 개발·테스트 공간**이다. 코드 수정, 빌드, 테스트만 여기서 한다.
- **실제 동작 확인과 로그 확인은 `C:\DEV\Familyhub` 에서 한다.** 실행 중인 `family_bulletin.exe`, `family_media.exe`, 실제 `settings.json`, `log/family_bulletin.log`, `log/family_media.log`, `bins/` 가 여기에 있다.
- 동작 문제를 조사할 때는 `C:\DEV\Familyhub\log\` 의 로그를 먼저 본다. 이 프로젝트의 `release/` 폴더는 빌드 산출물일 뿐 운영 환경이 아니다.

## Rules

- **When a tag is needed, confirm the version number with the user first, then you may create and push it yourself.**
- **When editing settings.json fields, always update README.md too.**
- **Always write a plan and get approval before editing any code.** Order: plan → approval → code edit → build. Never skip steps.
- **Never commit `hub.supabase.url` or `hub.supabase.key`.** These live only in the local settings.json on each machine.

## Repository Structure

```
my-home-app/
├── settings.json         ← local config (gitignored — contains Supabase credentials)
├── media/                ← utility app (Tauri v2, Rust + React → family_media.exe)
│   ├── index.html        ← 진입점 HTML
│   ├── src-ui/           ← React 프론트엔드
│   │   ├── main.tsx, App.tsx, bridge.ts
│   │   ├── shell/        ← ActivityBar, MenuBar, TabBar, StatusBar, PlayerBar
│   │   └── panels/       ← EditorPanel, MusicSearchPanel, YoutubeSearchPanel, ConvertPanel
│   ├── src-tauri/        ← Rust 백엔드
│   │   └── src/
│   │       ├── lib.rs    ← AppState, 모든 명령
│   │       └── core/     ← system, db, indexer, search, bins, youtube, convert
│   └── package.json
├── media_backup/         ← 구 Electron 소스 보존
├── bulletin/             ← family notice board (Tauri v2, Rust + React → family_bulletin.exe)
│   ├── index.html        ← 진입점 HTML
│   ├── src-ui/           ← React 프론트엔드
│   │   ├── main.tsx      ← label='main'→App, label='toast'→ToastApp
│   │   ├── App.tsx
│   │   ├── Toast.tsx     ← 토스트 알림 창 (동적 생성/삭제)
│   │   ├── hooks/        ← useNotices, useChat, useSchedules, useUsers
│   │   └── components/   ← NoticePage, ChatPage, CalendarPage, AdminPage, Sidebar 등
│   ├── src-tauri/        ← Rust 백엔드
│   │   └── src/
│   │       ├── lib.rs    ← AppState, 명령 등록, 폴링, 제어 서버
│   │       ├── core/     ← system, db, http, notify, scheduler, update, window
│   │       └── modules/  ← notice, chat, calendar, user, admin
│   └── package.json
└── .github/
    └── workflows/release.yml  ← auto build + release on tag push
```

## Release Flow

1. Push code changes via `git push`
2. Push a tag → GitHub Actions runs (windows-2022 runner)
3. Release artifacts:
   - `family_bulletin.zip` — `family_bulletin.exe`
   - `family_media.zip` — `family_media.exe`
   - `family_foldersize.zip` — `family_foldersize.exe`

## How Self-Update Works

- **media**: `media/src-tauri/src/core/update.rs` (미구현 — TODO)
- **bulletin**: `bulletin/src-tauri/src/core/update.rs` (Rust)

```
app starts
  1. settings.json 없음 → 관리자 대기 화면 (제어 서버는 실행 중)
  2. hub.auto-update 확인 → false면 스킵
  3. GitHub API로 최신 릴리즈 태그 조회
  4. hub.tag 와 다르면 → hub.<appKey>.zip 다운로드
     (bulletin: hub.bulletin.zip / media: hub.media.zip)
  5. 압축 해제 → <exe>_update.bat 실행
  6. 배치: 앱 종료 → exe 교체 → 재시작
  7. hub.tag 갱신
```

## bulletin: Control Server (port 61799)

`bulletin/src-tauri/src/lib.rs` — 모든 클라이언트가 시작 시 자동으로 HTTP 서버 실행.

- `GET /status` → `{ deviceId, hostname, version, has_settings, disabled }`
- `GET /settings` → settings.json 내용
- `GET /log` → 로그 파일 내용
- `POST /settings` → settings.json 교체 후 `settings_changed` 이벤트 emit
- `POST /restart` → 앱 재시작
- `POST /update` → hub.tag 초기화 후 재시작
- `POST /disable` / `POST /enable` → 비활성화/활성화

## bulletin: Admin Panel

`hub.app.bulletin.admin: true` (로컬 settings.json에만) → Shield 아이콘 표시.
`bulletin/src-tauri/src/modules/admin.rs` — 서브넷 스캔 + 원격 명령 전송.

## bulletin: Bootstrap (No settings.json)

- 창 즉시 표시 (트레이 숨김 없음)
- `NoSettingsPage` 렌더링
- 제어 서버 실행 → 관리자가 `POST /settings` 전송 → 앱 자동 재시작

## bulletin: Tray Behavior

- settings.json 있음: 시작 시 창 숨김 (트레이 상주)
- X 버튼: 창 숨김 (종료 아님)
- 트레이 클릭: 창 표시
- 종료: 트레이 우클릭 메뉴 → 종료

## Dev Commands

```bash
cd bulletin
npm run dev          # Tauri dev (http://localhost:1420)
npm run build:exe    # exe만 빌드 → release/ 복사

cd media
npm run dev          # Tauri dev (http://localhost:1420)
npm run build:exe    # exe만 빌드 → release/ 복사
npx tsc --noEmit    # TypeScript 체크
```

> **빌드 주의 (bulletin & media 공통)**: 반드시 `npm run build:exe`를 쓸 것.
> `cargo build --release` 직접 실행 시 프론트엔드가 embed되지 않아 앱이 localhost에 연결을 시도한다.

## UI Icons

Use **lucide-react** only. No custom SVG icons.

## Naming Conventions

- Functions: `<verb>_<noun>` (e.g., `play_track`, `load_file`, `scan_subnet`)
- No `static`. No global variable references in functions — pass all dependencies as parameters.

## App Color Themes

- bulletin → 보라색 (purple, `#a78bfa`)
- media → 파란색 (blue)
- 아이콘·CSS·토스트 모두 동일 기준 적용
