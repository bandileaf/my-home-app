import { createWriteStream, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import type { Innertube as InnertubeType } from 'youtubei.js'

interface AudioFormat {
  has_audio: boolean
  has_video: boolean
  content_length?: number
  mime_type: string
}

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

// ── Innertube singleton ──────────────────────────────────────────────────────

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

// ── 다운로드 (youtubei.js IOS client — non-ciphered audio URLs) ──────────────

const active_downloads = new Map<string, () => void>()

export async function youtube_download(
  url: string,
  outputDir: string,
  on_progress: (p: YoutubeProgress) => void,
  on_done: (filePath: string) => void,
  on_error: (message: string) => void
): Promise<void> {
  if (active_downloads.has(url)) return

  let outputPath = ''
  let cancelled = false

  try {
    const videoId = new URL(url).searchParams.get('v')
    if (!videoId) throw new Error('Invalid YouTube URL')

    const yt = await get_yt()

    // IOS client returns non-ciphered streaming URLs — avoids decipher errors
    const info = await yt.getInfo(videoId, { client: 'IOS' })
    const title = sanitize_filename(info.basic_info.title ?? 'audio')

    const audioFormats = ((info.streaming_data?.adaptive_formats ?? []) as AudioFormat[]).filter(
      (f) => f.has_audio && !f.has_video
    )
    const totalBytes = audioFormats[0]?.content_length ?? 0

    const ext = audioFormats[0]?.mime_type.startsWith('audio/webm') ? 'webm' : 'm4a'
    outputPath = join(outputDir, `${title}.${ext}`)

    on_progress({ url, percent: 0, speed: '', eta: '' })

    const stream = await yt.download(videoId, {
      type: 'audio',
      quality: 'best',
      format: 'any',
      client: 'IOS',
    })

    const dest = createWriteStream(outputPath)

    const cancel = (): void => {
      cancelled = true
      dest.destroy()
      try { rmSync(outputPath) } catch { /* ignore */ }
    }
    active_downloads.set(url, cancel)

    let downloaded = 0
    const reader = (stream as unknown as ReadableStream<Uint8Array>).getReader()

    const pump = async (): Promise<void> => {
      while (true) {
        const { done, value } = await reader.read()
        if (done || cancelled) break
        dest.write(Buffer.from(value))
        downloaded += value.byteLength
        if (totalBytes > 0) {
          on_progress({
            url,
            percent: Math.min(99, (downloaded / totalBytes) * 100),
            speed: '',
            eta: '',
          })
        }
      }
    }

    await pump()

    if (!cancelled) {
      await new Promise<void>((resolve, reject) => {
        dest.end()
        dest.on('finish', resolve)
        dest.on('error', reject)
      })
      active_downloads.delete(url)
      on_progress({ url, percent: 100, speed: '', eta: '' })
      on_done(outputPath)
    }
  } catch (err) {
    active_downloads.delete(url)
    if (outputPath) try { rmSync(outputPath) } catch { /* ignore */ }
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
