@echo off
setlocal

set SRC=\\192.168.0.231\rudi109\music\dist\win-unpacked
set DST=C:\DEV\MusicFinder

echo === MusicFinder deploy ===
echo From: %SRC%
echo To:   %DST%
echo.

echo Stopping all MusicFinder processes...
taskkill /F /T /IM MusicFinder.exe >/dev/null 2>&1
timeout /T 5 /NOBREAK >/dev/null 2>&1

if not exist "%DST%\" mkdir "%DST%"

echo Copying...
robocopy "%SRC%" "%DST%" /E /IS /IT /COPY:DAT /FFT /R:10 /W:5 /NP /NFL /NDL /NJH /NJS
set RC=%ERRORLEVEL%

if %RC% GEQ 8 (
    echo [FAIL] Copy error - code %RC%
    pause
    exit /b 1
)

echo [OK] Done. Launching...
start "" "%DST%\MusicFinder.exe"
