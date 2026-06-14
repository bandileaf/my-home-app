import { app, BrowserWindow, ipcMain, screen } from 'electron'
import {
  existsSync, mkdirSync, createWriteStream,
  writeFileSync, readFileSync, unlinkSync
} from 'fs'
import { join, basename, dirname } from 'path'
import https from 'https'
import http from 'http'
import { spawn } from 'child_process'
import AdmZip from 'adm-zip'

// ── paths ─────────────────────────────────────────────────────────────────────

const BASE_DIR = app.isPackaged
  ? (process.env.PORTABLE_EXECUTABLE_DIR ?? dirname(process.execPath))
  : app.getAppPath()

const LOG_DIR   = join(BASE_DIR, 'log')
mkdirSync(LOG_DIR, { recursive: true })

const EXE_NAME   = basename(app.isPackaged ? process.execPath : 'familyhub').replace(/\.exe$/i, '')
const log_stream = createWriteStream(join(LOG_DIR, `${EXE_NAME}.log`), { flags: 'w' })

function log(msg: string): void {
  log_stream.write(`[${new Date().toISOString()}] ${msg}\n`)
}

// ── window ────────────────────────────────────────────────────────────────────

app.disableHardwareAcceleration()

let win: BrowserWindow | null = null
let rendererReady = false
let lastStatus    = '시작 중...'

function create_window(): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const W = 320, H = 96

  const w = new BrowserWindow({
    width: W,
    height: H,
    x: width  - W - 16,
    y: height - H - 16,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
    }
  })

  if (app.isPackaged) {
    w.loadFile(join(__dirname, '../renderer/index.html'))
  } else {
    w.loadURL('http://localhost:5173')
  }

  w.webContents.once('did-finish-load', () => {
    rendererReady = true
    w.webContents.send('status', { message: lastStatus, done: false })
    w.show()
  })
  return w
}

function set_status(msg: string): void {
  log(msg)
  lastStatus = msg
  if (rendererReady) win?.webContents.send('status', { message: msg, done: false })
}

function set_progress(pct: number): void {
  if (rendererReady) win?.webContents.send('progress', pct)
}

function quit_app(): void {
  log_stream.end()
  setTimeout(() => app.quit(), 150)
}

// ── settings ──────────────────────────────────────────────────────────────────

interface BinEntry {
  url: string
  dest: string
  zip?: string
  version: string
}

interface Settings {
  'hub.repo': string
  'hub.tag': string
  'hub.app.myhome': string
  'hub.bins': BinEntry[]
}

const SETTINGS_PATH = join(BASE_DIR, 'settings.json')

function read_settings(): Settings {
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) as Settings
  } catch {
    log('settings.json not found: ' + SETTINGS_PATH)
    process.exit(1)
  }
}

function write_settings(settings: Settings): void {
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8')
}

// ── network ───────────────────────────────────────────────────────────────────

interface GHRelease {
  tag_name: string
  assets: Array<{ name: string; browser_download_url: string }>
}

function fetch_latest_release(repo: string): Promise<GHRelease> {
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: 'api.github.com',
      path: `/repos/${repo}/releases/latest`,
      headers: { 'User-Agent': 'FamilyHub' }
    }, (res) => {
      let data = ''
      res.on('data', (chunk: Buffer) => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data) as GHRelease) }
        catch { reject(new Error('Failed to parse release info')) }
      })
    }).on('error', reject)
    req.setTimeout(10000, () => req.destroy(new Error('GitHub API timed out (10s)')))
  })
}

function download_file(
  url: string,
  dest: string,
  onProgress?: (pct: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    let releaseUrl = ''
    const follow = (u: string): void => {
      if (!releaseUrl && u.includes('/releases/download/')) releaseUrl = u
      const mod = u.startsWith('https') ? https : http
      mod.get(u, { headers: { 'User-Agent': 'FamilyHub' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return follow(res.headers.location!)
        }
        const total  = parseInt(res.headers['content-length'] ?? '0', 10)
        let received = 0
        const tmp    = dest + '.tmp'
        const file   = createWriteStream(tmp)
        res.on('data', (chunk: Buffer) => {
          file.write(chunk)
          if (total > 0 && onProgress) {
            received += chunk.length
            onProgress(Math.round((received / total) * 100))
          }
        })
        res.on('end', () => {
          file.end(() => {
            const { renameSync } = require('fs') as typeof import('fs')
            renameSync(tmp, dest)
            if (onProgress) onProgress(100)
            resolve(releaseUrl || u)
          })
        })
        res.on('error', reject)
      }).on('error', reject)
    }
    follow(url)
  })
}

function extract_version_from_url(url: string): string {
  const m = url.match(/\/releases\/download\/([^/]+)\//)
  return m ? m[1] : ''
}

function derive_myhome_version(exeName: string): string {
  const m = (exeName || '').match(/_v([\d.]+)\.exe$/i)
  return m ? `v${m[1]}` : ''
}

function compare_versions(a: string, b: string): number {
  const pa = (a || '0').replace(/^v/, '').split('.').map(Number)
  const pb = (b || '0').replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
  }
  return 0
}

// ── launch ────────────────────────────────────────────────────────────────────

function do_launch(exeName: string): boolean {
  const exePath = join(BASE_DIR, exeName)
  if (!existsSync(exePath)) {
    log(`Not found: ${exePath}`)
    return false
  }
  log(`Launching ${exeName}`)
  spawn(exePath, [], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PORTABLE_EXECUTABLE_DIR: BASE_DIR }
  }).unref()
  return true
}

// ── bins ──────────────────────────────────────────────────────────────────────

async function ensure_bins(bins: BinEntry[], settings: Settings): Promise<void> {
  let dirty = false
  const zipCache:   Map<string, AdmZip> = new Map()
  const zipVersion: Map<string, string>  = new Map()

  for (const bin of bins) {
    const destPath = join(BASE_DIR, bin.dest)
    if (existsSync(destPath)) {
      if (bin.version) {
        log(`${bin.dest}: already installed (${bin.version})`)
        continue
      }
      log(`${bin.dest}: no version info, re-downloading...`)
      unlinkSync(destPath)
    }

    set_status(`${basename(bin.dest)} 다운로드 중...`)
    mkdirSync(dirname(destPath), { recursive: true })

    const zipDestPath = join(BASE_DIR, 'bin', basename(bin.url))
    try {
      let version = ''
      if (bin.zip) {
        let zip = zipCache.get(bin.url)
        if (!zip) {
          set_status(`${basename(bin.url)} 다운로드 중...`)
          const finalUrl = await download_file(bin.url, zipDestPath, set_progress)
          version = extract_version_from_url(finalUrl)
          log(`Extracting from ${basename(bin.url)}...`)
          zip = new AdmZip(zipDestPath)
          zipCache.set(bin.url, zip)
          zipVersion.set(bin.url, version)
          unlinkSync(zipDestPath)
        } else {
          version = zipVersion.get(bin.url) ?? ''
        }
        const entry = zip.getEntry(bin.zip)
        if (!entry) throw new Error(`entry not found in zip: ${bin.zip}`)
        writeFileSync(destPath, entry.getData())
      } else {
        const finalUrl = await download_file(bin.url, destPath, set_progress)
        version = extract_version_from_url(finalUrl)
      }
      bin.version = version || 'unknown'
      dirty = true
      log(`${bin.dest}: installed${version ? ' (' + version + ')' : ''}`)
    } catch (err: unknown) {
      for (const p of [zipDestPath, zipDestPath + '.tmp', destPath + '.tmp']) {
        try { unlinkSync(p) } catch { /* ignore */ }
      }
      log(`${bin.dest}: FAILED — ${(err as Error).message}`)
    }
  }

  if (dirty) write_settings(settings)
}

// ── update via zip ────────────────────────────────────────────────────────────
// zip contains: myhome_v{tag}.exe + familyhub.exe + settings.json
// Extracts myhome and familyhub_{tag}.exe, then spawns a hidden PS1 to
// replace familyhub.exe after the current process exits.

async function apply_update(zipPath: string, latestTag: string, settings: Settings): Promise<void> {
  const zip = new AdmZip(zipPath)

  // Extract myhome_v{tag}.exe
  const myhomeEntry = zip.getEntries().find(e => /^myhome_v[\d.]+\.exe$/i.test(e.entryName))
  if (myhomeEntry) {
    writeFileSync(join(BASE_DIR, myhomeEntry.entryName), myhomeEntry.getData())
    settings['hub.app.myhome'] = myhomeEntry.entryName
    log(`Extracted ${myhomeEntry.entryName}`)
  }

  // Extract familyhub.exe → familyhub_{tag}.exe
  const hubEntry   = zip.getEntry('familyhub.exe')
  const newHubName = `familyhub_${latestTag}.exe`
  const newHubPath = join(BASE_DIR, newHubName)
  if (hubEntry) {
    writeFileSync(newHubPath, hubEntry.getData())
    log(`Extracted familyhub.exe → ${newHubName}`)
  }

  unlinkSync(zipPath)
  settings['hub.tag'] = latestTag
  write_settings(settings)

  // Spawn hidden PS1: wait 1s → delete familyhub.exe → rename new → self-delete
  if (hubEntry) {
    const hubExePath = join(BASE_DIR, 'familyhub.exe')
    const ps1Path    = join(BASE_DIR, '_hub_update.ps1')
    const q = (p: string) => `'${p.replace(/'/g, "''")}'`
    writeFileSync(ps1Path, [
      'Start-Sleep -Seconds 1',
      `Remove-Item -Force ${q(hubExePath)}`,
      `Rename-Item -Path ${q(newHubPath)} -NewName 'familyhub.exe'`,
      `Remove-Item -Force $MyInvocation.MyCommand.Path`,
    ].join('\n'), 'utf8')

    spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass', '-File', ps1Path
    ], { detached: true, stdio: 'ignore', windowsHide: true }).unref()

    log(`Hub replace script spawned (${newHubName} → familyhub.exe)`)
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const t0 = Date.now()
  const ms = () => `+${Date.now() - t0}ms`

  log('FamilyHub start')

  const settings   = read_settings()
  const repo       = settings['hub.repo']
  const currentExe = settings['hub.app.myhome']

  // Block only if bins are missing (first install)
  const bins = settings['hub.bins'] ?? []
  if (bins.some((b: BinEntry) => !existsSync(join(BASE_DIR, b.dest)))) {
    set_status('필요한 도구를 설치하는 중...')
    await ensure_bins(bins, settings)
  }

  // Launch myhome immediately if available
  const myhomeReady = !!(currentExe && existsSync(join(BASE_DIR, currentExe)))
  if (myhomeReady) {
    log(`[${ms()}] Launching ${currentExe}`)
    do_launch(currentExe)
  }

  // Background: check GitHub
  set_status('릴리즈 버전 확인 중...')
  log(`[${ms()}] Checking for updates (hub: ${settings['hub.tag'] || '?'})`)

  let release: GHRelease
  try {
    release = await fetch_latest_release(repo)
    log(`[${ms()}] GitHub API responded`)
  } catch (err: unknown) {
    log(`[${ms()}] Unable to reach ${repo}: ${(err as Error).message}`)
    set_status('연결에 실패하였습니다.')
    await new Promise<void>(r => setTimeout(r, 3000))
    quit_app()
    return
  }

  const latestTag = release.tag_name
  if (!latestTag) {
    log(`[${ms()}] No tag_name in release response`)
    set_status('연결에 실패하였습니다.')
    await new Promise<void>(r => setTimeout(r, 3000))
    quit_app()
    return
  }
  log(`[${ms()}] Latest: ${latestTag}`)

  // Up to date → close immediately
  const currentTag = settings['hub.tag'] || ''
  if (currentTag && compare_versions(latestTag, currentTag) <= 0) {
    log(`[${ms()}] Already up to date (${latestTag})`)
    quit_app()
    return
  }

  // Update available: find zip asset
  const zipAsset = release.assets.find(a => a.name === `familyhub_${latestTag}.zip`)
  if (!zipAsset) {
    log(`[${ms()}] familyhub_${latestTag}.zip not found in release — skipping update`)
    quit_app()
    return
  }

  // Download zip with progress bar
  set_status(`${latestTag} 다운로드 중...`)
  const zipPath = join(BASE_DIR, `familyhub_${latestTag}.zip`)
  try {
    await download_file(zipAsset.browser_download_url, zipPath, set_progress)
    log(`[${ms()}] Download complete`)
  } catch (err: unknown) {
    log(`[${ms()}] Download failed: ${(err as Error).message}`)
    try { unlinkSync(zipPath) } catch { /* ignore */ }
    set_status('다운로드 실패.')
    await new Promise<void>(r => setTimeout(r, 3000))
    quit_app()
    return
  }

  // Extract and schedule hub replacement
  set_status(`${latestTag} 설치 중...`)
  await apply_update(zipPath, latestTag, settings)

  // Launch new myhome if it wasn't running before
  if (!myhomeReady) {
    do_launch(settings['hub.app.myhome'])
  }

  set_status(`${latestTag} 교체 중... 잠시 후 종료됩니다.`)
  log(`[${ms()}] Done`)
  await new Promise<void>(r => setTimeout(r, 2000))
  quit_app()
}

// ── app lifecycle ─────────────────────────────────────────────────────────────

ipcMain.on('ping', () => {})

app.whenReady().then(() => {
  win = create_window()
  main().catch((err: unknown) => {
    log(`Fatal: ${(err as Error).message}`)
    quit_app()
  })
})

app.on('window-all-closed', () => app.quit())
