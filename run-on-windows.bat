@echo off
setlocal

set "SRC=X:\music\dist\win-unpacked"
set "DST=C:\DEV\test"

echo === MusicFinder ===

if not exist "%SRC%\MusicFinder.exe" (
  echo [ERROR] Source not found: %SRC%
  echo Check that X: drive is connected.
  pause
  exit /b 1
)

rem First run: copy full distribution if MusicFinder.exe not present
if not exist "%DST%\MusicFinder.exe" (
  echo First run - copying full distribution...
  if not exist "%DST%" mkdir "%DST%"
  robocopy "%SRC%" "%DST%" /E /COPY:DAT /FFT /R:3 /W:5 /NP /NFL /NDL /NJH /NJS
  goto launch
)

rem Subsequent runs: kill app, update only resources/ (app.asar changes each build)
echo Closing MusicFinder...
taskkill /F /T /IM MusicFinder.exe >/dev/null 2>&1
timeout /t 2 /nobreak >/dev/null

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
start "" "%DST%\MusicFinder.exe"
endlocal
