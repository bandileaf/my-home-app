@echo off
setlocal

set "SRC=X:\music\myhome\dist\win-unpacked"
set "DST=C:\DEV\test"

echo === My Home ===

if not exist "%SRC%\myhome.exe" (
  echo [ERROR] Source not found: %SRC%
  echo Check that X: drive is connected and build was run.
  pause
  exit /b 1
)

rem First run: copy full distribution if myhome.exe not present
if not exist "%DST%\myhome.exe" (
  echo First run - copying full distribution...
  if not exist "%DST%" mkdir "%DST%"
  robocopy "%SRC%" "%DST%" /E /COPY:DAT /FFT /R:3 /W:5 /NP /NFL /NDL /NJH /NJS
  goto launch
)

rem Subsequent runs: kill app, update only resources/ (app.asar changes each build)
echo Closing My Home...
taskkill /F /T /IM myhome.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo Updating resources...
robocopy "%SRC%\resources" "%DST%\resources" /E /IS /COPY:DAT /FFT /R:3 /W:5 /NP /NFL /NDL /NJH /NJS
set RC=%ERRORLEVEL%
if %RC% GEQ 8 (
  echo [FAIL] Update failed - code %RC%
  pause
  exit /b 1
)

:launch
echo Launching...
start "" "%DST%\myhome.exe"
endlocal
