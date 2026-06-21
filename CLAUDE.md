# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

FamilyHub: a home hub for sharing all the software a family needs. `media` is the main utility app (`family_media.exe`) and `bulletin` is the family notice board (`family_bulletin.exe`). Each app manages its own updates independently.

## Rules

- **Never push git tags yourself.** When a tag is needed, ask the user first.
- **When editing settings.json fields, always update README.md too.**
- **Always write a plan and get approval before editing any code.** Order: plan → approval → code edit → build. Never skip steps.
- **Never commit `hub.supabase.url` or `hub.supabase.key`.** These live only in the local settings.json on each machine.

## Repository Structure

```
my-home-app/
├── settings.json         ← local config (gitignored — contains Supabase credentials)
├── shared/
│   └── update.ts         ← shared self-update logic used by both apps
├── media/                ← utility app (Electron + React → family_media.exe)
│   ├── src/
│   │   ├── main/
│   │   │   └── services/ ← db.ts, indexer.ts, search.ts, settings.ts, youtube.ts, bins.ts
│   │   ├── preload/
│   │   └── renderer/
│   │       ├── shell/    ← ActivityBar, MenuBar, TabBar, StatusBar, PlayerBar
│   │       └── panels/   ← EditorPanel, MusicSearchPanel, YoutubeSearchPanel, ConvertPanel
│   ├── electron-builder.yml
│   └── package.json
├── bulletin/             ← family notice board (Electron + React → family_bulletin.exe)
│   ├── src/
│   │   ├── main/
│   │   │   └── services/ ← identity.ts, store.ts, control.ts, admin.ts
│   │   ├── preload/      ← index.ts + toast.ts
│   │   └── renderer/
│   │       └── components/ ← NoticePage, ChatPage, AdminPage, NoSettingsPage, Sidebar, NavRound, Dots
│   ├── electron-builder.yml
│   └── package.json
└── .github/
    └── workflows/release.yml  ← auto build + release on tag push
```

## Release Flow

1. Push code changes via `git push`
2. Push a tag → GitHub Actions runs (windows-2022 runner)
3. Release artifacts:
   - `family_bulletin.zip` — `family_bulletin.exe`
   - `family_media.zip` — `family_media.exe` + `recovery.bat`

## How Self-Update Works

Each app updates **independently** using `shared/update.ts`.

```
app starts
  1. settings.json 없음 → 관리자 대기 화면 (제어 서버는 실행 중)
  2. hub.auto-update 확인 → false면 스킵
  3. GitHub API로 최신 릴리즈 태그 조회
  4. hub.tag 와 다르면 → hub.<appKey>.zip 다운로드
     (bulletin: hub.bulletin.zip / media: hub.media.zip)
  5. 압축 해제 → <exe>_update.bat 실행
     (예: family_bulletin_update.bat)
  6. 배치: 앱 종료 → exe 교체 → 재시작
  7. hub.tag 갱신
```

## bulletin: Control Server (port 61799)

`bulletin/src/main/services/control.ts` — 모든 클라이언트가 시작 시 자동으로 HTTP 서버 실행.

- `GET /status` → `{ deviceId, hostname, version }`
- `GET /settings` → settings.json 내용 (없으면 `{}`)
- `POST /settings` → settings.json 교체 후 `app.relaunch()`
- `POST /restart` → 앱 재시작
- `POST /update` → 업데이트 강제 실행

## bulletin: Admin Panel

`hub.app.bulletin.admin: true` (로컬 settings.json에만) → Shield 아이콘 표시.
`bulletin/src/main/services/admin.ts` — 서브넷 스캔 + 원격 명령 전송.

## bulletin: Bootstrap (No settings.json)

- 창 즉시 표시 (트레이 숨김 없음)
- `NoSettingsPage` 렌더링
- 제어 서버 실행 → 관리자가 `POST /settings` 전송 → 앱 자동 재시작

## bulletin: Tray Behavior

- settings.json 있음: 시작 시 창 숨김 (트레이 상주)
- X 버튼: 창 숨김 (종료 아님)
- 트레이 클릭 / 더블클릭: 창 표시
- 종료: 트레이 우클릭 메뉴 → 종료

## Dev Commands

```bash
cd bulletin
npm run dev:web    # http://localhost:5174
npm run typecheck
npm run build:win

cd media
npm run dev:web    # http://localhost:5173
npm run typecheck
npm run build:win
```

## UI Icons

Use **lucide-react** only. No custom SVG icons.

## Naming Conventions

- Functions: `<verb>_<noun>` (e.g., `play_track`, `load_file`, `scan_subnet`)
- No `static`. No global variable references in functions — pass all dependencies as parameters.

## App Color Themes

- bulletin → 보라색 (purple, `#a78bfa`)
- media → 파란색 (blue)
- 아이콘·CSS·토스트 모두 동일 기준 적용
