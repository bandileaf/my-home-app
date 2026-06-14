@echo off
setlocal

set SRC=\\192.168.0.231\rudi109\music\dist\win-unpacked
set DST=C:\DEV\MusicFinder

echo === MusicFinder deploy ===
echo From: %SRC%
echo To:   %DST%
echo.

if not exist "%DST%\" mkdir "%DST%"

robocopy "%SRC%" "%DST%" /E /IS /IT /COPY:DAT /FFT /R:3 /W:3 /NP /V
set RC=%ERRORLEVEL%

echo.
echo robocopy exit code: %RC%

if %RC% GEQ 8 (
    echo [FAIL] Copy error - check messages above
    pause
    exit /b 1
)

echo [OK] Done.
echo.
echo Launching MusicFinder...
start "" "%DST%\MusicFinder.exe"
