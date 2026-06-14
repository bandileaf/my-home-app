@echo off
setlocal

set "SSH_HOST=192.168.0.231"
set "SSH_USER=rudi109"
set "SRC_DIR=/home/rudi109/music/myhome/dist/win-unpacked"
set "DST=C:\DEV\test"

echo === My Home ===

rem First run: copy full distribution
if not exist "%DST%\myhome.exe" (
  echo First run - copying full distribution...
  if not exist "%DST%" mkdir "%DST%"
  scp -r %SSH_USER%@%SSH_HOST%:%SRC_DIR%/* "%DST%\"
  if errorlevel 1 (
    echo [ERROR] scp failed
    pause
    exit /b 1
  )
  goto launch
)

rem Subsequent runs: kill app, update only resources/
echo Closing My Home...
taskkill /F /T /IM myhome.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo Updating resources...
scp -r %SSH_USER%@%SSH_HOST%:%SRC_DIR%/resources/* "%DST%\resources\"
if errorlevel 1 (
  echo [ERROR] scp failed
  pause
  exit /b 1
)

:launch
echo Launching...
start "" "%DST%\myhome.exe"
endlocal
