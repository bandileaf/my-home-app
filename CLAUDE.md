# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

FamilyHub: a home hub for sharing all the software a family needs. `media` is the main utility app (`family_media.exe`) and `bulletin` is the family notice board (`family_bulletin.exe`). Each app manages its own updates.

## Rules

- **Never push git tags yourself.** When a tag is needed, ask the user first whether to push it.
- **When editing settings.json, always update README.md too.** This applies to adding, changing, or removing any field.
- **Always write a plan and get approval before editing any code.** The order is strictly: plan → approval → code edit → build. Never skip steps.

## Repository Structure

```
my-home-app/
├── settings.json     ← shared settings (hub.repo, hub.auto-update, hub.app.*.version, hub.bins)
├── media/            ← main utility app (Electron + React → family_media.exe)
│   ├── src/
│   │   ├── main/     ← Electron main process (indexing, search, bin install, YouTube download IPC)
│   │   │   └── services/  ← db.ts, indexer.ts, search.ts, settings.ts, youtube.ts, bins.ts, update.ts
│   │   ├── preload/  ← contextBridge API
│   │   └── renderer/ ← React UI (VS Code-style tabbed shell)
│   │       ├── shell/    ← ActivityBar, MenuBar, TabBar, StatusBar
│   │       └── panels/   ← EditorPanel, MusicSearchPanel, YoutubeSearchPanel
│   ├── electron-builder.yml
│   ├── electron.vite.config.ts
│   └── package.json
├── bulletin/         ← family notice board (Electron + React → family_bulletin.exe)
│   ├── src/
│   │   ├── main/     ← tray-resident app, IPC handlers, identity + store + update services
│   │   │   └── services/  ← identity.ts, store.ts, update.ts
│   │   ├── preload/  ← contextBridge API (index.ts + toast.ts)
│   │   └── renderer/ ← React UI (lavender notebook-page style) + toast window
│   ├── electron-builder.yml
│   ├── electron.vite.config.ts
│   └── package.json
└── .github/
    └── workflows/release.yml  ← auto build + release on tag push
```

## Release Flow

1. Push code changes via `git push`
2. Push a tag → GitHub Actions runs automatically (windows-2022 runner)
3. Build artifacts (uploaded to GitHub Releases):
   - `family_media.exe` — main utility app (portable)
   - `family_bulletin.exe` — family notice board (portable)
   - `settings.json` — version manifest for self-update logic

## How Self-Update Works (both apps)

```
app starts
  1. Read settings.json (hub.repo, hub.auto-update, hub.app.<name>.version)
  2. If hub.auto-update is false → skip
  3. Fetch latest release tag from GitHub API
  4. Download settings.json from the release to tmp/
  5. Compare hub.app.<name>.version (remote vs local)
  6. If newer → download family_<name>.exe from release assets
  7. Schedule PowerShell script: kill → rename → relaunch
  8. Update local settings.json version → quit
  Toast window appears (bottom-right) during download:
    media → purple theme, bulletin → blue theme
```

## How media Installs Bins

On launch, media reads `hub.bins` from settings.json and downloads/extracts any tool
(yt-dlp, ffmpeg, etc.) not yet present under `bin/`, recording the installed version back
into settings.json — see `media/src/main/services/bins.ts`.

## Dev Commands (media/)

```bash
cd media
npm run dev:web    # UI only, in browser — http://localhost:5173
npm run typecheck  # tsc --noEmit
npm run build:win  # produces dist/win-unpacked/ (for local testing)
```

## Dev Commands (bulletin/)

```bash
cd bulletin
npm run dev:web    # UI only, in browser — http://localhost:5174
npm run typecheck  # tsc --noEmit
npm run build:win  # produces dist/win-unpacked/ (for local testing)
```

## UI Icons

Use **lucide-react** for all icons. Do not create custom SVG icons.

## Naming Conventions

Function names follow `<verb>_<noun>` format (e.g., `play_track`, `load_file`).

## Function Rules

Functions must not reference global variables. All dependencies are passed explicitly as parameters.

`static` is not used anywhere in the codebase.
