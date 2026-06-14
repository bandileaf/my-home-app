# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Music Finder: an Electron desktop app that quickly searches a local index of music files in configured folders, and falls back to searching/downloading audio from YouTube. Develops on Linux, ships as a Windows `.exe`. See `plan.md` for the full design and decision log.

## Commands

- `npm run dev` — run the full app (Electron window) with HMR. Needs a reachable X display (see "Running on Linux").
- `npm run dev:web` — serve only the renderer (`--rendererOnly`) at http://localhost:5173 and open it in a browser. Use this over Remote-SSH where no X display is reachable; the React shell renders, but Electron-only APIs (`window.api`, fs, yt-dlp) are inert.
- `npm run build` — type-aware bundle of main/preload/renderer into `out/`.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run build:win` — cross-build a runnable **Windows app folder** (`dist/win-unpacked/`) from Linux. Target is `dir` + `signAndEditExecutable: false` so it builds **without Wine**. A single portable/installer `.exe` (signing + rcedit) still needs Wine or a Windows/CI build.

## Running on Linux (dev)

Two host-specific gotchas when launching the Electron window on this Linux box:

1. **Chrome sandbox permissions.** Electron's bundled `chrome-sandbox` must be root-owned and setuid, or the app aborts with `FATAL:setuid_sandbox_host.cc ... chrome-sandbox is owned by root and has mode 4755`. Grant it (one-time; **redo after any `npm install` that reinstalls electron**):
   ```
   sudo chown root:root node_modules/electron/dist/chrome-sandbox
   sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
   ```
   Run this in a **real terminal** — `sudo` needs a TTY, so it fails from the `!`-prefix / non-interactive shells. (Avoid `--noSandbox`; fix the permission instead.)

2. **X display.** The GUI needs a reachable X display. Per `~/.bashrc` `run_chrome`, this host uses `DISPLAY=localhost:10.0` (SSH X-forwarding) with `XAUTHORITY=$HOME/.Xauthority`. Run `npm run dev` from your own SSH terminal where `chrome` already works; a sandboxed/agent shell cannot reach your display.

## Building & running on Windows

`npm run build:win` produces `dist/win-unpacked/` for local testing. Windows 테스트 절차는 별도 배치 파일 참조.

## Architecture

Three processes (electron-vite layout):
- `src/main/` — Electron main process. Owns the window and (later) filesystem scanning, the SQLite index, and yt-dlp downloads.
- `src/preload/` — `contextBridge` API exposed to the renderer as `window.api`.
- `src/renderer/` — React UI (Vite). VS Code-style shell, light theme.

Renderer shell:
- `shell/iconRegistry.tsx` — registry of activity-bar features `{ id, label, glyph, panel }` plus default visibility. Icons are config-driven (toggle on/off), not hardcoded — this shell is meant to be reused across projects.
- `shell/ActivityBar.tsx` — renders visible icons; click opens/focuses a tab.
- `shell/TabBar.tsx` — open tabs; `App.tsx` owns tab state and persists it (currently `localStorage`; planned move to `userData/state.json`).
- `panels/` — one panel component per feature (MusicSearchPanel, YoutubeSearchPanel). Search/index/download are stubs pending the next stage.

Settings (planned): a VS Code-style `settings.json` (JSONC) with `musicSearch.searchDirectories`, `musicSearch.exclude` (`{ glob: bool }`), and `activityBar.icons`.

## Naming Conventions

Function names follow `<verb>_<noun>` format (e.g., `play_track`, `load_file`).

Class methods naturally read as `<ClassName><verb><noun>` — matching English grammar word order (e.g., `PlayerPlayTrack`, `LoaderLoadFile`). This applies to all languages used in this project.

## Function Rules

Functions must not reference global variables. All dependencies are passed explicitly as parameters.

`static` is not used anywhere in the codebase.
