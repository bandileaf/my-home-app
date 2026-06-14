import { createWriteStream, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { Innertube } from 'youtubei.js'
import ytdl from '@distube/ytdl-core'

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

// ── 검색: youtubei.js ────────────────────────────────────────────────────────

let _yt: Innertube | null = null

async function get_yt(): Promise<Innertube> {
  if (!_yt) _yt = await Innertube.create()
  return _yt
}

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

// ── 다운로드: @distube/ytdl-core ────────────────────────────────────────────

const active_downloads = new Map<string, () => void>()

export async function youtube_download(
  url: string,
  outputDir: string,
  on_progress: (p: YoutubeProgress) => void,
  on_done: (filePath: string) => void,
  on_error: (message: string) => void
): Promise<void> {
  if (active_downloads.has(url)) return

  try {
    const info = await ytdl.getInfo(url)
    const format = ytdl.chooseFormat(info.formats, {
      quality: 'highestaudio',
      filter: 'audioonly',
    })

    const ext = format.container === 'mp4' ? 'm4a' : (format.container ?? 'webm')
    const title = sanitize_filename(info.videoDetails.title ?? 'audio')
    const outputPath = join(outputDir, `${title}.${ext}`)
    const totalBytes = parseInt(format.contentLength ?? '0', 10)

    on_progress({ url, percent: 0, speed: '', eta: '' })

    const src = ytdl.downloadFromInfo(info, { format })
    const dest = createWriteStream(outputPath)

    const cancel = (): void => {
      src.destroy()
      dest.destroy()
      try { rmSync(outputPath) } catch { /* ignore */ }
    }
    active_downloads.set(url, cancel)

    let downloaded = 0
    src.on('data', (chunk: Buffer) => {
      downloaded += chunk.length
      if (totalBytes > 0) {
        on_progress({ url, percent: Math.min(99, (downloaded / totalBytes) * 100), speed: '', eta: '' })
      }
    })

    src.on('error', (err) => {
      active_downloads.delete(url)
      on_error(err.message)
    })

    dest.on('error', (err) => {
      active_downloads.delete(url)
      on_error(err.message)
    })

    dest.on('finish', () => {
      active_downloads.delete(url)
      on_progress({ url, percent: 100, speed: '', eta: '' })
      on_done(outputPath)
    })

    src.pipe(dest)

  } catch (err) {
    active_downloads.delete(url)
    on_error(err instanceof Error ? err.message : String(err))
  }
}

export function youtube_cancel(url: string): void {
  const cancel = active_downloads.get(url)
  if (cancel) {
    cancel()
    active_downloads.delete(url)
  }
}

export function resolve_download_dir(appDir: string, configured: string): string {
  const dir = configured.trim() || join(appDir, 'Downloads')
  mkdirSync(dir, { recursive: true })
  return dir
}

function sanitize_filename(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 200) || 'audio'
}
