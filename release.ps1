$ErrorActionPreference = 'Stop'

$repo   = 'bandileaf/my-home-app'
$outDir = Join-Path $PSScriptRoot 'downloaded-release'

New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Write-Host "최신 릴리즈 조회 중... ($repo)"
$release = Invoke-RestMethod `
    -Uri "https://api.github.com/repos/$repo/releases/latest" `
    -Headers @{ 'User-Agent' = 'familyhub-downloader' }

Write-Host "최신 태그: $($release.tag_name)"

$assets = $release.assets | Where-Object { $_.name -like 'family_*.zip' }
if (-not $assets) {
    Write-Host "다운로드할 zip 자산을 찾지 못했습니다."
    exit 1
}

foreach ($asset in $assets) {
    $dest = Join-Path $outDir $asset.name
    Write-Host "다운로드: $($asset.name)"
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dest
}

Write-Host ""
Write-Host "완료. 저장 위치: $outDir"
