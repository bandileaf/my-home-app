@echo off
setlocal

set "SSH_HOST=192.168.0.231"
set "SSH_USER=rudi109"
set "ROOT=/home/rudi109/my_home_app"
set "DST=C:\DEV\test"

echo === FamilyHub dev build ===

echo [1/3] Building on Linux...
ssh %SSH_USER%@%SSH_HOST% "cd %ROOT%/media && npx electron-vite build 2>&1 | tail -3"
if errorlevel 1 ( echo [ERROR] media build failed & pause & exit /b 1 )
ssh %SSH_USER%@%SSH_HOST% "cd %ROOT%/bulletin && npx electron-vite build 2>&1 | tail -3"
if errorlevel 1 ( echo [ERROR] bulletin build failed & pause & exit /b 1 )

echo [2/3] Copying resources...
taskkill /F /IM family_media.exe /T >nul 2>&1
taskkill /F /IM family_bulletin.exe /T >nul 2>&1
ping -n 3 127.0.0.1 >nul

if not exist "%DST%" mkdir "%DST%"

scp -r %SSH_USER%@%SSH_HOST%:%ROOT%/media/dist/win-unpacked/resources/. "%DST%\resources"
if errorlevel 1 ( echo [ERROR] scp media failed & pause & exit /b 1 )

scp -r %SSH_USER%@%SSH_HOST%:%ROOT%/bulletin/dist/win-unpacked/resources/. "%DST%\resources"
if errorlevel 1 ( echo [ERROR] scp bulletin failed & pause & exit /b 1 )

echo [3/3] Launching...
start "" "%DST%\family_media.exe"
start "" "%DST%\family_bulletin.exe"

endlocal
