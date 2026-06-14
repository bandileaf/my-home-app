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

const LOG_DIR  = join(BASE_DIR, 'log')
mkdirSync(LOG_DIR, { recursive: true })

const EXE_NAME  = basename(app.isPackaged ? process.execPath : 'familyhub').replace(/\.(exe)$/i, '')
const LOG_PATH  = join(LOG_DIR, `${EXE_NAME}.log`)
const log_stream = createWriteStream(LOG_PATH, { flags: 'w' })

function log(msg: string): void {
  log_stream.write(`[${new Date().toISOString()}] ${msg}\n`)
}

// ── self-update entry (run before window opens) ───────────────────────────────
// Spawned as: familyhub_vX.exe --hub-replace-from C:\path\familyhub.exe

const replaceFromIdx = process.argv.indexOf('--hub-replace-from')
const REPLACE_FROM   = replaceFromIdx !== -1 ? process.argv[replaceFromIdx + 1] : null

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
  const W = 320, H = 80

  const w = new BrowserWindow({
    width: W,
    height: H,
    x: width  - W - 16,
    y: height - H - 16,
    frame: false,
    transparent: true,
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

  w.once('ready-to-show', () => w.show())
  w.webContents.once('did-finish-load', () => {
    rendererReady = true
    w.webContents.send('status', { message: lastStatus, done: false })
  })
  return w
}

function set_status(msg: string): void {
  log(msg)
  lastStatus = msg
  if (rendererReady) win?.webContents.send('status', { message: msg, done: false })
}

function quit_app(): void {
  win?.webContents.send('status', { done: true })
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
    https.get({
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
  })
}

function download_file(url: string, dest: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let releaseUrl = ''
    const follow = (u: string): void => {
      if (!releaseUrl && u.includes('/releases/download/')) releaseUrl = u
      const mod = u.startsWith('https') ? https : http
      mod.get(u, { headers: { 'User-Agent': 'FamilyHub' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return follow(res.headers.location!)
        }
        const tmp  = dest + '.tmp'
        const file = createWriteStream(tmp)
        res.on('data', (chunk: Buffer) => { file.write(chunk) })
        res.on('end', () => {
          file.end(() => {
            const { renameSync } = require('fs') as typeof import('fs')
            renameSync(tmp, dest)
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

// ── launch myhome ─────────────────────────────────────────────────────────────

function launch(exeName: string): void {
  const exePath = join(BASE_DIR, exeName)
  if (!existsSync(exePath)) {
    log(`Not found: ${exePath}`)
    quit_app()
    return
  }
  log(`Launching ${exeName}...`)
  spawn(exePath, [], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, PORTABLE_EXECUTABLE_DIR: BASE_DIR }
  }).unref()
  quit_app()
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
          const finalUrl = await download_file(bin.url, zipDestPath)
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
        const finalUrl = await download_file(bin.url, destPath)
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

// ── hub self-update ───────────────────────────────────────────────────────────

async function update_hub(release: GHRelease, settings: Settings): Promise<boolean> {
  if (!app.isPackaged) return false

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

  const zipPath = join(BASE_DIR, zipName)
  await download_file(asset.browser_download_url, zipPath)

  const newExeName = `familyhub_${latestTag}.exe`
  const newExePath = join(BASE_DIR, newExeName)

  const zip   = new AdmZip(zipPath)
  const entry = zip.getEntry('familyhub.exe')
  if (!entry) {
    unlinkSync(zipPath)
    log('Hub: familyhub.exe not found in zip — skipping')
    return false
  }
  writeFileSync(newExePath, entry.getData())
  unlinkSync(zipPath)

  settings['hub.tag'] = latestTag
  write_settings(settings)

  log(`Hub: updated to ${latestTag}, restarting...`)

  // Spawn new exe with flag to replace the current exe after we exit
  spawn(newExePath, ['--hub-replace-from', process.execPath], {
    detached: true,
    stdio: 'ignore'
  }).unref()

  quit_app()
  return true
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log('FamilyHub start')

  const settings   = read_settings()
  const repo       = settings['hub.repo']
  const currentExe = settings['hub.app.myhome']

  const bins = settings['hub.bins'] ?? []
  if (bins.some((b: BinEntry) => !existsSync(join(BASE_DIR, b.dest)))) {
    set_status('필요한 도구를 설치하는 중...')
  }
  await ensure_bins(bins, settings)

  const currentHubTag    = settings['hub.tag'] || ''
  const currentMyhomeTag = derive_myhome_version(currentExe)
  set_status('업데이트 확인 중...')
  log(`Checking for updates... (hub: ${currentHubTag || '?'}, myhome: ${currentMyhomeTag || '?'})`)

  let release: GHRelease
  try {
    release = await fetch_latest_release(repo)
  } catch (err: unknown) {
    log(`Unable to reach ${repo} — cannot verify latest release: ${(err as Error).message}`)
    set_status('서버에 연결할 수 없습니다. 현재 버전을 실행합니다.')
    await new Promise<void>(r => setTimeout(r, 1500))
    launch(currentExe)
    return
  }

  const latestTag = release.tag_name
  if (!latestTag) {
    log(`Unable to reach ${repo} — cannot verify latest release`)
    set_status('최신 버전을 확인할 수 없습니다. 현재 버전을 실행합니다.')
    await new Promise<void>(r => setTimeout(r, 1500))
    launch(currentExe)
    return
  }
  log(`Latest: ${latestTag}`)

  const hubUpdated = await update_hub(release, settings)
  if (hubUpdated) return

  if (compare_versions(latestTag, currentMyhomeTag) > 0) {
    const newExeName = `myhome_${latestTag}.exe`
    const asset      = release.assets.find(a => a.name === newExeName)
    if (asset) {
      set_status(`My Home ${latestTag} 업데이트 중...`)
      const dest = join(BASE_DIR, newExeName)
      await download_file(asset.browser_download_url, dest)
      settings['hub.tag']        = latestTag
      settings['hub.app.myhome'] = newExeName
      write_settings(settings)
      log(`myhome updated to ${latestTag}`)
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

// ── app lifecycle ─────────────────────────────────────────────────────────────

ipcMain.on('ping', () => {})  // keep preload channel alive

app.whenReady().then(() => {
  win = create_window()
  // main() starts immediately — status messages are buffered until renderer loads
  main().catch((err: unknown) => {
    log(`Fatal: ${(err as Error).message}`)
    quit_app()
  })
})

app.on('window-all-closed', () => app.quit())
