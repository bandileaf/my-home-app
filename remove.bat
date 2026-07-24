@echo off
setlocal
set "INSTALL_DIR=%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$dir = $env:INSTALL_DIR;" ^
  "$procs = 'family_bulletin','family_media','family_foldersize';" ^
  "Write-Host 'Stopping running apps...';" ^
  "foreach ($p in $procs) {" ^
  "  Get-Process -Name $p -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue" ^
  "};" ^
  "Start-Sleep -Milliseconds 800;" ^
  "$stillRunning = $procs | Where-Object { Get-Process -Name $_ -ErrorAction SilentlyContinue };" ^
  "if ($stillRunning) {" ^
  "  Write-Host ('Could not stop: ' + ($stillRunning -join ', '));" ^
  "  Write-Host 'Please close it manually and run again.';" ^
  "  exit 1" ^
  "};" ^
  "Write-Host 'Removing startup registry entry...';" ^
  "Remove-ItemProperty -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run' -Name 'family_bulletin' -ErrorAction SilentlyContinue;" ^
  "Write-Host 'Deleting program files...';" ^
  "foreach ($p in $procs) {" ^
  "  $exe = Join-Path $dir ($p + '.exe');" ^
  "  if (Test-Path $exe) { Remove-Item $exe -Force; Write-Host ('Deleted: ' + $p + '.exe') }" ^
  "};" ^
  "Write-Host '';" ^
  "Write-Host 'Cleanup complete.'"

echo.
pause
