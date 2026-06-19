@echo off
title FamilyHub Recovery
echo === FamilyHub Recovery ===
echo.
cd /D "%~dp0"
echo Stopping all FamilyHub apps...
taskkill /F /IM family_media.exe /T >nul 2>&1
taskkill /F /IM family_bulletin.exe /T >nul 2>&1
ping -n 3 127.0.0.1 >nul
echo Clearing lock files...
if exist "tmp\.update.lock" del /F /Q "tmp\.update.lock" >nul 2>&1
echo.
echo Restarting apps...
if exist "family_media.exe"    start "" "family_media.exe"    --post-update
if exist "family_bulletin.exe" start "" "family_bulletin.exe" --post-update
echo Done.
echo.
pause
