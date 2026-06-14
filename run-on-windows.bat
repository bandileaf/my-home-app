@echo off
setlocal
rem === MusicFinder: copy build from network share (X:) to local (C:), then run ===
rem Use xcopy (robocopy fails with error 87 on SMB shares).
set "SRC=X:\music\dist\win-unpacked"
set "DST=C:\DEV\test"

echo Source : %SRC%
echo Target : %DST%
echo.

if not exist "%SRC%\MusicFinder.exe" (
  echo [ERROR] Source not found: %SRC%\MusicFinder.exe
  echo Check that the X: drive is connected.
  pause
  exit /b 1
)

if not exist "%DST%" mkdir "%DST%"

rem A running instance locks files (sharing violation), so close it first.
rem /T also kills Electron child processes; wait for handles to release.
echo Closing running MusicFinder...
taskkill /F /T /IM MusicFinder.exe 2>nul
timeout /t 2 /nobreak >nul

echo Copying... (xcopy)
xcopy "%SRC%\*" "%DST%\" /E /I /Y /R
if errorlevel 4 (
  echo First attempt failed, retrying in 3s...
  timeout /t 3 /nobreak >nul
  xcopy "%SRC%\*" "%DST%\" /E /I /Y /R
)
if errorlevel 4 (
  echo.
  echo [ERROR] Copy failed. errorlevel=%errorlevel%
  echo Close all MusicFinder windows ^(check Task Manager^) and try again.
  pause
  exit /b 1
)

echo.
echo Launching %DST%\MusicFinder.exe ...
start "" "%DST%\MusicFinder.exe"

endlocal
