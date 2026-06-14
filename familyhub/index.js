const https = require('https')
const http = require('http')
const fs = require('fs')
const path = require('path')
const AdmZip = require('adm-zip')
const { spawn } = require('child_process')

const IS_PKG = typeof process.pkg !== 'undefined'
const BASE_DIR = IS_PKG ? path.dirname(process.execPath) : __dirname
const SETTINGS_PATH = path.join(BASE_DIR, 'settings.json')

const EXE_NAME = path.basename(IS_PKG ? process.execPath : __filename).replace(/\.(exe|js)$/i, '')
const LOG_DIR = path.join(BASE_DIR, 'log')
fs.mkdirSync(LOG_DIR, { recursive: true })
const LOG_PATH = path.join(LOG_DIR, `${EXE_NAME}.log`)
const log_stream = fs.createWriteStream(LOG_PATH, { flags: 'w' })

function log(msg) {
  log_stream.write(`[${new Date().toISOString()}] ${msg}\n`)
}

// ── notification window ──────────────────────────────────────────────────────

const STATUS_FILE = path.join(BASE_DIR, '_hub_status.json')
const NOTIFY_PS1  = path.join(BASE_DIR, '_hub_notify.ps1')

function set_status(msg) {
  log(msg)
  try { fs.writeFileSync(STATUS_FILE, JSON.stringify({ message: msg, done: false }), 'utf8') } catch {}
}

function end_notification() {
  try { fs.writeFileSync(STATUS_FILE, JSON.stringify({ done: true }), 'utf8') } catch {}
}

function start_notification() {
  if (!IS_PKG) return

  const sf = STATUS_FILE.replace(/\\/g, '\\\\')
  const ps1 = `
$sf = '${sf}'
Add-Type -AssemblyName PresentationCore, PresentationFramework, WindowsBase
[xml]$x = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
  WindowStyle="None" AllowsTransparency="True" Background="Transparent"
  ShowInTaskbar="False" Topmost="True" SizeToContent="WidthAndHeight" ResizeMode="NoResize">
  <Border Background="#E6141420" CornerRadius="10" Padding="16,12">
    <StackPanel Orientation="Horizontal" VerticalAlignment="Center">
      <TextBlock Name="sp" Text="◐" Foreground="#CBA6F7" FontSize="20"
                 VerticalAlignment="Center" Margin="0,0,12,0"/>
      <StackPanel>
        <TextBlock Text="FamilyHub" Foreground="#A6ADC8" FontSize="10" FontWeight="Bold"/>
        <TextBlock Name="msg" Text="시작 중..." Foreground="#CDD6F4" FontSize="13" MinWidth="220"/>
      </StackPanel>
    </StackPanel>
  </Border>
</Window>
'@
$r = New-Object System.Xml.XmlNodeReader $x
$w = [Windows.Markup.XamlReader]::Load($r)
$wa = [Windows.SystemParameters]::WorkArea
$w.Left = $wa.Right - 300
$w.Top  = $wa.Bottom - 82
$m  = $w.FindName('msg')
$sp = $w.FindName('sp')
$fr = @('◐','◓','◑','◒')
$fi = 0
$t = New-Object Windows.Threading.DispatcherTimer
$t.Interval = [TimeSpan]::FromMilliseconds(350)
$t.Add_Tick({
  try {
    $d = [IO.File]::ReadAllText($sf) | ConvertFrom-Json
    if ($d.done) { $t.Stop(); $w.Close(); return }
    $m.Text = $d.message
  } catch {}
  $sp.Text = $fr[$script:fi]
  $script:fi = ($script:fi + 1) % 4
})
$w.Add_Loaded({ $script:t.Start() })
$w.ShowDialog() | Out-Null
try { Remove-Item $sf -Force -ErrorAction SilentlyContinue } catch {}
try { Remove-Item '${ NOTIFY_PS1.replace(/\\/g, '\\\\') }' -Force -ErrorAction SilentlyContinue } catch {}
`
  try {
    fs.writeFileSync(NOTIFY_PS1, ps1, 'utf8')
    fs.writeFileSync(STATUS_FILE, JSON.stringify({ message: '시작 중...', done: false }), 'utf8')
    spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass', '-File', NOTIFY_PS1
    ], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  } catch (err) {
    log(`Notification unavailable: ${err.message}`)
  }
}

// ── settings ─────────────────────────────────────────────────────────────────

function read_settings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'))
  } catch {
    log('settings.json not found: ' + SETTINGS_PATH)
    process.exit(1)
  }
}

function write_settings(settings) {
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8')
}

// ── network ───────────────────────────────────────────────────────────────────

function fetch_latest_release(repo) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'api.github.com',
      path: `/repos/${repo}/releases/latest`,
      headers: { 'User-Agent': 'FamilyHub' }
    }, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch { reject(new Error('Failed to parse release info')) }
      })
    }).on('error', reject)
  })
}

// resolves with the first /releases/download/{tag}/ URL seen during redirects
function download_file(url, dest) {
  return new Promise((resolve, reject) => {
    let releaseUrl = ''
    const follow = (u) => {
      if (!releaseUrl && u.includes('/releases/download/')) releaseUrl = u
      const mod = u.startsWith('https') ? https : http
      mod.get(u, { headers: { 'User-Agent': 'FamilyHub' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return follow(res.headers.location)
        }
        const tmp = dest + '.tmp'
        const file = fs.createWriteStream(tmp)
        res.on('data', chunk => file.write(chunk))
        res.on('end', () => {
          file.end(() => {
            fs.renameSync(tmp, dest)
            resolve(releaseUrl || u)
          })
        })
        res.on('error', reject)
      }).on('error', reject)
    }
    follow(url)
  })
}

function extract_version_from_url(url) {
  const m = url.match(/\/releases\/download\/([^/]+)\//)
  return m ? m[1] : ''
}

function derive_myhome_version(exeName) {
  const m = (exeName || '').match(/_v([\d.]+)\.exe$/i)
  return m ? `v${m[1]}` : ''
}

function compare_versions(a, b) {
  const pa = (a || '0').replace(/^v/, '').split('.').map(Number)
  const pb = (b || '0').replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
  }
  return 0
}

// ── launch ────────────────────────────────────────────────────────────────────

function launch(exeName) {
  const exePath = path.join(BASE_DIR, exeName)
  if (!fs.existsSync(exePath)) {
    log(`Not found: ${exePath}`)
    end_notification()
    log_stream.end()
    process.exit(1)
  }
  log(`Launching ${exeName}...`)
  end_notification()
  log_stream.end()
  spawn(exePath, [], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PORTABLE_EXECUTABLE_DIR: BASE_DIR }
  }).unref()
  process.exit(0)
}

// ── bins ──────────────────────────────────────────────────────────────────────

async function ensure_bins(bins, settings) {
  let dirty = false
  const zipCache   = new Map()
  const zipVersion = new Map()

  for (const bin of bins) {
    const destPath = path.join(BASE_DIR, bin.dest)
    if (fs.existsSync(destPath)) {
      if (bin.version) {
        log(`${bin.dest}: already installed (${bin.version})`)
        continue
      }
      log(`${bin.dest}: no version info, re-downloading...`)
      fs.unlinkSync(destPath)
    }

    set_status(`${path.basename(bin.dest)} 다운로드 중...`)
    fs.mkdirSync(path.dirname(destPath), { recursive: true })

    const zipDestPath = path.join(BASE_DIR, 'bin', path.basename(bin.url))
    try {
      let version = ''
      if (bin.zip) {
        let zip = zipCache.get(bin.url)
        if (!zip) {
          const zipName = path.basename(bin.url)
          set_status(`${zipName} 다운로드 중...`)
          const finalUrl = await download_file(bin.url, zipDestPath)
          version = extract_version_from_url(finalUrl)
          log(`Extracting from ${zipName}...`)
          zip = new AdmZip(zipDestPath)
          zipCache.set(bin.url, zip)
          zipVersion.set(bin.url, version)
          fs.unlinkSync(zipDestPath)
        } else {
          version = zipVersion.get(bin.url) ?? ''
        }
        const entry = zip.getEntry(bin.zip)
        if (!entry) throw new Error(`entry not found in zip: ${bin.zip}`)
        fs.writeFileSync(destPath, entry.getData())
      } else {
        const finalUrl = await download_file(bin.url, destPath)
        version = extract_version_from_url(finalUrl)
      }

      bin.version = version || 'unknown'
      dirty = true
      log(`${bin.dest}: installed${version ? ' (' + version + ')' : ''}`)
    } catch (err) {
      for (const p of [zipDestPath, zipDestPath + '.tmp', destPath + '.tmp']) {
        try { fs.unlinkSync(p) } catch { }
      }
      log(`${bin.dest}: FAILED — ${err.message}`)
    }
  }

  if (dirty) write_settings(settings)
}

// ── hub self-update ───────────────────────────────────────────────────────────

async function update_hub(release, settings) {
  if (!IS_PKG) return false

  const currentTag = settings['hub.tag'] || ''
  const latestTag  = release.tag_name

  if (currentTag && compare_versions(latestTag, currentTag) <= 0) {
    log(`Hub: ${currentTag} (up to date)`)
    return false
  }

  set_status(`FamilyHub ${latestTag} 업데이트 중...`)

  const zipName = `familyhub_${latestTag}.zip`
  const asset   = release.assets.find(a => a.name === zipName)
  if (!asset) {
    log(`Hub: ${zipName} not found in release — skipping`)
    return false
  }

  const zipPath = path.join(BASE_DIR, zipName)
  await download_file(asset.browser_download_url, zipPath)

  const newExeName = `familyhub_${latestTag}.exe`
  const newExePath = path.join(BASE_DIR, newExeName)

  const zip   = new AdmZip(zipPath)
  const entry = zip.getEntry('familyhub.exe')
  if (!entry) {
    fs.unlinkSync(zipPath)
    log('Hub: familyhub.exe not found in zip — skipping')
    return false
  }
  fs.writeFileSync(newExePath, entry.getData())
  fs.unlinkSync(zipPath)

  settings['hub.tag'] = latestTag
  write_settings(settings)

  const batPath = path.join(BASE_DIR, '_hub_update.bat')
  const bat = [
    '@echo off',
    `cd /d "${BASE_DIR}"`,
    'timeout /t 1 /nobreak >nul',
    'del /f /q "familyhub.exe"',
    `ren "${newExeName}" "familyhub.exe"`,
    'start "" "familyhub.exe"',
    '(goto) 2>nul & del "%~f0"',
  ].join('\r\n')
  fs.writeFileSync(batPath, bat, 'utf8')

  log(`Hub: updated to ${latestTag}, restarting...`)
  end_notification()
  spawn('cmd.exe', ['/c', batPath], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  log_stream.end()
  process.exit(0)
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  log('FamilyHub start')
  start_notification()

  const settings   = read_settings()
  const repo       = settings['hub.repo']
  const currentExe = settings['hub.app.myhome']

  const bins = settings['hub.bins'] ?? []
  if (bins.some(b => !fs.existsSync(path.join(BASE_DIR, b.dest)))) {
    set_status('필요한 도구를 설치하는 중...')
  }
  await ensure_bins(bins, settings)

  const currentHubTag    = settings['hub.tag'] || ''
  const currentMyhomeTag = derive_myhome_version(currentExe)
  set_status('업데이트 확인 중...')
  log(`Checking for updates... (hub: ${currentHubTag || '?'}, myhome: ${currentMyhomeTag || '?'})`)

  let release
  try {
    release = await fetch_latest_release(repo)
  } catch (err) {
    log(`Update check FAILED: ${err.message}`)
    set_status('서버에 연결할 수 없습니다. 현재 버전을 실행합니다.')
    await new Promise(r => setTimeout(r, 1500))
    launch(currentExe)
    return
  }

  const latestTag = release.tag_name
  if (!latestTag) {
    log(`Update check FAILED: unable to reach ${repo} — cannot verify latest release`)
    set_status('최신 버전을 확인할 수 없습니다. 현재 버전을 실행합니다.')
    await new Promise(r => setTimeout(r, 1500))
    launch(currentExe)
    return
  }
  log(`Latest: ${latestTag}`)

  await update_hub(release, settings)

  if (compare_versions(latestTag, currentMyhomeTag) > 0) {
    const newExeName = `myhome_${latestTag}.exe`
    const asset      = release.assets.find(a => a.name === newExeName)
    if (asset) {
      set_status(`My Home ${latestTag} 업데이트 중...`)
      const dest = path.join(BASE_DIR, newExeName)
      await download_file(asset.browser_download_url, dest)
      settings['hub.tag']        = latestTag
      settings['hub.app.myhome'] = newExeName
      write_settings(settings)
      log(`myhome ${latestTag} ready — new version will launch on next start.`)
      launch(newExeName)
    } else {
      log(`Asset ${newExeName} not found in release`)
      launch(currentExe)
    }
  } else {
    log('Already up to date.')
    set_status('My Home 실행 중...')
    launch(currentExe)
  }
}

main().catch(err => {
  log(`Fatal: ${err.message}`)
  end_notification()
  log_stream.end()
  process.exit(1)
})
