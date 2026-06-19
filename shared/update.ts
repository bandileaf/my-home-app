import https from 'https'
import http from 'http'
import {
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'fs'
import { join } from 'path'
import { execFileSync, spawn } from 'child_process'

interface GHRelease {
  tag_name: string
  assets: Array<{ name: string; browser_download_url: string }>
}

interface Settings {
  [key: string]: unknown
}

export interface UpdateConfig {
  baseDir: string
  settingsPath: string
  appKey: string  // 'media' | 'bulletin' — reads hub.app.<appKey>.name
}

export interface UpdateCallbacks {
  set_status: (msg: string) => void
  set_progress: (pct: number) => void
  on_error: (msg: string) => void
  on_quit: () => void
  log: (msg: string) => void
}

const LOCK_TIMEOUT_MS = 2 * 60 * 1000

function fetch_latest_release(repo: string): Promise<GHRelease> {
  const ua = repo.split('/')[1] ?? repo
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: 'api.github.com',
        path: `/repos/${repo}/releases/latest`,
        headers: { 'User-Agent': ua },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk: Buffer) => { data += chunk })
        res.on('end', () => {
          try { resolve(JSON.parse(data) as GHRelease) }
          catch { reject(new Error('Failed to parse release info')) }
        })
      }
    ).on('error', reject)
    req.setTimeout(10000, () => req.destroy(new Error('GitHub API timed out')))
  })
}

function download_file(
  url: string,
  dest: string,
  ua: string,
  onProgress?: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (u: string): void => {
      const mod = u.startsWith('https') ? https : http
      mod.get(u, { headers: { 'User-Agent': ua } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return follow(res.headers.location!)
        }
        const total   = parseInt(res.headers['content-length'] ?? '0', 10)
        let received  = 0
        const tmp     = dest + '.tmp'
        const file    = createWriteStream(tmp)
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
            resolve()
          })
        })
        res.on('error', reject)
      }).on('error', reject)
    }
    follow(url)
  })
}

function extract_zip(zipPath: string, destDir: string): void {
  const q = (p: string) => p.replace(/'/g, "''")
  execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
    '-Command',
    `Expand-Archive -LiteralPath '${q(zipPath)}' -DestinationPath '${q(destDir)}' -Force`,
  ], { windowsHide: true, timeout: 120000 })
}

function unblock_files(filePaths: string[]): void {
  const q = (p: string) => p.replace(/'/g, "''")
  const cmd = filePaths.map(p => `Unblock-File -LiteralPath '${q(p)}'`).join('; ')
  try {
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
      '-Command', cmd,
    ], { windowsHide: true, timeout: 30000 })
  } catch { /* non-fatal: SmartScreen may still appear but app still runs */ }
}

function try_acquire_lock(lockPath: string): boolean {
  try {
    const fd = openSync(lockPath, 'wx')
    writeSync(fd, String(Date.now()))
    closeSync(fd)
    return true
  } catch {
    return false
  }
}

function write_bat(
  batPath: string,
  baseDir: string,
  tmpDir: string,
  appNames: string[]
): void {
  const lines: string[] = ['@echo off', 'timeout /t 1 /nobreak >nul']

  for (const name of appNames) {
    lines.push(`taskkill /F /IM ${name} >nul 2>&1`)
  }
  lines.push('timeout /t 1 /nobreak >nul')

  for (const name of appNames) {
    const src  = join(tmpDir, name)
    const dest = join(baseDir, name)
    lines.push(`if exist "${src}" move /Y "${src}" "${dest}"`)
  }

  for (const name of appNames) {
    const finalExe = join(baseDir, name)
    lines.push(`if exist "${finalExe}" start "" "${finalExe}"`)
  }

  lines.push('(goto) 2>nul & del "%~f0"')
  writeFileSync(batPath, lines.join('\r\n'), 'ascii')
}

export async function run_update_check(
  config: UpdateConfig,
  cb: UpdateCallbacks
): Promise<void> {
  let settings: Settings
  try {
    settings = JSON.parse(readFileSync(config.settingsPath, 'utf8')) as Settings
  } catch {
    cb.log('update: could not read settings.json — skipping')
    return
  }

  const repo       = settings['hub.repo']       as string | undefined
  const autoUpdate = settings['hub.auto-update'] as boolean | undefined
  const localTag   = settings['hub.tag']         as string | undefined
  const zipName    = settings['hub.zip']         as string | undefined
  const batName    = settings['hub.update-bat']  as string | undefined
  const appNames   = Object.keys(settings)
    .filter(k => /^hub\.app\.[^.]+\.name$/.test(k))
    .map(k => settings[k] as string)
    .filter(Boolean)

  if (!repo)    { cb.log('update: hub.repo not set — skipping'); return }
  if (!zipName) { cb.log('update: hub.zip not set — skipping'); return }
  if (!batName) { cb.log('update: hub.update-bat not set — skipping'); return }
  if (autoUpdate === false) { cb.log('update: hub.auto-update is false — skipping'); return }

  const ua = repo.split('/')[1] ?? repo

  cb.log(`update: checking ${repo} (hub.tag=${localTag ?? 'none'})`)

  let release: GHRelease
  try {
    release = await fetch_latest_release(repo)
  } catch (err: unknown) {
    cb.log(`update: GitHub API failed — ${(err as Error).message}`)
    return
  }

  const latestTag = release.tag_name
  if (!latestTag) { cb.log('update: no tag_name in release'); return }
  cb.log(`update: latest tag=${latestTag}`)

  if (localTag === latestTag) {
    cb.log(`update: already up to date (${localTag})`)
    return
  }

  cb.log(`update: new release ${localTag ?? 'none'} → ${latestTag}`)

  const tmpDir   = join(config.baseDir, 'tmp')
  mkdirSync(tmpDir, { recursive: true })
  const lockPath = join(tmpDir, '.update.lock')

  // Wait until lock is free, then acquire it
  const waitStart = Date.now()
  while (!try_acquire_lock(lockPath)) {
    if (Date.now() - waitStart > LOCK_TIMEOUT_MS) {
      cb.on_error(
        '업데이트가 응답하지 않습니다.\n' +
        'tmp\\.update.lock 파일을 삭제하고 앱을 다시 시작하세요.'
      )
      return
    }
    cb.set_status('다른 앱이 업데이트 중입니다. 완료될 때까지 기다리고 있습니다...')
    cb.log('update: waiting for lock...')
    await new Promise(r => setTimeout(r, 3000))
  }

  cb.log('update: lock acquired')

  try {
    // Re-check tag after acquiring lock in case another process already updated
    try {
      const fresh = JSON.parse(readFileSync(config.settingsPath, 'utf8')) as Settings
      if ((fresh['hub.tag'] as string | undefined) === latestTag) {
        cb.log('update: already up to date (updated while waiting)')
        return
      }
    } catch { /* ignore */ }

    const asset = release.assets.find(a => a.name === zipName)
    if (!asset) {
      cb.log(`update: asset ${zipName} not found in release`)
      cb.on_error(`업데이트 파일을 찾을 수 없습니다: ${zipName}`)
      return
    }

    cb.set_status(`${zipName} 다운로드 중...`)
    const zipPath = join(tmpDir, zipName)

    try {
      await download_file(asset.browser_download_url, zipPath, ua, cb.set_progress)
      cb.log(`update: downloaded ${zipName}`)
    } catch (err: unknown) {
      cb.log(`update: download failed — ${(err as Error).message}`)
      cb.on_error('다운로드 실패.')
      return
    }

    cb.set_status('압축 해제 중...')
    try {
      extract_zip(zipPath, tmpDir)
      cb.log(`update: extracted to ${tmpDir}`)
      unblock_files(appNames.map(name => join(tmpDir, name)))
      cb.log('update: unblocked extracted files')
    } catch (err: unknown) {
      cb.log(`update: extraction failed — ${(err as Error).message}`)
      cb.on_error('압축 해제 실패.')
      return
    }

    // Write updated hub.tag before bat runs
    try {
      const current = JSON.parse(readFileSync(config.settingsPath, 'utf8')) as Settings
      current['hub.tag'] = latestTag
      writeFileSync(config.settingsPath, JSON.stringify(current, null, 2), 'utf8')
      cb.log(`update: hub.tag updated to ${latestTag}`)
    } catch { /* non-fatal */ }

    const batPath = join(config.baseDir, batName)
    write_bat(batPath, config.baseDir, tmpDir, appNames)
    cb.log(`update: wrote ${batName}`)

    // Release lock before the bat kills this process
    try { unlinkSync(lockPath) } catch { /* ignore */ }

    cb.set_status(`${latestTag} 교체 중... 잠시 후 재시작됩니다.`)
    spawn('cmd.exe', ['/C', batPath], {
      detached: true, stdio: 'ignore', windowsHide: true,
    }).unref()

    await new Promise<void>(r => setTimeout(r, 1800))
    cb.on_quit()

  } finally {
    // Cleanup lock on any error path
    try { if (existsSync(lockPath)) unlinkSync(lockPath) } catch { /* ignore */ }
  }
}
