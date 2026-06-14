@echo off
setlocal

set "SSH_HOST=192.168.0.231"
set "SSH_USER=rudi109"
set "MYHOME_SRC=/home/rudi109/music/myhome/dist/win-unpacked"
set "HUB_SRC=/home/rudi109/music/familyhub/dist/familyhub.exe"
set "DST=C:\DEV\test"

echo === My Home (dev) ===

rem First run: copy everything
if not exist "%DST%\resources\app.asar" (
  echo First run - copying full distribution...
  if not exist "%DST%" mkdir "%DST%"
  scp -r %SSH_USER%@%SSH_HOST%:%MYHOME_SRC%/. %DST%
  if errorlevel 1 ( echo [ERROR] scp myhome failed & pause & exit /b 1 )
  scp %SSH_USER%@%SSH_HOST%:%HUB_SRC% %DST%\familyhub.exe
  if errorlevel 1 ( echo [ERROR] scp familyhub failed & pause & exit /b 1 )
  goto launch
)

rem Subsequent runs: kill apps, update resources + familyhub
echo Closing apps...
taskkill /F /T /IM familyhub.exe >nul 2>&1
taskkill /F /T /IM myhome.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo Updating resources...
scp -r %SSH_USER%@%SSH_HOST%:%MYHOME_SRC%/resources/. %DST%\resources
if errorlevel 1 ( echo [ERROR] scp resources failed & pause & exit /b 1 )

echo Updating familyhub...
scp %SSH_USER%@%SSH_HOST%:%HUB_SRC% %DST%\familyhub.exe
if errorlevel 1 ( echo [ERROR] scp familyhub failed & pause & exit /b 1 )

:launch
echo Launching familyhub...
start "" "%DST%\familyhub.exe"
endlocal
