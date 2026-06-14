import { app, BrowserWindow, ipcMain, screen } from 'electron'
import {
  existsSync, mkdirSync, createWriteStream,
  writeFileSync, readFileSync, unlinkSync, copyFileSync
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

// ── startup flags ─────────────────────────────────────────────────────────────
// --hub-replace-from <path>  after startup, replace <path> with this exe
// --replace-only             only replace the file then quit, no UI / no launch

const replaceFromIdx = process.argv.indexOf('--hub-replace-from')
const REPLACE_FROM   = replaceFromIdx !== -1 ? process.argv[replaceFromIdx + 1] : null
const REPLACE_ONLY   = process.argv.includes('--replace-only')

if (REPLACE_FROM && app.isPackaged) {
  setTimeout(() => {
    try {
      unlinkSync(REPLACE_FROM)
      copyFileSync(process.execPath, REPLACE_FROM)
      log('Self-update: replaced familyhub.exe successfully')
    } catch (err: unknown) {
      log(`Self-update: failed — ${(err as Error).message}`)
    }
  }, 1000)
}

// ── window ────────────────────────────────────────────────────────────────────

app.disableHardwareAcceleration()

let win: BrowserWindow | null = null
let rendererReady = false
let lastStatus    = '시작 중...'

function create_window(): BrowserWindow {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const W = 320, H = 96   // extra height for progress bar

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
    w.loadFile(join(__dirname, '../../renderer/index.html'))
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
        const total    = parseInt(res.headers['content-length'] ?? '0', 10)
        let received   = 0
        const tmp  = dest + '.tmp'
        const file = createWriteStream(tmp)
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

  // First install: myhome not present — download it now
  if (!myhomeReady) {
    const newExeName = `myhome_${latestTag}.exe`
    const asset      = release.assets.find(a => a.name === newExeName)
    if (!asset) {
      set_status('My Home을 찾을 수 없습니다.')
      log(`[${ms()}] Asset ${newExeName} not found in release`)
      await new Promise<void>(r => setTimeout(r, 3000))
      quit_app()
      return
    }
    set_status(`My Home ${latestTag} 다운로드 중...`)
    await download_file(asset.browser_download_url, join(BASE_DIR, newExeName), set_progress)
    settings['hub.tag']        = latestTag
    settings['hub.app.myhome'] = newExeName
    write_settings(settings)
    log(`[${ms()}] myhome downloaded: ${newExeName}`)
    do_launch(newExeName)
  }

  // Check if everything is already up to date
  const currentMyhomeTag = derive_myhome_version(settings['hub.app.myhome'] || '')
  const currentHubTag    = settings['hub.tag'] || ''
  const myhomeUpToDate   = compare_versions(latestTag, currentMyhomeTag) <= 0
  const hubUpToDate      = !!currentHubTag && compare_versions(latestTag, currentHubTag) <= 0

  if (myhomeUpToDate && hubUpToDate) {
    log(`[${ms()}] Already up to date (${latestTag})`)
    quit_app()
    return
  }

  // Hub self-update (background: download + silent replace, no restart)
  if (!hubUpToDate) {
    const zipName = `familyhub_${latestTag}.zip`
    const asset   = release.assets.find(a => a.name === zipName)
    if (asset) {
      set_status(`FamilyHub ${latestTag} 업데이트 중...`)
      const zipPath = join(BASE_DIR, zipName)
      try {
        await download_file(asset.browser_download_url, zipPath, set_progress)
        const newExeName = `familyhub_${latestTag}.exe`
        const newExePath = join(BASE_DIR, newExeName)
        const zip   = new AdmZip(zipPath)
        const entry = zip.getEntry('familyhub.exe')
        if (entry) {
          writeFileSync(newExePath, entry.getData())
          unlinkSync(zipPath)
          settings['hub.tag'] = latestTag
          write_settings(settings)
          // New exe will replace familyhub.exe silently and then quit
          spawn(newExePath, ['--hub-replace-from', process.execPath, '--replace-only'], {
            detached: true, stdio: 'ignore'
          }).unref()
          log(`[${ms()}] Hub ${latestTag} downloaded — replacing in background`)
          set_status(`FamilyHub ${latestTag} 교체 중...`)
          await new Promise<void>(r => setTimeout(r, 1500))
        } else {
          try { unlinkSync(zipPath) } catch { /* ignore */ }
        }
      } catch (err: unknown) {
        log(`[${ms()}] Hub update failed: ${(err as Error).message}`)
      }
    }
  }

  // myhome update (background: download for next launch)
  if (myhomeReady && !myhomeUpToDate) {
    const newExeName = `myhome_${latestTag}.exe`
    const asset      = release.assets.find(a => a.name === newExeName)
    if (asset && !existsSync(join(BASE_DIR, newExeName))) {
      set_status(`My Home ${latestTag} 다운로드 중...`)
      try {
        await download_file(asset.browser_download_url, join(BASE_DIR, newExeName), set_progress)
        settings['hub.tag']        = latestTag
        settings['hub.app.myhome'] = newExeName
        write_settings(settings)
        log(`[${ms()}] myhome ${latestTag} ready (applies on next launch)`)
        set_status(`My Home ${latestTag} 준비됨`)
        await new Promise<void>(r => setTimeout(r, 3000))
      } catch (err: unknown) {
        log(`[${ms()}] myhome update failed: ${(err as Error).message}`)
      }
    }
  }

  quit_app()
}

// ── app lifecycle ─────────────────────────────────────────────────────────────

ipcMain.on('ping', () => {})

app.whenReady().then(() => {
  if (REPLACE_ONLY) {
    // Silent mode: just do the file replacement and quit, no UI
    setTimeout(() => app.quit(), 1500)
    return
  }

  win = create_window()
  main().catch((err: unknown) => {
    log(`Fatal: ${(err as Error).message}`)
    quit_app()
  })
})

app.on('window-all-closed', () => app.quit())
