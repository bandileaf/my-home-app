@echo off
setlocal

set SRC=\\192.168.0.231\rudi109\music\dist\win-unpacked
set DST=C:\DEV\MusicFinder

echo === MusicFinder deploy ===
echo From: %SRC%
echo To:   %DST%
echo.

taskkill /F /IM MusicFinder.exe >/dev/null 2>&1
timeout /T 1 /NOBREAK >/dev/null 2>&1

if not exist "%DST%\" mkdir "%DST%"

robocopy "%SRC%" "%DST%" /E /IS /IT /COPY:DAT /FFT /R:3 /W:3 /NP
set RC=%ERRORLEVEL%

if %RC% GEQ 8 (
    echo [FAIL] Copy error - code %RC%
    pause
    exit /b 1
)

echo [OK] Done. Launching...
start "" "%DST%\MusicFinder.exe"
