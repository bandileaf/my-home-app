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

function parse_settings_text(text: string): Settings {
  // Strip // and /* */ comments (JSONC format), respecting string literals
  let out = ''
  let i = 0
  while (i < text.length) {
    if (text[i] === '"') {
      out += text[i++]
      while (i < text.length) {
        if (text[i] === '\\') { out += text[i] + text[i + 1]; i += 2 }
        else if (text[i] === '"') { out += text[i++]; break }
        else { out += text[i++] }
      }
    } else if (text[i] === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (text[i] === '/' && text[i + 1] === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
    } else {
      out += text[i++]
    }
  }
  // Remove trailing commas before } or ] (JSONC allows them, JSON.parse does not)
  out = out.replace(/,(\s*[}\]])/g, '$1')
  return JSON.parse(out) as Settings
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
): string[] {
  const log = join(tmpDir, 'update.log')
  const L = (msg: string) => `echo [%DATE% %TIME%] ${msg} >> "${log}"`

  // ping -n N 127.0.0.1 waits N-1 seconds — works in hidden CMD unlike timeout
  const wait = (sec: number, label: string) => [
    L(`wait:${label} start (expected ${sec}s)`),
    `ping -n ${sec + 1} 127.0.0.1 >nul`,
    L(`wait:${label} end`),
  ].join('\r\n')

  const lines: string[] = [
    '@echo off',
    `echo [%DATE% %TIME%] === update.bat START === > "${log}"`,
    `echo [%DATE% %TIME%] bat=%~f0 baseDir="${baseDir}" >> "${log}"`,
    `echo [%DATE% %TIME%] tmpDir="${tmpDir}" >> "${log}"`,
    `echo [%DATE% %TIME%] apps="${appNames.join(', ')}" >> "${log}"`,
    `echo [%DATE% %TIME%] cd=%CD% >> "${log}"`,
  ]

  // Check was_running FIRST before any wait (apps still alive at this point)
  for (let i = 0; i < appNames.length; i++) {
    lines.push(L(`step: check running ${appNames[i]}`))
    lines.push(`set WAS_RUNNING_${i}=0`)
    lines.push(`tasklist /FI "IMAGENAME eq ${appNames[i]}" 2>nul | find /I "${appNames[i]}" >nul`)
    lines.push(`if not errorlevel 1 set WAS_RUNNING_${i}=1`)
    lines.push(L(`${appNames[i]} was_running=%WAS_RUNNING_${i}%`))
  }

  // Wait for app to quit naturally (app calls app.quit() after 1.8s)
  lines.push(L('step: waiting 3s for apps to exit naturally'))
  lines.push(wait(3, 'natural-exit'))

  // Taskkill as insurance in case app didn't exit
  for (const name of appNames) {
    lines.push(L(`step: taskkill ${name}`))
    lines.push(`taskkill /F /IM ${name} >nul 2>&1`)
    lines.push(L(`taskkill ${name} errorlevel=%ERRORLEVEL%`))
  }

  lines.push(L('step: waiting 1s after taskkill'))
  lines.push(wait(1, 'post-kill'))

  // Move new exe — backup old to .bak first, restore on failure
  for (const name of appNames) {
    const src  = join(tmpDir, name)
    const dest = join(baseDir, name)
    const bak  = dest + '.bak'
    lines.push(L(`step: move ${name}`))
    lines.push(`if exist "${src}" ${L(`src exists: ${src}`)}`)
    lines.push(`if not exist "${src}" ${L(`src MISSING: ${src}`)}`)
    // Backup old exe so it can be restored if the new one fails
    lines.push(`if exist "${dest}" del /F /Q "${bak}" >nul 2>&1`)
    lines.push(`if exist "${dest}" move /Y "${dest}" "${bak}" >nul 2>&1`)
    lines.push(L(`backup ${name} errorlevel=%ERRORLEVEL%`))
    // Move new exe into place
    lines.push(`move /Y "${src}" "${dest}" >nul 2>&1`)
    lines.push(L(`move ${name} errorlevel=%ERRORLEVEL%`))
    // If move failed, restore from backup
    lines.push(`if not exist "${dest}" if exist "${bak}" move /Y "${bak}" "${dest}" >nul 2>&1`)
    lines.push(`if not exist "${dest}" if exist "${bak}" ${L(`RESTORED ${name} from backup`)}`)
    lines.push(`if exist "${dest}" ${L(`dest ok: ${dest}`)}`)
    lines.push(`if not exist "${dest}" ${L(`dest MISSING after move: ${dest}`)}`)
  }

  // Relaunch only apps that were running before the update
  // --post-update flag tells the app to skip single-instance lock check
  for (let i = 0; i < appNames.length; i++) {
    const finalExe = join(baseDir, appNames[i])
    lines.push(L(`step: relaunch check ${appNames[i]} was_running=%WAS_RUNNING_${i}%`))
    lines.push(`if %WAS_RUNNING_${i}%==1 if exist "${finalExe}" ${L(`starting ${appNames[i]}`)}`)
    lines.push(`if %WAS_RUNNING_${i}%==1 if exist "${finalExe}" start "" "${finalExe}" --post-update`)
    lines.push(`if %WAS_RUNNING_${i}%==0 ${L(`skip relaunch ${appNames[i]} (was not running)`)}`)
  }

  // Final result: SUCCESS if all dest files exist, FAILED otherwise
  lines.push('set UPDATE_OK=1')
  for (const name of appNames) {
    const dest = join(baseDir, name)
    lines.push(`if not exist "${dest}" set UPDATE_OK=0`)
  }
  lines.push(`if %UPDATE_OK%==1 ${L('=== RESULT: SUCCESS ===')}`)
  lines.push(`if %UPDATE_OK%==0 ${L('=== RESULT: FAILED — one or more files missing ===')}`)
  lines.push(L('=== update.bat DONE ==='))
  lines.push('(goto) 2>nul & del "%~f0"')
  writeFileSync(batPath, lines.join('\r\n'), 'ascii')
  return lines
}

export async function run_update_check(
  config: UpdateConfig,
  cb: UpdateCallbacks
): Promise<void> {
  let settings: Settings
  try {
    settings = parse_settings_text(readFileSync(config.settingsPath, 'utf8'))
  } catch (err: unknown) {
    cb.log(`update: ${config.settingsPath} — ${(err as Error).message}`)
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

  if (!repo)    { cb.log('update: hub.repo not set in settings'); return }
  if (!zipName) { cb.log('update: hub.zip not set in settings'); return }
  if (!batName) { cb.log('update: hub.update-bat not set in settings'); return }
  if (autoUpdate === false) { cb.log('update: auto-update disabled (hub.auto-update=false)'); return }

  const ua = repo.split('/')[1] ?? repo

  cb.log(`update: checking ${repo} — local=${localTag ?? 'none'}`)
  cb.log(`update: GET api.github.com/repos/${repo}/releases/latest`)

  let release: GHRelease
  try {
    release = await fetch_latest_release(repo)
  } catch (err: unknown) {
    cb.log(`update: GitHub API error — ${(err as Error).message}`)
    return
  }

  const latestTag = release.tag_name
  if (!latestTag) { cb.log('update: release has no tag_name'); return }
  cb.log(`update: fetched tag=${latestTag} assets=[${release.assets.map(a => a.name).join(', ')}]`)

  if (localTag === latestTag) {
    cb.log(`update: already on ${localTag}`)
    return
  }

  cb.log(`update: ${localTag ?? 'none'} → ${latestTag}`)
  cb.set_status(`새로운 버전이 발견되었습니다 (${localTag ?? '?'} → ${latestTag})`)

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
    cb.set_status('다른 앱이 업데이트를 진행 중입니다. 완료될 때까지 대기합니다...')
    cb.log('update: another process holds lock, waiting...')
    await new Promise(r => setTimeout(r, 3000))
  }

  cb.log('update: lock acquired, proceeding')

  try {
    // Re-check tag after acquiring lock in case another process already updated
    try {
      const fresh = parse_settings_text(readFileSync(config.settingsPath, 'utf8'))
      if ((fresh['hub.tag'] as string | undefined) === latestTag) {
        cb.log(`update: already on ${latestTag} (another process updated while waiting)`)
        return
      }
    } catch { /* ignore */ }

    const asset = release.assets.find(a => a.name === zipName)
    if (!asset) {
      cb.log(`update: ${zipName} not found in release assets`)
      cb.on_error(`업데이트 파일을 찾을 수 없습니다: ${zipName}`)
      return
    }

    cb.set_status('업데이트 파일을 다운로드하고 있습니다...')
    const zipPath = join(tmpDir, zipName)

    try {
      await download_file(asset.browser_download_url, zipPath, ua, cb.set_progress)
      cb.log(`update: download complete — ${zipName}`)
    } catch (err: unknown) {
      cb.log(`update: download failed — ${(err as Error).message}`)
      cb.on_error('다운로드에 실패했습니다. 인터넷 연결을 확인해 주세요.')
      return
    }

    cb.set_status('다운로드 완료. 압축을 해제하고 있습니다...')
    try {
      extract_zip(zipPath, tmpDir)
      cb.log(`update: extracted to ${tmpDir}`)
      unblock_files(appNames.map(name => join(tmpDir, name)))
      cb.log(`update: unblocked ${appNames.join(', ')}`)
    } catch (err: unknown) {
      cb.log(`update: extraction failed — ${(err as Error).message}`)
      cb.on_error('압축 해제에 실패했습니다.')
      return
    }

    try {
      const current = parse_settings_text(readFileSync(config.settingsPath, 'utf8'))
      current['hub.tag'] = latestTag
      writeFileSync(config.settingsPath, JSON.stringify(current, null, 2), 'utf8')
      cb.log(`update: hub.tag saved as ${latestTag}`)
    } catch { /* non-fatal */ }

    const batPath = join(config.baseDir, batName)
    const batLines = write_bat(batPath, config.baseDir, tmpDir, appNames)
    cb.log(`update: bat written to ${batPath} (${batLines.length} lines)`)
    batLines.forEach((line, i) => cb.log(`  bat[${String(i).padStart(2, '0')}]: ${line}`))

    // Release lock before the bat kills this process
    try { unlinkSync(lockPath) } catch { /* ignore */ }

    cb.set_status(`새 버전(${latestTag})으로 교체 중입니다. 잠시 후 재시작됩니다...`)
    cb.log(`update: spawning bat via PowerShell Start-Process (Job Object escape)`)
    // Wrap in PowerShell Start-Process so the CMD process is independent of Electron's Job Object.
    // Direct spawn('cmd.exe') inherits Electron's Job Object and gets killed when Electron exits.
    const q = batPath.replace(/'/g, "''")
    const child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
      '-Command', `Start-Process cmd.exe -ArgumentList '/C "${q}"' -WindowStyle Hidden`,
    ], { stdio: 'ignore', windowsHide: true })
    cb.log(`update: launcher pid=${child.pid ?? 'unknown'}`)
    child.unref()

    await new Promise<void>(r => setTimeout(r, 1800))
    cb.on_quit()

  } finally {
    // Cleanup lock on any error path
    try { if (existsSync(lockPath)) unlinkSync(lockPath) } catch { /* ignore */ }
  }
}
