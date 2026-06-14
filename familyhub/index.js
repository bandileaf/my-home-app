const https = require('https')
const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const REPO = 'bandileaf/my-home-app'
const APP_EXE = 'FamilyHub.exe'
const VERSION_FILE = path.join(path.dirname(process.execPath), 'version.txt')
const APP_PATH = path.join(path.dirname(process.execPath), APP_EXE)

function read_local_version() {
  try {
    return fs.readFileSync(VERSION_FILE, 'utf8').trim()
  } catch {
    return '0.0.0'
  }
}

function fetch_latest_release() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${REPO}/releases/latest`,
      headers: { 'User-Agent': 'FamilyHub-Launcher' }
    }
    https.get(options, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch {
          reject(new Error('Failed to parse release info'))
        }
      })
    }).on('error', reject)
  })
}

function download_file(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = (u) => {
      const mod = u.startsWith('https') ? https : http
      mod.get(u, { headers: { 'User-Agent': 'FamilyHub-Launcher' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          follow(res.headers.location)
          return
        }
        const total = parseInt(res.headers['content-length'] || '0')
        let received = 0
        const tmp = dest + '.tmp'
        const file = fs.createWriteStream(tmp)
        res.on('data', chunk => {
          received += chunk.length
          file.write(chunk)
          if (total > 0) {
            const pct = Math.round(received / total * 100)
            process.stdout.write(`\rDownloading... ${pct}%`)
          }
        })
        res.on('end', () => {
          file.end()
          process.stdout.write('\n')
          fs.renameSync(tmp, dest)
          resolve()
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

async function main() {
  console.log('FamilyHub Launcher')

  const local = read_local_version()
  console.log(`Current version: ${local}`)

  let release
  try {
    release = await fetch_latest_release()
  } catch {
    console.log('Could not check for updates. Starting app...')
    launch_app()
    return
  }

  const remote = release.tag_name
  console.log(`Latest version:  ${remote}`)

  if (compare_versions(remote, local) > 0) {
    const asset = release.assets.find(a => a.name === APP_EXE)
    if (asset) {
      console.log(`Updating to ${remote}...`)
      await download_file(asset.browser_download_url, APP_PATH)
      fs.writeFileSync(VERSION_FILE, remote, 'utf8')
      console.log('Update complete.')
    }
  } else {
    console.log('Already up to date.')
  }

  launch_app()
}

function launch_app() {
  if (!fs.existsSync(APP_PATH)) {
    console.error(`${APP_EXE} not found.`)
    process.exit(1)
  }
  spawn(APP_PATH, [], { detached: true, stdio: 'ignore' }).unref()
  process.exit(0)
}

main().catch(err => {
  console.error('Error:', err.message)
  launch_app()
})
