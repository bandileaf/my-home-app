import { mkdirSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import type { Innertube as InnertubeType } from 'youtubei.js'

// youtubei.js is ESM-only; use new Function to prevent Rollup from converting
// import() to require() in CJS output, allowing Node.js to load it as ESM.
async function load_innertube(): Promise<{ Innertube: typeof InnertubeType }> {
  return (new Function('return import("youtubei.js")')()) as Promise<{
    Innertube: typeof InnertubeType
  }>
}

export interface YoutubeResult {
  id: string
  url: string
  title: string
  duration: number // seconds (0 = live/unknown)
  channel: string
  thumbnail: string
  viewCount?: number
}

export interface YoutubeProgress {
  url: string
  percent: number
  speed: string
  eta: string
}

// ── Innertube singleton (검색 전용) ──────────────────────────────────────────

let _yt: InnertubeType | null = null

async function get_yt(): Promise<InnertubeType> {
  if (!_yt) {
    const { Innertube } = await load_innertube()
    _yt = await Innertube.create()
  }
  return _yt
}

// ── 검색 ────────────────────────────────────────────────────────────────────

export async function youtube_search(query: string, limit = 10): Promise<YoutubeResult[]> {
  const yt = await get_yt()
  const res = await yt.search(query, { type: 'video' })
  const out: YoutubeResult[] = []
  for (const item of res.results ?? []) {
    if (out.length >= limit) break
    const v = item as unknown as Record<string, unknown>
    const id = String(v['id'] ?? '')
    if (!id) continue
    out.push({
      id,
      url: `https://www.youtube.com/watch?v=${id}`,
      title: String(v['title'] ?? '(no title)'),
      duration: parse_duration(v['duration']),
      channel: parse_channel(v['author']),
      thumbnail: pick_thumbnail(v['thumbnails']),
      viewCount: parse_view_count(v['view_count']),
    })
  }
  return out
}

function parse_duration(d: unknown): number {
  if (!d || typeof d !== 'object') return 0
  const obj = d as Record<string, unknown>
  return typeof obj['seconds'] === 'number' ? (obj['seconds'] as number) : 0
}

function parse_channel(a: unknown): string {
  if (!a || typeof a !== 'object') return ''
  return String((a as Record<string, unknown>)['name'] ?? '')
}

function pick_thumbnail(thumbs: unknown): string {
  if (!Array.isArray(thumbs) || thumbs.length === 0) return ''
  const mq = thumbs.find(
    (t) => typeof t === 'object' && String((t as Record<string, unknown>)['url']).includes('mqdefault')
  )
  const chosen = (mq ?? thumbs[0]) as Record<string, unknown>
  return String(chosen['url'] ?? '')
}

function parse_view_count(vc: unknown): number | undefined {
  if (typeof vc === 'number') return vc
  if (typeof vc === 'string') {
    const n = parseInt(vc.replace(/\D/g, ''), 10)
    return isNaN(n) ? undefined : n
  }
  return undefined
}

// ── 다운로드 (yt-dlp.exe) ────────────────────────────────────────────────────

const active_downloads = new Map<string, () => void>()

export function resolve_ytdlp_path(resourcesPath: string, isPackaged: boolean): string {
  return isPackaged
    ? join(resourcesPath, 'bin', 'yt-dlp.exe')
    : join(__dirname, '../../../bin/yt-dlp.exe')
}

export async function youtube_download(
  url: string,
  outputDir: string,
  ytdlpPath: string,
  on_progress: (p: YoutubeProgress) => void,
  on_done: (filePath: string) => void,
  on_error: (message: string) => void
): Promise<void> {
  if (active_downloads.has(url)) return

  const args = [
    '--no-playlist',
    '--format', 'bestaudio[ext=m4a]/bestaudio', // prefer m4a; fallback to best audio
    '--newline',                                  // one progress line per update
    '-o', join(outputDir, '%(title)s.%(ext)s'),
    '--print', 'after_move:filepath',             // print final path after download
    url,
  ]

  on_progress({ url, percent: 0, speed: '', eta: '' })

  let stderrBuf = ''

  try {
    await new Promise<void>((resolve, reject) => {
      // PYTHONIOENCODING=utf-8: ensures yt-dlp stdout is UTF-8 on Windows
      const proc = spawn(ytdlpPath, args, {
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
      })

      active_downloads.set(url, () => {
        proc.kill()
        active_downloads.delete(url)
      })

      // Collect all stdout into a buffer; process only after close to avoid
      // race conditions where close fires before the last data event.
      let stdoutBuf = ''

      proc.stdout.on('data', (data: Buffer) => {
        const text = data.toString('utf8')
        stdoutBuf += text

        // Parse progress lines in real time for UI updates
        for (const line of text.split('\n')) {
          const m = line.trim().match(/\[download\]\s+([\d.]+)%.*?at\s+(\S+)\s+ETA\s+(\S+)/)
          if (m) on_progress({ url, percent: parseFloat(m[1]), speed: m[2], eta: m[3] })
        }
      })

      proc.stderr.on('data', (data: Buffer) => {
        stderrBuf += data.toString('utf8')
      })

      proc.on('close', (code) => {
        active_downloads.delete(url)
        if (code === 0) {
          // Extract final filepath from collected stdout
          let finalPath = ''
          for (const line of stdoutBuf.split('\n')) {
            const t = line.trim()
            if (t && !t.startsWith('[') && !t.startsWith('WARNING') && !t.startsWith('ERROR') &&
                (t.includes('\\') || t.includes('/'))) {
              finalPath = t
            }
          }
          on_progress({ url, percent: 100, speed: '', eta: '' })
          on_done(finalPath || outputDir)
          resolve()
        } else {
          reject(new Error(stderrBuf.trim() || `yt-dlp exited with code ${code}`))
        }
      })

      proc.on('error', (err) => {
        reject(new Error(`Cannot start yt-dlp: ${err.message}`))
      })
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    on_error(message)
  }
}

export function youtube_cancel(url: string): void {
  const cancel = active_downloads.get(url)
  if (cancel) cancel()
}

export function resolve_download_dir(appDir: string, configured: string): string {
  const dir = configured.trim() || join(appDir, 'Downloads')
  mkdirSync(dir, { recursive: true })
  return dir
}
