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
