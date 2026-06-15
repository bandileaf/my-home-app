# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

FamilyHub: 집에서 필요한 모든 소프트웨어를 가족과 공유하는 홈 허브. `familyhub` 가 런처이고 `myhome` 이 메인 앱이다.

## 규칙

- **git tag 는 직접 올리지 않는다.** 태그가 필요한 시점이 되면 사용자에게 올릴지 여부를 먼저 물어본다.
- **settings.json 을 수정할 때는 반드시 README.md 도 함께 업데이트한다.** 새 필드 추가, 기존 필드 변경, 삭제 모두 해당한다.

## 저장소 구조

```
my-home-app/
├── familyhub/        ← 런처 (Node.js → familyhub.exe)
│   ├── index.js      ← 허브 로직 (업데이트 확인 → 실행)
│   ├── settings.json ← hub.repo / hub.tag.myhome / hub.app.myhome
│   └── package.json
├── myhome/           ← 메인 앱 (Electron + React)
│   ├── src/
│   │   ├── main/     ← Electron 메인 프로세스
│   │   ├── preload/  ← contextBridge API
│   │   └── renderer/ ← React UI
│   ├── electron-builder.yml
│   ├── electron.vite.config.ts
│   └── package.json
└── .github/
    └── workflows/release.yml  ← tag push 시 자동 빌드 + 릴리즈
```

## 배포 흐름

1. 코드 수정 후 `git push`
2. 태그 push → GitHub Actions 자동 실행 (windows-2022 runner)
3. 빌드 산출물 (GitHub Releases에 업로드):
   - `myhome_v{tag}.exe` — 메인 앱 (portable)
   - `familyhub.exe` — 런처
   - `settings.json` — 초기 허브 설정

## familyhub 동작 방식

```
familyhub.exe 실행
  1. settings.json 읽기 (hub.repo, hub.tag.myhome, hub.app.myhome)
  2. GitHub API → 최신 릴리즈 태그 확인
  3. 최신 버전 > 현재 버전이면:
       → myhome_v{latest}.exe 다운로드
       → settings.json 업데이트
  4. hub.app.myhome 에 기록된 exe 실행 후 종료
```

## 개발 명령 (myhome/)

```bash
cd myhome
npm run dev:web    # UI만 브라우저로 — http://localhost:5173
npm run typecheck  # tsc --noEmit
npm run build:win  # dist/win-unpacked/ 생성 (로컬 테스트용)
```

## Naming Conventions

Function names follow `<verb>_<noun>` format (e.g., `play_track`, `load_file`).

## Function Rules

Functions must not reference global variables. All dependencies are passed explicitly as parameters.

`static` is not used anywhere in the codebase.
