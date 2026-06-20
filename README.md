# FamilyHub

## settings.json

`FamilyHub.exe` 옆에 위치. 없으면 첫 실행 시 기본값으로 자동 생성된다.
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

### hub 설정 항목

각 앱이 시작할 때 `settings.json` 을 읽어 자신의 버전을 확인하고 자동 업데이트한다. `hub.bins` 는 `family_media.exe` 가 읽고 자동으로 설치/갱신한다.

업데이트 흐름: 앱 시작 → GitHub 최신 릴리즈 태그 확인 → 로컬 `hub.tag` 와 비교 → 태그가 다르면 zip 다운로드 → 압축 해제 → `hub.tag` 갱신 → 배치 파일 실행(프로세스 종료 → exe 교체 → 재시작).

| 키 | 타입 | 기본값 | 설명 |
|----|------|--------|------|
| `hub.repo` | `string` | — | GitHub 저장소 (`owner/repo`) |
| `hub.auto-update` | `boolean` | `true` | `false` 로 설정하면 자동 업데이트 건너뜀 |
| `hub.tag` | `string` | `"v0.0.1"` | 현재 설치된 릴리즈 태그. 업데이트 후 자동 갱신 |
| `hub.zip` | `string` | `"myhome_app.zip"` | 릴리즈에서 다운로드할 zip 파일명 (media + bulletin + settings 포함) |
| `hub.update-bat` | `string` | `"update.bat"` | 자동 교체 배치 파일명. 업데이트 시 자동 생성됨 |
| `hub.app.media.name` | `string` | `"family_media.exe"` | media exe 파일명 |
| `hub.app.media.db` | `string` | `"indexing.db"` | media 인덱싱 DB 파일명 |
| `hub.app.bulletin.name` | `string` | `"family_bulletin.exe"` | bulletin exe 파일명 |
| `hub.bins` | `BinEntry[]` | — | media 가 자동 설치할 외부 도구 목록 (yt-dlp, ffmpeg, mp3val 등) |

**BinEntry 구조**

| 키 | 타입 | 설명 |
|----|------|------|
| `url` | `string` | 다운로드 URL. `.zip` 으로 끝나면 압축 해제 모드 |
| `exes` | `string \| string[]` | zip 내부 경로(들) 또는 직접 다운로드 파일명. `bin/<basename>` 위치에 저장됨 |
| `version` | `string` | 설치된 버전. myhome 이 자동 기록 |
