import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import https from 'https'
import http from 'http'
import AdmZip from 'adm-zip'

export interface BinEntry {
  url: string
  exes?: string | string[]
  version: string
}

export type BinState = 'pending' | 'downloading' | 'extracting' | 'installed' | 'failed'

export interface BinStatusEntry {
  name: string
  state: BinState
  percent: number
}

interface BinsFile {
  'hub.bins'?: BinEntry[]
  [key: string]: unknown
}

export function bin_dests(bin: BinEntry): string[] {
  if (bin.exes) {
    const exes = Array.isArray(bin.exes) ? bin.exes : [bin.exes]
    return exes.map((exe) => `bin/${basename(exe)}`)
  }
  return [`bin/${basename(bin.url)}`]
}

export function read_bin_entries(settingsPath: string): BinEntry[] {
  try {
    const raw = JSON.parse(readFileSync(settingsPath, 'utf-8')) as BinsFile
    return raw['hub.bins'] ?? []
  } catch {
    return []
  }
}

export function installed_bins(baseDir: string, bins: BinEntry[]): Record<string, string> {
  const found: Record<string, string> = {}
  for (const bin of bins) {
    for (const dest of bin_dests(bin)) {
      const path = join(baseDir, dest)
      if (existsSync(path)) found[basename(dest)] = path
    }
  }
  return found
}

// 다운로드 시작 전 UI 에 보여줄 초기 목록 (이미 설치된 항목은 installed 로 표시).
export function list_bins(baseDir: string, settingsPath: string): BinStatusEntry[] {
  return read_bin_entries(settingsPath).map((bin) => {
    const dests = bin_dests(bin)
    const installed = dests.every((d) => existsSync(join(baseDir, d))) && Boolean(bin.version)
    return { name: basename(bin.url), state: installed ? 'installed' : 'pending', percent: installed ? 100 : 0 }
  })
}

function extract_version_from_url(url: string): string {
  const m = url.match(/\/releases\/download\/([^/]+)\//)
  return m ? m[1] : ''
}

function download_file(url: string, dest: string, onProgress?: (pct: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    let releaseUrl = ''
    const follow = (u: string): void => {
      if (!releaseUrl && u.includes('/releases/download/')) releaseUrl = u
      const mod = u.startsWith('https') ? https : http
      mod.get(u, { headers: { 'User-Agent': 'myhome' } }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          follow(res.headers.location!)
          return
        }
        const total = parseInt(res.headers['content-length'] ?? '0', 10)
        let received = 0
        const tmp = dest + '.tmp'
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

function write_bin_entries(settingsPath: string, bins: BinEntry[]): void {
  try {
    const raw = JSON.parse(readFileSync(settingsPath, 'utf-8')) as BinsFile
    raw['hub.bins'] = bins
    writeFileSync(settingsPath, JSON.stringify(raw, null, 2), 'utf-8')
  } catch {
    // settings.json missing/corrupt — skip persisting versions, next run reinstalls instead
  }
}

/**
 * Downloads/extracts any bin entries from settings.json's hub.bins that
 * aren't present on disk yet. Mirrors what familyhub used to do before
 * launching myhome — now myhome owns it so it works even if familyhub
 * is skipped or out of date. One bin failing doesn't stop the others.
 */
export async function ensure_bins(
  baseDir: string,
  settingsPath: string,
  on_status: (name: string, state: BinState) => void,
  on_progress: (name: string, percent: number) => void,
  on_log: (message: string) => void
): Promise<void> {
  const bins = read_bin_entries(settingsPath)
  let dirty = false
  let failed = false

  for (const bin of bins) {
    const dests = bin_dests(bin)
    const name = basename(bin.url)
    const isZip = bin.url.toLowerCase().endsWith('.zip')
    const exes = bin.exes ? (Array.isArray(bin.exes) ? bin.exes : [bin.exes]) : []

    const allPresent = dests.every((d) => existsSync(join(baseDir, d)))
    if (allPresent && bin.version) {
      on_log(`${dests[0]}: already installed (${bin.version})`)
      on_status(name, 'installed')
      continue
    }

    mkdirSync(join(baseDir, 'bin'), { recursive: true })

    const zipDestPath = join(baseDir, 'bin', basename(bin.url))
    try {
      let version = ''
      if (isZip) {
        let zip: AdmZip
        if (existsSync(zipDestPath)) {
          on_log(`${basename(bin.url)}: using cached zip`)
          zip = new AdmZip(zipDestPath)
          version = bin.version || 'unknown'
        } else {
          on_status(name, 'downloading')
          const finalUrl = await download_file(bin.url, zipDestPath, (pct) => on_progress(name, pct))
          version = extract_version_from_url(finalUrl)
          on_status(name, 'extracting')
          on_log(`Extracting ${basename(bin.url)}...`)
          zip = new AdmZip(zipDestPath)
        }
        for (let i = 0; i < exes.length; i++) {
          const entry = zip.getEntry(exes[i])
          if (!entry) throw new Error(`entry not found in zip: ${exes[i]}`)
          writeFileSync(join(baseDir, dests[i]), entry.getData())
          on_log(`${dests[i]}: extracted`)
        }
      } else {
        on_status(name, 'downloading')
        const finalUrl = await download_file(bin.url, join(baseDir, dests[0]), (pct) => on_progress(name, pct))
        version = extract_version_from_url(finalUrl)
      }
      bin.version = version || 'unknown'
      dirty = true
      on_status(name, 'installed')
      on_log(`${dests.join(', ')}: installed${version ? ' (' + version + ')' : ''}`)
    } catch (err) {
      for (const p of [zipDestPath, zipDestPath + '.tmp', ...dests.map((d) => join(baseDir, d) + '.tmp')]) {
        try { unlinkSync(p) } catch { /* ignore */ }
      }
      const message = err instanceof Error ? err.message : String(err)
      on_log(`${dests[0]}: FAILED — ${message}`)
      on_status(name, 'failed')
      failed = true
    }
  }

  if (dirty) write_bin_entries(settingsPath, bins)
  if (failed) throw new Error('Failed to install one or more tools — check the log.')
}
