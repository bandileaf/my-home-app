# FamilyHub

가족이 함께 사용하는 홈 허브. 두 개의 앱으로 구성된다.

| 앱 | 실행 파일 | 설명 |
|----|-----------|------|
| `media` | `family_media.exe` | 음악 검색·재생, YouTube 다운로드 등 미디어 유틸리티 |
| `bulletin` | `family_bulletin.exe` | 가족 알림장, 채팅, 공지 게시판 |

---

## settings.json

각 앱 실행 파일 옆에 위치. **없으면 관리자에게 문의 화면이 표시되며 관리자가 원격으로 전송할 때까지 대기한다.**
JSONC 형식 (`//` 주석, 마지막 쉼표 허용).

### 전체 항목

| 키 | 타입 | 설명 |
|----|------|------|
| `hub.repo` | `string` | GitHub 저장소 (`owner/repo`) |
| `hub.auto-update` | `boolean` | `false` 이면 자동 업데이트 건너뜀 |
| `hub.tag` | `string` | 현재 설치된 릴리즈 태그. 업데이트 후 자동 갱신 |
| `hub.bulletin.zip` | `string` | bulletin 업데이트 zip 파일명 (예: `family_bulletin.zip`) |
| `hub.media.zip` | `string` | media 업데이트 zip 파일명 (예: `family_media.zip`) |
| `hub.app.media.db` | `string` | media 인덱싱 DB 파일명 |
| `hub.supabase.url` | `string` | Supabase 프로젝트 URL — **커밋 금지** |
| `hub.supabase.key` | `string` | Supabase anon key — **커밋 금지** |
| `hub.app.bulletin.admin` | `boolean` | `true` 이면 관리자 패널 활성화 (해당 기기 로컬에만 설정) |
| `hub.app.bulletin.autostart` | `boolean` | `true` 이면 Windows 시작 시 자동 실행 등록, `false` 이면 해제 |
| `hub.bulletin.poll-min` | `number` | 채팅 폴링 간격 (분 단위, 기본값 10, 최소 5초) |

### 예시

```jsonc
{
  "hub.repo": "owner/my-home-app",
  "hub.auto-update": true,
  "hub.tag": "v0.0.1",
  "hub.bulletin.zip": "family_bulletin.zip",
  "hub.media.zip": "family_media.zip",
  "hub.app.media.db": "indexing.db",
  "hub.supabase.url": "https://xxxx.supabase.co",
  "hub.supabase.key": "sb_publishable_xxxx"
}
```

---

## 릴리즈 파일 구성

| 파일 | 내용 |
|------|------|
| `family_bulletin.zip` | `family_bulletin.exe` |
| `family_media.zip` | `family_media.exe` + `recovery.bat` |

---

## 자동 업데이트 흐름

각 앱이 **독립적으로** 업데이트한다.

```
앱 시작
  1. settings.json 없음 → 관리자 대기 화면 표시 (제어 서버는 계속 실행)
  2. settings.json 있음 → hub.auto-update 확인
  3. false → 업데이트 건너뜀
  4. GitHub API로 최신 릴리즈 태그 조회
  5. hub.tag 와 다르면 → hub.<app>.zip 다운로드
  6. 압축 해제 → <exe명>_update.bat 생성 및 실행
     (예: family_bulletin_update.bat)
  7. 배치 파일: 앱 종료 → exe 교체 → 재시작
  8. hub.tag 갱신
  토스트 창(우측 하단): bulletin=보라색, media=파란색
```

---

## bulletin 제어 서버 (포트 61799)

모든 bulletin 인스턴스가 시작 시 자동으로 HTTP 서버를 띄운다.
관리자 패널에서 원격 제어에 사용한다.

| 메서드 | 엔드포인트 | 설명 |
|--------|-----------|------|
| GET | `/status` | deviceId, hostname, version, has_settings, disabled 반환 |
| GET | `/settings` | settings.json 반환 (없으면 `{}`) |
| GET | `/log` | 로그 파일 반환 |
| POST | `/settings` | settings.json 교체 (최초 수신 시 자동 재시작) |
| POST | `/restart` | 앱 재시작 |
| POST | `/update` | hub.tag 삭제 후 재시작 → 강제 업데이트 |
| POST | `/disable` | hub.disabled=true 저장 (관리자 기기 제외) |
| POST | `/enable` | hub.disabled 제거 |

---

## 관리자 패널

로컬 `settings.json`에 `"hub.app.bulletin.admin": true` 를 추가하면
사이드바에 Shield 아이콘이 나타난다.

- **네트워크 스캔**: 로컬 서브넷(포트 61799)에서 기기 검색. 스캔 중 현재 탐색 IP 실시간 표시
- **재시작**: 명령 전송 → `/status` 폴링(600ms 간격, 최대 15초) → 복귀 확인 후 완료 표시
- **업데이트 강제**: hub.tag 삭제 후 재시작 → 최신 버전 자동 다운로드
- **정지 / 해제**: hub.disabled 토글 (정지 시 자동 재시작 포함)
- **가져오기**: 선택 기기의 settings.json을 에디터로 불러옴
- **내보내기**: 에디터 내용을 선택 기기에 전송
- **로그 보기**: 선택 기기의 로그 파일 표시
- **전체 재시작 / 전체 업데이트**: 스캔된 모든 기기에 일괄 실행

---

## media settings.json 항목 (미디어 검색)

| 키 | 타입 | 설명 |
|----|------|------|
| `musicSearch.searchDirectories` | `string[]` | 인덱싱할 폴더 경로 목록 |
| `musicSearch.exclude` | `{ [glob]: boolean }` | `true` 인 패턴 제외 |
| `musicSearch.downloadDirectory` | `string` | YouTube 다운로드 저장 경로 |

---

## 개발 명령

```bash
# bulletin
cd bulletin
npm run dev:web    # UI 미리보기 — http://localhost:5174
npm run typecheck  # 타입 검사
npm run build:win  # Windows 빌드 → dist/win-unpacked/

# media
cd media
npm run dev:web    # UI 미리보기 — http://localhost:5173
npm run typecheck  # 타입 검사
npm run build:win  # Windows 빌드 → dist/win-unpacked/
```
