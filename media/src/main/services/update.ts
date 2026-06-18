import https from 'https'
import http from 'http'
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { spawn } from 'child_process'

interface GHRelease {
  tag_name: string
  assets: Array<{ name: string; browser_download_url: string }>
}

interface RemoteSettings {
  [key: string]: unknown
}

export interface UpdateConfig {
  baseDir: string
  settingsPath: string
  versionKey: string   // 'hub.app.media.version'
  exeName: string      // 'family_media.exe'
  processName: string  // 'family_media'
}

export interface UpdateCallbacks {
  set_status: (msg: string) => void
  set_progress: (pct: number) => void
  on_error: (msg: string) => void
  on_quit: () => void
  log: (msg: string) => void
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
    req.setTimeout(10000, () => req.destroy(new Error('GitHub API timed out')))
  })
}

function download_file(
  url: string,
  dest: string,
  onProgress?: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const follow = (u: string): void => {
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
            resolve()
          })
        })
        res.on('error', reject)
      }).on('error', reject)
    }
    follow(url)
  })
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

function schedule_replace(nextPath: string, finalPath: string, processName: string): void {
  const dir     = join(nextPath, '..')
  const ps1Path = join(dir, '_self_update.ps1')
  const q = (p: string) => `'${p.replace(/'/g, "''")}'`
  writeFileSync(ps1Path, [
    'Start-Sleep -Seconds 1',
    `Stop-Process -Name ${q(processName)} -Force -ErrorAction SilentlyContinue`,
    'Start-Sleep -Milliseconds 500',
    `if (Test-Path ${q(finalPath)}) { Remove-Item -Force ${q(finalPath)} }`,
    `Rename-Item -Path ${q(nextPath)} -NewName ${q(basename(finalPath))}`,
    `Start-Process ${q(finalPath)}`,
    `Remove-Item -Force $MyInvocation.MyCommand.Path`,
  ].join('\n'), 'utf8')

  spawn('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
    '-ExecutionPolicy', 'Bypass', '-File', ps1Path
  ], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
}

export async function run_update_check(
  config: UpdateConfig,
  cb: UpdateCallbacks
): Promise<void> {
  let settings: RemoteSettings
  try {
    settings = JSON.parse(readFileSync(config.settingsPath, 'utf8')) as RemoteSettings
  } catch {
    cb.log('update: could not read settings.json — skipping')
    return
  }

  const repo = settings['hub.repo'] as string | undefined
  const autoUpdate = settings['hub.auto-update'] as boolean | undefined
  const currentVersion = settings[config.versionKey] as string | undefined

  if (!repo) { cb.log('update: hub.repo not set — skipping'); return }
  if (autoUpdate === false) { cb.log('update: hub.auto-update is false — skipping'); return }

  cb.log(`update: checking ${repo} (current ${config.versionKey}=${currentVersion ?? '?'})`)

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

  const tmpDir = join(config.baseDir, 'tmp')
  mkdirSync(tmpDir, { recursive: true })

  let remote: RemoteSettings
  try {
    const settingsAsset = release.assets.find(a => a.name === 'settings.json')
    if (!settingsAsset) { cb.log('update: settings.json not in release'); return }
    const tmpSettings = join(tmpDir, 'settings_remote.json')
    await download_file(settingsAsset.browser_download_url, tmpSettings)
    remote = JSON.parse(readFileSync(tmpSettings, 'utf8')) as RemoteSettings
  } catch (err: unknown) {
    cb.log(`update: failed to fetch remote settings — ${(err as Error).message}`)
    return
  }

  const remoteVersion = remote[config.versionKey] as string | undefined
  if (!remoteVersion) { cb.log(`update: ${config.versionKey} missing in remote settings`); return }

  if (compare_versions(remoteVersion, currentVersion ?? '0') <= 0) {
    cb.log(`update: already up to date (${currentVersion})`)
    return
  }

  cb.log(`update: newer version found ${currentVersion} → ${remoteVersion}`)
  cb.set_status(`${config.exeName} ${remoteVersion} 다운로드 중...`)

  const asset = release.assets.find(a => a.name === config.exeName)
  if (!asset) {
    cb.log(`update: asset ${config.exeName} not found in release`)
    cb.on_error(`업데이트 파일을 찾을 수 없습니다: ${config.exeName}`)
    return
  }

  const nextPath  = join(config.baseDir, config.exeName.replace('.exe', '_next.exe'))
  const finalPath = join(config.baseDir, config.exeName)

  try {
    await download_file(asset.browser_download_url, nextPath, cb.set_progress)
    cb.log(`update: downloaded → ${basename(nextPath)}`)
  } catch (err: unknown) {
    cb.log(`update: download failed — ${(err as Error).message}`)
    cb.on_error('다운로드 실패.')
    return
  }

  // write updated version back to settings.json
  try {
    const current = JSON.parse(readFileSync(config.settingsPath, 'utf8')) as RemoteSettings
    current[config.versionKey] = remoteVersion
    writeFileSync(config.settingsPath, JSON.stringify(current, null, 2), 'utf8')
  } catch { /* non-fatal */ }

  cb.set_status(`${remoteVersion} 교체 중... 잠시 후 재시작됩니다.`)
  schedule_replace(nextPath, finalPath, config.processName)

  await new Promise<void>(r => setTimeout(r, 1800))
  cb.on_quit()
}
