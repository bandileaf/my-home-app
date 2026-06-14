# Music Finder

선택한 폴더에서 음악 파일을 빠르게 찾고, 없으면 YouTube에서 검색해 오디오를 내려받는 데스크톱 앱.
Linux에서 개발하고, Windows `.exe`로 배포한다. VS Code 스타일의 라이트 테마 UI.

- 전체 설계·결정 기록: [`plan.md`](./plan.md)
- 개발 가이드: [`CLAUDE.md`](./CLAUDE.md)

## 기술 스택

Electron · React · Vite · TypeScript · (예정) SQLite 인덱스 · yt-dlp

## 개발 실행

```bash
npm install

# ① 전체 앱(네이티브 Electron 창) — X 디스플레이 필요
npm run dev

# ② 렌더러(React UI)만 브라우저로 미리보기 — 디스플레이 불필요
npm run dev:web      # → http://localhost:5173
```

| 명령 | 설명 |
|------|------|
| `npm run dev` | Electron 창 + HMR. 디스플레이가 있어야 창이 뜸 |
| `npm run dev:web` | 순수 Vite로 UI만 서빙(브라우저 확인용). Electron 전용 기능은 비활성 |
| `npm run build` | main/preload/renderer 번들 → `out/` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build:win` | Windows 실행 폴더(`dist/win-unpacked/`) 빌드. wine 불필요(dir 타깃) |

## Remote-SSH에서 `localhost:5173` 이 어떻게 연결되나

VS Code Remote-SSH로 작업할 때, Vite 서버는 **원격 Linux 머신**에서 돌지만
브라우저의 `http://localhost:5173` 으로 접속이 된다. 원리는 **VS Code의 자동 포트 포워딩(SSH 터널)** 이다.

```
[로컬 PC - 브라우저]                         [원격 Linux 머신]

localhost:5173  ──┐                      ┌──►  localhost:5173 (Vite 서버)
                  │                      │
            VS Code가 로컬에            VS Code Server가
            5173 리스너를 염            여기서 받아 전달
                  │                      │
                  └──── 기존 SSH 연결 ────┘
```

1. Vite가 Linux에서 5173 포트로 listen 시작
2. VS Code Server(Linux측)가 새 포트를 감지
3. VS Code가 **로컬 PC에도** `localhost:5173` 리스너를 자동 생성
4. 브라우저가 로컬 5173에 접속 → 기존 SSH 터널을 타고 → Linux의 5173 → Vite로 전달

즉 `localhost`는 "내 PC"가 맞고, 그 포트를 VS Code가 **SSH 터널 입구**로 만들어 둔 것이라
결국 원격 Linux까지 닿는다. (하단 `PORTS` 탭에 5173이 보이는 것이 그 증거)

### 왜 웹은 되고 네이티브 Electron 창은 안 되나

| | 포워딩 주체 | 이 환경 |
|---|---|---|
| **TCP 포트** (웹 5173) | VS Code가 자동 | ✅ |
| **X11 디스플레이** (네이티브 창) | `ssh -X`로 수동 설정 필요 | ❌ "Missing X server" |

포트는 터널로 쉽게 넘어가지만, **파일시스템·디스플레이**는 그렇지 않다.
그래서 UI는 브라우저로 보고, 실제 네이티브 동작은 최종 타깃인 **Windows**에서 확인한다.

## Windows에서 실행

`npm run build:win` → `dist/win-unpacked/` 폴더가 만들어진다. 이 폴더 하나에
`MusicFinder.exe` + Electron 런타임 + `resources/app.asar`(앱 코드 + 의존성 번들)이
모두 들어있다. **Windows에서 npm install 불필요 — exe만 실행하면 된다.**

이 개발 머신은 `/home/rudi109` 를 Samba로 공유(`\\192.168.0.231\rudi109`)하므로,
빌드 결과물은 Windows에서 다음 경로로 접근된다:

```
\\192.168.0.231\rudi109\music\dist\win-unpacked
```

1. 위 폴더를 Windows 로컬 디스크로 복사 (181MB exe를 SMB에서 바로 실행하면 느림)
2. exe 옆 `settings.json` 편집 → `musicSearch.searchDirectories` 를 Windows 경로로
   (예: `"C:\\Users\\me\\Music"`, 또는 `MyMusic` 폴더를 exe 옆에 두면 `"./MyMusic"`)
3. `MusicFinder.exe` 실행 → 네이티브 창 + 실제 인덱싱/검색

> 단일 portable `.exe`(설치형) 패키징은 서명/메타데이터 편집에 wine 이 필요하므로
> Windows 또는 CI에서 빌드한다. 폴더(dir) 산출은 wine 없이 Linux에서 된다.

## 상태

1단계 Quick Search 완료: 설정(JSONC) 로딩 → 폴더 인덱싱 → 파일명 검색(폴더 열기·경로 복사).
다음 단계: YouTube 검색·다운로드(yt-dlp), 탭 상태 `state.json` 이전, SQLite 영구 색인.
