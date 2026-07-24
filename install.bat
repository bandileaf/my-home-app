@echo off
setlocal
set "INSTALL_DIR=%~dp0"
set "REPO=bandileaf/my-home-app"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$dir = $env:INSTALL_DIR;" ^
  "$repo = $env:REPO;" ^
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
  "Write-Host ('Checking latest release... (' + $repo + ')');" ^
  "$rel = Invoke-RestMethod -Uri ('https://api.github.com/repos/' + $repo + '/releases/latest') -Headers @{ 'User-Agent' = 'familyhub-installer' };" ^
  "Write-Host ('Latest tag: ' + $rel.tag_name);" ^
  "$assets = $rel.assets | Where-Object { $_.name -like 'family_*.zip' };" ^
  "foreach ($a in $assets) {" ^
  "  $tmp = Join-Path $env:TEMP $a.name;" ^
  "  Write-Host ('Downloading: ' + $a.name);" ^
  "  Invoke-WebRequest -Uri $a.browser_download_url -OutFile $tmp;" ^
  "  Write-Host ('Extracting: ' + $a.name);" ^
  "  Expand-Archive -Path $tmp -DestinationPath $dir -Force;" ^
  "  Remove-Item $tmp -Force" ^
  "};" ^
  "Write-Host '';" ^
  "Write-Host ('Install complete: ' + $dir)"

echo.
pause
