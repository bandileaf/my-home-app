# Music Finder

로컬 음악 파일을 빠르게 검색하고, 없으면 YouTube에서 오디오를 내려받는 데스크톱 앱.
Linux에서 개발하고 Windows `.exe`로 배포한다. VS Code 스타일 라이트 테마 UI.

## 기능

- **로컬 검색** — 설정한 폴더를 SQLite로 인덱싱해 파일명 검색. 백그라운드 스캔, 파일 변경 자동 반영(fs.watch)
- **YouTube 검색** — 검색어로 YouTube 동영상 10개 결과 표시 (썸네일·채널·조회수·길이)
- **오디오 다운로드** — m4a(aac) 또는 webm(opus)으로 직접 저장, 변환 없음. 제목·썸네일 클릭 시 브라우저로 열기
- **설정** — exe 옆 `settings.json` (JSONC), 변경 시 변경분만 재인덱싱

## 기술 스택

| 레이어 | 라이브러리 |
|--------|-----------|
| 앱 프레임워크 | Electron 33 |
| UI | React 18 + Vite + TypeScript |
| 빌드 | electron-vite + electron-builder |
| 로컬 인덱스 | better-sqlite3 (exe 옆 musicfinder.db) |
| YouTube 검색 | youtubei.js |
| YouTube 다운로드 | @distube/ytdl-core |
| 글로브 패턴 | picomatch |

## 개발 명령

```bash
npm install
npm run dev        # Electron 창 (X 디스플레이 필요)
npm run dev:web    # UI만 브라우저로 — http://localhost:5173
npm run typecheck  # tsc --noEmit
npm run build:win  # dist/win-unpacked/ 생성
```

## Windows 배포

`npm run build:win` 후 `dist/win-unpacked/` 폴더 전체를 Windows에 복사한다.
이 머신은 `/home/rudi109`을 Samba 공유(`\\192.168.0.231\rudi109`)하므로:

```
\\192.168.0.231\rudi109\music\deploy-win.bat
```

을 Windows에서 실행하면 `C:\DEV\MusicFinder`로 복사 후 자동 실행.
(목적지 변경: 배치 파일 상단 `set DST=` 수정)

---

## settings.json

`MusicFinder.exe` 옆에 위치. 없으면 첫 실행 시 기본값으로 자동 생성된다.
**JSONC 형식** (주석 `//` 허용, 마지막 쉼표 허용).

### 예시

```jsonc
{
  // 인덱싱할 폴더 목록. 여러 개 지정 가능.
  // Windows 경로: 역슬래시 두 개(\\) 또는 슬래시(/) 사용
  "musicSearch.searchDirectories": [
    "D:\\Music",
    "E:/Albums"
  ],

  // 인덱싱·검색에서 제외할 글로브 패턴.
  // true = 제외, false = 포함 (또는 항목 삭제)
  "musicSearch.exclude": {
    "**/*.jpg": true,
    "**/*.png": true,
    "**/*.pdf": true,
    "**/Temp/**": true
  },

  // YouTube 오디오 다운로드 저장 폴더.
  // 비워두면 exe 옆 Downloads/ 폴더에 저장
  "musicSearch.downloadDirectory": "D:\\Downloads\\Music"
}
```

### 항목 설명

| 키 | 타입 | 기본값 | 설명 |
|----|------|--------|------|
| `musicSearch.searchDirectories` | `string[]` | `[]` | 인덱싱할 폴더 절대 경로 목록 |
| `musicSearch.exclude` | `{ [glob]: boolean }` | jpg·png 제외 | `true`인 패턴은 인덱싱·검색 모두 제외 |
| `musicSearch.downloadDirectory` | `string` | `""` | 다운로드 저장 경로. 비우면 exe 옆 `Downloads/` |

### 글로브 패턴 예시

| 패턴 | 의미 |
|------|------|
| `**/*.jpg` | 모든 하위 폴더의 .jpg 파일 |
| `**/*.png` | 모든 하위 폴더의 .png 파일 |
| `**/Temp/**` | 이름이 Temp인 폴더 전체 |
| `**/@eaDir/**` | Synology NAS 썸네일 폴더 |
| `**/AlbumArt/**` | 앨범 아트 폴더 |

설정 변경 후 앱을 재시작하면 변경된 항목만 재인덱싱한다.

---

## 아키텍처

```
src/
├── main/            Electron 메인 프로세스
│   ├── index.ts     창 생성, IPC 핸들러, 백그라운드 스캔 루프
│   └── services/
│       ├── db.ts        SQLite 래퍼 (스키마 버전 관리, 체크포인트)
│       ├── indexer.ts   파일 스캔 + 글로브 필터
│       ├── search.ts    SQLite LIKE 검색
│       ├── settings.ts  JSONC 로딩 + 경로 정규화
│       └── youtube.ts   검색(youtubei.js) + 다운로드(@distube/ytdl-core)
├── preload/         contextBridge → window.api
└── renderer/        React UI
    ├── shell/        ActivityBar, TabBar, 아이콘 레지스트리
    └── panels/       MusicSearchPanel, YoutubeSearchPanel
```

**DB**: exe 옆 `musicfinder.db`. 이동 시 함께 옮기면 인덱스 유지.
**DB 버전**: PRAGMA user_version. 스키마 변경 시 자동 재생성.
**로그**: exe 옆 `musicfinder.log`.
