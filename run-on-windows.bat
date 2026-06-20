@echo off
setlocal

set "SSH_HOST=192.168.0.231"
set "SSH_USER=rudi109"
set "ROOT=/home/rudi109/my_home_app"
set "DST=C:\DEV\test"

echo === FamilyHub dev build ===

echo [1/2] Copying...
taskkill /F /IM family_media.exe /T >nul 2>&1
taskkill /F /IM family_bulletin.exe /T >nul 2>&1
ping -n 6 127.0.0.1 >nul

if not exist "%DST%\family_media.exe" (
  scp -r %SSH_USER%@%SSH_HOST%:%ROOT%/media/dist/win-unpacked/. "%DST%"
  if errorlevel 1 ( echo [ERROR] scp media failed & pause & exit /b 1 )
) else (
  scp -r %SSH_USER%@%SSH_HOST%:%ROOT%/media/dist/win-unpacked/resources/. "%DST%\resources"
  if errorlevel 1 ( echo [ERROR] scp media resources failed & pause & exit /b 1 )
)

scp %SSH_USER%@%SSH_HOST%:%ROOT%/bulletin/dist/family_bulletin.exe "%DST%\family_bulletin.exe"
if errorlevel 1 ( echo [ERROR] scp bulletin failed & pause & exit /b 1 )

echo [2/2] Launching...
start "" "%DST%\family_media.exe"

endlocal
