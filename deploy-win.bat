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

:: 목적지 폴더 생성
if not exist "%DST%\" mkdir "%DST%"

:: robocopy 복사 (출력 보이게 /V 추가, 오류 확인용)
robocopy "%SRC%" "%DST%" /E /IS /IT /COPY:DAT /FFT /R:3 /W:3 /NP /V
set RC=%ERRORLEVEL%

echo.
echo robocopy exit code: %RC%

:: 0~7 은 정상 (3=복사됨, 1=새파일, 5=추가+변경 등)
if %RC% GEQ 8 (
    echo [FAIL] 복사 오류 - 위 메시지를 확인하세요
    pause
    exit /b 1
)

echo [OK] 복사 완료
echo.

if not exist "%DST%\settings.json" (
    echo NOTE: settings.json 없음. 첫 실행시 자동 생성됩니다.
    echo       %DST%\settings.json 에서 음악 폴더를 설정하세요.
    echo.
)

echo MusicFinder 실행 중...
start "" "%DST%\MusicFinder.exe"
