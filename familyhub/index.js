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

function download_file(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (u) => {
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
            resolve()
          })
        })
        res.on('error', reject)
      }).on('error', reject)
    }
    follow(url)
  })
}

function compare_versions(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
  }
  return 0
}

function launch(exeName) {
  const exePath = path.join(BASE_DIR, exeName)
  if (!fs.existsSync(exePath)) {
    log(`Not found: ${exePath}`)
    log_stream.end()
    process.exit(1)
  }
  log(`Launching ${exeName}...`)
  log_stream.end()
  spawn(exePath, [], { detached: true, stdio: 'ignore' }).unref()
  process.exit(0)
}

function extract_github_repo(url) {
  const m = url.match(/github\.com\/([^/]+\/[^/]+)\/releases\//)
  return m ? m[1] : null
}

async function ensure_bins(bins, settings) {
  let dirty = false
  const zipCache = new Map()

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

    let version = ''
    const repo = extract_github_repo(bin.url)
    if (repo) {
      try {
        const release = await fetch_latest_release(repo)
        version = release.tag_name ?? ''
      } catch (err) {
        log(`${bin.dest}: version check failed (${err.message})`)
      }
    }

    const zipDestPath = path.join(BASE_DIR, 'bin', path.basename(bin.url))
    try {
      if (bin.zip) {
        let zip = zipCache.get(bin.url)
        if (!zip) {
          const zipName = path.basename(bin.url)
          log(`Downloading ${zipName}...`)
          await download_file(bin.url, zipDestPath)
          log(`Extracting from ${zipName}...`)
          zip = new AdmZip(zipDestPath)
          zipCache.set(bin.url, zip)
          fs.unlinkSync(zipDestPath)
        }
        const entry = zip.getEntry(bin.zip)
        if (!entry) throw new Error(`entry not found in zip: ${bin.zip}`)
        fs.writeFileSync(destPath, entry.getData())
      } else {
        log(`Downloading ${path.basename(bin.url)}...`)
        await download_file(bin.url, destPath)
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

async function main() {
  log('FamilyHub start')

  const settings = read_settings()
  const repo = settings['hub.repo']
  const currentTag = settings['hub.tag.myhome']
  const currentExe = settings['hub.app.myhome']

  const bins = settings['hub.bins'] ?? []
  await ensure_bins(bins, settings)

  log(`Checking for updates... (current: ${currentTag})`)

  let release
  try {
    release = await fetch_latest_release(repo)
  } catch (err) {
    log(`Update check failed: ${err.message} — launching current version`)
    launch(currentExe)
    return
  }

  const latestTag = release.tag_name
  log(`Latest: ${latestTag}`)

  if (compare_versions(latestTag, currentTag) > 0) {
    const newExeName = `myhome_${latestTag}.exe`
    const asset = release.assets.find(a => a.name === newExeName)

    if (asset) {
      log(`Updating ${currentTag} → ${latestTag}...`)
      const dest = path.join(BASE_DIR, newExeName)
      await download_file(asset.browser_download_url, dest)
      settings['hub.tag.myhome'] = latestTag
      settings['hub.app.myhome'] = newExeName
      write_settings(settings)
      log('Update complete.')
      launch(newExeName)
    } else {
      log(`Asset ${newExeName} not found in release — launching current version`)
      launch(currentExe)
    }
  } else {
    log('Already up to date.')
    launch(currentExe)
  }
}

main().catch(err => {
  log(`Fatal: ${err.message}`)
  try {
    const settings = read_settings()
    launch(settings['hub.app.myhome'])
  } catch {
    log_stream.end()
    process.exit(1)
  }
})
