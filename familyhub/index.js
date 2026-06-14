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
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  log_stream.write(line + '\n')
}

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
// (the final URL is often a CDN with no version info)
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

// extracts version tag from a GitHub release download URL
// e.g. https://github.com/foo/bar/releases/download/v1.2.3/file.exe → "v1.2.3"
function extract_version_from_url(url) {
  const m = url.match(/\/releases\/download\/([^/]+)\//)
  return m ? m[1] : ''
}

// derives version from myhome exe filename: "myhome_v0.0.5.exe" → "v0.0.5"
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

async function ensure_bins(bins, settings) {
  let dirty = false
  const zipCache = new Map()    // url → AdmZip
  const zipVersion = new Map()  // url → version string

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

    log(`${bin.dest}: installing...`)
    fs.mkdirSync(path.dirname(destPath), { recursive: true })

    const zipDestPath = path.join(BASE_DIR, 'bin', path.basename(bin.url))
    try {
      let version = ''
      if (bin.zip) {
        let zip = zipCache.get(bin.url)
        if (!zip) {
          const zipName = path.basename(bin.url)
          log(`Downloading ${zipName}...`)
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
        log(`Downloading ${path.basename(bin.url)}...`)
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

// hub.tag.myhome tracks last hub version processed.
// if hub needs update: download new hub, set hub.tag.myhome = latestTag, restart via bat.
// myhome version is derived separately from hub.app.myhome filename.
async function update_hub(release, settings) {
  if (!IS_PKG) return false

  const currentTag = settings['hub.tag.myhome'] || ''
  const latestTag = release.tag_name

  if (currentTag && compare_versions(latestTag, currentTag) <= 0) {
    log(`Hub: ${currentTag} (up to date)`)
    return false
  }

  log(`Hub update: ${currentTag || '?'} → ${latestTag}`)

  const zipName = `familyhub_${latestTag}.zip`
  const asset = release.assets.find(a => a.name === zipName)
  if (!asset) {
    log(`Hub: ${zipName} not found in release — skipping`)
    return false
  }

  const zipPath = path.join(BASE_DIR, zipName)
  log(`Downloading ${zipName}...`)
  await download_file(asset.browser_download_url, zipPath)

  const newExeName = `familyhub_${latestTag}.exe`
  const newExePath = path.join(BASE_DIR, newExeName)

  log('Extracting familyhub.exe from zip...')
  const zip = new AdmZip(zipPath)
  const entry = zip.getEntry('familyhub.exe')
  if (!entry) {
    fs.unlinkSync(zipPath)
    log('Hub: familyhub.exe not found in zip — skipping')
    return false
  }
  fs.writeFileSync(newExePath, entry.getData())
  fs.unlinkSync(zipPath)

  // mark hub as updated; myhome version is tracked via hub.app.myhome filename
  settings['hub.tag.myhome'] = latestTag
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
  spawn('cmd.exe', ['/c', batPath], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  log_stream.end()
  process.exit(0)
}

async function main() {
  log('FamilyHub start')

  const settings = read_settings()
  const repo = settings['hub.repo']
  const currentExe = settings['hub.app.myhome']

  // launch myhome immediately — don't wait for update checks
  if (currentExe) {
    const exePath = path.join(BASE_DIR, currentExe)
    if (fs.existsSync(exePath)) {
      log(`Launching ${currentExe}...`)
      spawn(exePath, [], { detached: true, stdio: 'ignore' }).unref()
    } else {
      log(`Not found: ${exePath}`)
    }
  }

  // background: ensure bins
  const bins = settings['hub.bins'] ?? []
  await ensure_bins(bins, settings)

  // background: check for updates
  const currentHubTag = settings['hub.tag.myhome'] || ''
  const currentMyhomeTag = derive_myhome_version(currentExe)
  log(`Checking for updates... (hub: ${currentHubTag || '?'}, myhome: ${currentMyhomeTag || '?'})`)

  let release
  try {
    release = await fetch_latest_release(repo)
  } catch (err) {
    log(`Update check FAILED: ${err.message}`)
    log_stream.end()
    process.exit(0)
    return
  }

  const latestTag = release.tag_name
  if (!latestTag) {
    log('Update check FAILED: could not read latest tag from release')
    log_stream.end()
    process.exit(0)
    return
  }
  log(`Latest: ${latestTag}`)

  await update_hub(release, settings)
  // update_hub exits the process if hub was updated

  if (compare_versions(latestTag, currentMyhomeTag) > 0) {
    const newExeName = `myhome_${latestTag}.exe`
    const asset = release.assets.find(a => a.name === newExeName)
    if (asset) {
      log(`Downloading myhome ${latestTag}...`)
      const dest = path.join(BASE_DIR, newExeName)
      await download_file(asset.browser_download_url, dest)
      settings['hub.tag.myhome'] = latestTag
      settings['hub.app.myhome'] = newExeName
      write_settings(settings)
      log(`myhome ${latestTag} 다운로드 완료 — 다음 실행 시 새 버전으로 시작합니다.`)
    } else {
      log(`Update check FAILED: asset ${newExeName} not found in release`)
    }
  } else {
    log('myhome up to date.')
  }

  log_stream.end()
  process.exit(0)
}

main().catch(err => {
  log(`Fatal: ${err.message}`)
  log_stream.end()
  process.exit(1)
})
