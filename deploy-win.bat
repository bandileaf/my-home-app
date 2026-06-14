@echo off
setlocal

set SRC=\\192.168.0.231\rudi109\music\dist\win-unpacked
set DST=C:\DEV\MusicFinder

echo === MusicFinder deploy ===
echo From: %SRC%
echo To:   %DST%
echo.

:: robocopy: /E=하위폴더포함 /IS=동일파일도덮어쓰기 /IT=변경파일포함 /R:2=재시도2회 /W:2=대기2초
robocopy "%SRC%" "%DST%" /E /IS /IT /R:2 /W:2 /NFL /NDL /NJH /NJS

:: robocopy 8 이상이면 실제 오류
if %ERRORLEVEL% GEQ 8 (
    echo.
    echo [FAIL] robocopy error code %ERRORLEVEL%
    pause
    exit /b 1
)

echo [OK] Sync complete.
echo.

:: settings.json 이 없으면 기본값 생성 안내
if not exist "%DST%\settings.json" (
    echo NOTE: settings.json not found.
    echo       MusicFinder will create a default one on first run.
    echo       Edit %DST%\settings.json to set your music folders.
    echo.
)

echo Launching MusicFinder...
start "" "%DST%\MusicFinder.exe"
