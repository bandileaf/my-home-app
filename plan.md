# Plan: Quick File Search 프로그램 (음악 탐색용) — 결정 기록

## Context (왜 만드는가)

내 하드디스크에서 **"어떤 파일이 어디에 있는지" 빠르게 찾는 quick search**가 핵심 목적.
주 사용처는 음악 파일 탐색. 찾은 파일을 폴더 구조로 복사·보관하는 기능은 **나중 단계**.

- 개발 환경: **Linux** (현재 VS Code Remote-SSH로 이 Linux 머신에 접속해 작업 중)
- 실행 대상: **Windows** (`.exe` 배포)
- UI: **수려한 GUI**
- 검색 범위: **선택한 폴더만** (전체 드라이브 인덱싱 아님)
- 우선순위: **① quick search → ② (나중) 음악 태그 검색 → ③ (나중) 복사/정리**

## 결정 과정 (논의 기록)

1. **C# / .NET + Avalonia** 안 검토 → 보류.
2. **VS Code 익스텐션** 안 검토 → **기각**.
   - 이유: 현재 VS Code **Remote-SSH**로 Linux에 접속한 상태. 파일을 스캔하는
     workspace 익스텐션은 **원격(Linux)** 에서 실행되어 **Windows 로컬 파일/인덱스에
     직접 접근 불가**. 음악이 Windows에 있으면 익스텐션이 "철사의 반대편"에 있게 됨.
   - 또한 VS Code 기본 검색(Ctrl+P / Ctrl+Shift+F)과 단순 기능이 겹침.
3. **최종 결정 → Electron + React, Windows `.exe` 배포.**
   - Electron 앱은 패키징 후 **Windows에서 직접 실행**되는 독립 프로그램이라
     원격/로컬 분리가 없음 → **Windows 파일을 바로 스캔·인덱싱** 가능. SSH 문제 해소.
   - Linux에서 개발·UI 테스트, 최종 Windows exe만 별도로 빌드.

## 확정 기술 스택

| 항목 | 선택 | 비고 |
|------|------|------|
| 셸 | **Electron** | 메인 프로세스에서 파일시스템 스캔/인덱스 |
| UI | **React** | 렌더러: 검색창 + 결과 목록 |
| 번들러 | **Vite** | React 빠른 번들링/HMR |
| 언어 | **TypeScript** | `Verb_Noun` 함수 네이밍 적용 |
| 로컬 DB | **SQLite (better-sqlite3)** | 인덱스 영구 저장 + 빠른 검색(FTS 고려). ※ 네이티브 모듈 → Electron 리빌드/플랫폼별 바이너리 필요 |
| 설정 파싱 | **jsonc-parser** | `settings.json` 의 **JSONC**(주석 허용) 지원 |
| glob 매칭 | **picomatch** | `exclude` 패턴(예: `**/*.jpg`)으로 인덱싱 제외 |
| 패키징 | **electron-builder** | Windows `.exe` (NSIS 설치형 또는 portable) |

### CLAUDE.md 규칙 적용 메모
- 함수명 `<verb>_<noun>` (예: `build_index`, `search_files`, `open_location`) — 적용
- 전역변수 미참조 — 적용 (의존성 주입/매개변수 전달)
- `static` 금지 — JS/TS에선 거의 무의미하나 규칙상 클래스 static 멤버 미사용

## 빌드/배포 주의 (크로스 빌드)

- Linux에서 Windows exe 빌드 자체는 가능.
- **portable .exe / unpacked dir**: Linux에서 무난.
- **NSIS 설치형 .exe / 아이콘·메타데이터**: electron-builder가 **Wine(+mono)** 요구.
  → 가장 안정적인 경로는 **CI(GitHub Actions windows 러너)** 또는 **실제 Windows에서 빌드**.
- 권장 흐름: 개발·디버깅은 Linux, 최종 Windows exe만 CI/Windows에서 생성.

## UI 설계 (VS Code 스타일, 라이트 테마)

VS Code의 외관을 모사한다. **라이트 테마 기준.**

- **왼쪽 액티비티 바**: 아이콘 목록. ① **music search**(로컬), ② **youtube search**.
- 아이콘 클릭 → **오른쪽 메인 영역에 탭이 열림**.

### 액티비티 바 아이콘 토글 (공통 UI 셸)
- 이 UI는 **여러 프로젝트에서 공통으로 재사용**할 계획.
- 따라서 옆 액티비티 바의 각 아이콘은 settings 에서 **`true`/`false` 로 표시/숨김**이 가능해야 한다.
  - `true` → 아이콘 나타남, `false` → 사라짐.
- 즉 아이콘 목록은 하드코딩이 아니라 **설정 기반(레지스트리)** 으로 구성 → 새 기능 아이콘도 설정만으로 추가/제거.
- 탭 내부 구성:
  - **상단: 검색창(Search)** — 입력하면 검색 실행
  - **그 아래: 결과 리스트** — 찾은 항목을 list 형태로 표시

### 탭 상태 유지 (세션 복원)
- 창을 종료해도, **다시 실행했을 때 종료 직전의 탭 구성을 그대로 복원**한다 (VS Code의 편집기 복원과 동일).
- 복원 대상: 열린 탭 목록 / 각 탭 종류(music·youtube) / 활성 탭 / 탭별 검색어 등.
- 저장 위치: 사용자가 편집하는 **`settings.json` 과는 분리된 UI 상태 파일**
  (예: `userData/state.json`) — 종료 시 저장, 시작 시 로드.

```
┌──┬───────────────────────────────────┐
│🔍│ [ 탭: Music Search ]              │  ← 아이콘 클릭 시 우측에 탭 생성
│  │ ┌───────────────────────────────┐ │
│⚙ │ │ Search: [ beatles________ ]   │ │  ← 상단 검색창
│  │ ├───────────────────────────────┤ │
│  │ │ yesterday.mp3   D:\..\Beatles │ │  ← 아래 결과 리스트
│  │ │ let_it_be.mp3   D:\..\Beatles │ │
│  │ │ ...                           │ │
│  │ └───────────────────────────────┘ │
└──┴───────────────────────────────────┘
   ↑ 액티비티 바 (🔍 music search / ▶ youtube search)
```

### YouTube 검색·다운로드 (로컬에서 못 찾을 때의 대안)
로컬 검색으로 못 찾으면 YouTube로 검색해서 받는 흐름.

- 액티비티 바의 **youtube search 아이콘** 클릭 → 오른쪽에 **탭 생성**
- 탭 구성:
  - **상단: 검색 box** — 입력 후 검색
  - **그 아래: 결과 list** — 제목/썸네일/채널 등, **링크 연결**
  - 항목의 링크를 눌러 **사용자가 직접 확인** 후
  - **다운로드 버튼**으로 원하는 것만 받기

**구현 메모 (확정)**
- 검색: **yt-dlp 의 `ytsearch:`** 사용 (API 키 불필요). YouTube Data API 안 씀.
- 다운로드: **yt-dlp + ffmpeg**, **오디오만 추출** (`-x --audio-format mp3` 등).
- Windows 패키징 시 **yt-dlp, ffmpeg 바이너리 동봉** + 경로 처리 필요.
- 다운로드 위치: settings 의 대상 폴더로 저장 → 이후 로컬 인덱스에 반영.

> ⚠️ **법적 주의**: YouTube 약관상 무단 다운로드는 금지이며 저작권 침해 소지가 있음.
> 본인이 권리를 가진 콘텐츠(직접 업로드/CC/퍼블릭 도메인) 위주로 사용 권장.

## 시작 시 동작 (Startup) + 데이터 흐름
1. 앱 시작과 동시에 **`settings.json` 을 읽음** (※ **JSONC** 지원 — 주석 허용)
2. settings.json 의 **`search directory` (복수)** 항목을 읽음
3. 해당 디렉터리들을 스캔 → **로컬 DB(SQLite)에 인덱싱**
4. 검색은 파일시스템이 아니라 **이 로컬 DB를 대상으로** 수행

### settings.json 형식 — VS Code 컨벤션을 따른다
통일성을 위해 **VS Code settings.json 의 이름·형식**을 참고한다:
- **JSONC** (주석 허용)
- **점(dot) 네임스페이스의 평면 키** (예: `musicSearch.searchDirectories`)
- 제외 패턴은 VS Code 의 `files.exclude` / `search.exclude` 와 동일하게
  **`{ "글롭": true }` 객체 맵** 형식 (개별 패턴을 `false`로 끌 수 있음)

```jsonc
{
  // 인덱싱할 디렉터리 (복수)
  "musicSearch.searchDirectories": [
    "D:\\Music",
    "E:\\Backup\\mp3"
  ],

  // 인덱싱 제외 — VS Code files.exclude 와 동일한 { glob: bool } 맵
  "musicSearch.exclude": {
    "**/*.jpg": true,    // jpg 제외
    "**/*.png": true,
    "**/.git/**": true
  },

  // 액티비티 바 아이콘 표시/숨김 (공통 UI 셸) — { 아이콘ID: bool }
  "activityBar.icons": {
    "musicSearch": true,    // 🔍 표시
    "youtubeSearch": true   // ▶ 표시 (false 면 사라짐)
  }
}
```
> 네임스페이스(`musicSearch.*`)·파일 위치는 구현 시 확정.

### 제외(exclude) 규칙
- `musicSearch.exclude` 는 VS Code `files.exclude` 형식의 **`{ glob: boolean }` 맵**.
- 값이 `true` 인 패턴만 적용 (`false` 면 무시) → 개별 토글 가능.
- 예: `"**/*.jpg": true` → 모든 jpg 를 **인덱싱 대상에서 제외**.
- 인덱싱 시 각 파일 경로를 활성 패턴과 매칭 → 하나라도 매칭되면 DB에 넣지 않음.
- glob 매칭 라이브러리: **picomatch**(또는 minimatch) 사용.

## 기능 요구사항 (1단계: Quick Search)
1. 시작 시 settings.json(JSONC) 로드 → `searchDirectories` 의 폴더들 인덱싱(로컬 DB)
2. 폴더 하위 재귀 스캔 → DB에 저장 (경로/파일명/확장자/크기/수정일), **`exclude` glob 매칭 파일은 제외**
3. 검색창 입력 → 디바운스 후 **DB 조회**로 결과 (파일명 부분일치, 대소문자 무시)
4. 확장자/종류 필터 (mp3, flac …)
5. 결과 리스트: 파일명 / 전체 경로 / 크기 / 수정일
6. 결과 항목 → 위치 열기(탐색기), 경로 복사
7. 인덱스 새로고침(재스캔) — settings.json 변경 반영

## 나중 단계 (이번 범위 아님)
- 음악 태그(아티스트/앨범/제목) 검색
- 검색 결과 → 아티스트/앨범 폴더 구조로 복사/보관

## 환경 확인 결과 (현재 머신)
- Node v24.15.0, npm 11.14.1 설치됨
- VS Code 1.124.2 (vscode-server, Remote-SSH 세션)
- dotnet 미설치 (이번 방향에선 불필요)

## 다음 단계 (확정/진행 전)
- (보류 중) Electron + React + Vite + TS 프로젝트 골격 scaffold
- requirement.md 생성 (위 요구사항 기록)
- UI 레이아웃/테마 세부 결정 (아직 미정)
