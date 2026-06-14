@echo off
setlocal

:: ── 여기만 수정하세요 ──────────────────────────────
set SRC=\\192.168.0.231\rudi109\music\dist\win-unpacked
set DST=C:\DEV\MusicFinder
:: ────────────────────────────────────────────────────

echo === MusicFinder deploy ===
echo From: %SRC%
echo To:   %DST%
echo.

:: 목적지 폴더가 없으면 만든다
if not exist "%DST%\" mkdir "%DST%"

:: /E         하위폴더 포함
:: /IS /IT    동일·변경 파일 모두 덮어쓰기
:: /COPY:DAT  데이터·속성·타임스탬프만 복사 (권한 정보 제외 → 권한 오류 방지)
:: /A-:R      읽기 전용 속성 제거 (Samba→NTFS 복사 시 종종 필요)
:: /FFT       FAT 파일 시간 기준 (네트워크 공유 시간차 허용)
:: /R:3 /W:3  실패 시 3회 재시도, 3초 대기
:: /NP        진행률 % 숫자 숨김 (출력 깔끔)
robocopy "%SRC%" "%DST%" /E /IS /IT /COPY:DAT /A-:R /FFT /R:3 /W:3 /NFL /NDL /NJH /NJS /NP

:: robocopy 종료코드 0~7 은 정상 (8 이상이 실제 오류)
if %ERRORLEVEL% GEQ 8 (
    echo.
    echo [FAIL] robocopy error code %ERRORLEVEL%
    pause
    exit /b 1
)

echo [OK] Sync complete.
echo.

if not exist "%DST%\settings.json" (
    echo NOTE: settings.json 없음 - 첫 실행 시 자동 생성됩니다.
    echo       %DST%\settings.json 에서 음악 폴더를 설정하세요.
    echo.
)

echo Launching MusicFinder...
start "" "%DST%\MusicFinder.exe"
