@echo off
setlocal
set "INSTALL_DIR=%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$dir = $env:INSTALL_DIR;" ^
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
  "Write-Host '시작 프로그램 등록(레지스트리) 정리 중...';" ^
  "Remove-ItemProperty -Path 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run' -Name 'family_bulletin' -ErrorAction SilentlyContinue;" ^
  "Write-Host '프로그램 파일 삭제 중...';" ^
  "foreach ($p in $procs) {" ^
  "  $exe = Join-Path $dir ($p + '.exe');" ^
  "  if (Test-Path $exe) { Remove-Item $exe -Force; Write-Host ('삭제: ' + $p + '.exe') }" ^
  "};" ^
  "Write-Host '';" ^
  "Write-Host '정리 완료.'"

echo.
pause
