@echo off
setlocal
set "INSTALL_DIR=%~dp0"
set "REPO=bandileaf/my-home-app"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$dir = $env:INSTALL_DIR;" ^
  "$repo = $env:REPO;" ^
  "$procs = 'family_bulletin','family_media','family_foldersize';" ^
  "Write-Host '실행 중인 프로그램 종료 중...';" ^
  "foreach ($p in $procs) {" ^
  "  Get-Process -Name $p -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue" ^
  "};" ^
  "Start-Sleep -Milliseconds 800;" ^
  "$stillRunning = $procs | Where-Object { Get-Process -Name $_ -ErrorAction SilentlyContinue };" ^
  "if ($stillRunning) {" ^
  "  Write-Host ('다음 프로그램을 종료하지 못했습니다: ' + ($stillRunning -join ', '));" ^
  "  Write-Host '수동으로 종료한 뒤 다시 실행해주세요.';" ^
  "  exit 1" ^
  "};" ^
  "Write-Host ('최신 릴리즈 조회 중... (' + $repo + ')');" ^
  "$rel = Invoke-RestMethod -Uri ('https://api.github.com/repos/' + $repo + '/releases/latest') -Headers @{ 'User-Agent' = 'familyhub-installer' };" ^
  "Write-Host ('최신 태그: ' + $rel.tag_name);" ^
  "$assets = $rel.assets | Where-Object { $_.name -like 'family_*.zip' };" ^
  "foreach ($a in $assets) {" ^
  "  $tmp = Join-Path $env:TEMP $a.name;" ^
  "  Write-Host ('다운로드: ' + $a.name);" ^
  "  Invoke-WebRequest -Uri $a.browser_download_url -OutFile $tmp;" ^
  "  Write-Host ('압축 해제: ' + $a.name);" ^
  "  Expand-Archive -Path $tmp -DestinationPath $dir -Force;" ^
  "  Remove-Item $tmp -Force" ^
  "};" ^
  "Write-Host '';" ^
  "Write-Host ('설치 완료: ' + $dir)"

echo.
pause
