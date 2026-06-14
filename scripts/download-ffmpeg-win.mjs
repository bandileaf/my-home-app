// build:win 실행 전 Windows용 ffmpeg.exe 를 build/ 에 내려받는다.
// ffmpeg-static 과 동일한 릴리즈 태그에서 win32-x64 바이너리를 가져온다.
import { createWriteStream, existsSync, mkdirSync } from 'fs'
import https from 'https'
import { dirname, join } from 'path'
import { createRequire } from 'module'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, 'build', 'ffmpeg.exe')

if (existsSync(dest)) {
  console.log('ffmpeg.exe already present:', dest)
  process.exit(0)
}

// ffmpeg-static 과 동일한 릴리즈 버전 사용
const require = createRequire(import.meta.url)
const tag = require('../node_modules/ffmpeg-static/package.json')['ffmpeg-static']['binary-release-tag']
const SRC = `https://github.com/eugeneware/ffmpeg-static/releases/download/${tag}/ffmpeg-win32-x64`

mkdirSync(join(root, 'build'), { recursive: true })
console.log(`Downloading ffmpeg.exe (${tag}) for Windows...`)

function follow(url, hops = 10) {
  if (hops === 0) { console.error('Too many redirects'); process.exit(1) }
  https.get(url, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume()
      follow(res.headers.location, hops - 1)
      return
    }
    if (res.statusCode !== 200) {
      console.error('HTTP', res.statusCode, 'from', url)
      process.exit(1)
    }
    const out = createWriteStream(dest)
    res.pipe(out)
    out.on('finish', () => console.log('Saved to', dest))
    out.on('error', (e) => { console.error(e.message); process.exit(1) })
  }).on('error', (e) => { console.error(e.message); process.exit(1) })
}

follow(SRC)
