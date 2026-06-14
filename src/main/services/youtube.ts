import { Readable } from 'stream'
import { spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { Innertube } from 'youtubei.js'
import ffmpegStatic from 'ffmpeg-static'

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
  filePath?: string
}

// ffmpeg 경로 탐색:
//   1. extraFiles 로 번들된 Windows 바이너리 (resources/ffmpeg.exe)
//   2. 개발 환경: ffmpeg-static 이 설치한 플랫폼 바이너리
//   3. PATH fallback
function get_ffmpeg(): string {
  const bundled = join(dirname(process.execPath), 'resources', 'ffmpeg.exe')
  if (existsSync(bundled)) return bundled
  const dev = ffmpegStatic as string | null
  if (dev && existsSync(dev)) return dev
  return 'ffmpeg'
}

// Innertube 인스턴스 (앱 수명 동안 재사용)
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
  if (typeof obj['seconds'] === 'number') return obj['seconds'] as number
  return 0
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

// 진행 중인 다운로드: url → ffmpeg 프로세스
const active_downloads = new Map<string, ChildProcess>()

export async function youtube_download(
  url: string,
  outputDir: string,
  on_progress: (p: YoutubeProgress) => void,
  on_done: (filePath: string) => void,
  on_error: (message: string) => void
): Promise<void> {
  if (active_downloads.has(url)) return

  try {
    const yt = await get_yt()
    const videoId = extract_video_id(url)
    const info = await yt.getInfo(videoId)

    const title = sanitize_filename(String(info.basic_info.title ?? videoId))
    const outputPath = join(outputDir, `${title}.mp3`)
    const durationSec = info.basic_info.duration ?? 0

    // youtubei.js ReadableStream<Uint8Array> → Node.js Readable
    const webStream = await info.download({ type: 'audio', quality: 'best' })

    const proc = spawn(
      get_ffmpeg(),
      ['-i', 'pipe:0', '-vn', '-ar', '44100', '-ac', '2', '-b:a', '192k', '-f', 'mp3', '-y', outputPath],
      { stdio: ['pipe', 'ignore', 'pipe'] }
    )

    active_downloads.set(url, proc)

    // ffmpeg stderr → progress (time=HH:MM:SS 파싱)
    proc.stderr!.on('data', (d: Buffer) => {
      const text = d.toString()
      const m = text.match(/time=(\d+):(\d+):([\d.]+)/)
      if (m && durationSec > 0) {
        const elapsed = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseFloat(m[3])
        on_progress({ url, percent: Math.min(99, (elapsed / durationSec) * 100), speed: '', eta: '' })
      }
    })

    proc.on('error', (err) => {
      active_downloads.delete(url)
      on_error(`ffmpeg 오류: ${err.message}`)
    })

    proc.on('close', (code) => {
      active_downloads.delete(url)
      if (code === 0) {
        on_done(outputPath)
      } else {
        on_error(`변환 실패 (exit ${code})`)
      }
    })

    // Web ReadableStream → Node Readable → ffmpeg stdin
    const nodeReadable = Readable.fromWeb(
      webStream as Parameters<typeof Readable.fromWeb>[0]
    )
    nodeReadable.on('error', (err) => {
      proc.kill()
      active_downloads.delete(url)
      on_error(`스트림 오류: ${err.message}`)
    })
    nodeReadable.pipe(proc.stdin!)

  } catch (err) {
    active_downloads.delete(url)
    on_error(err instanceof Error ? err.message : String(err))
  }
}

export function youtube_cancel(url: string): void {
  const proc = active_downloads.get(url)
  if (proc) {
    proc.kill()
    active_downloads.delete(url)
  }
}

export function resolve_download_dir(appDir: string, configured: string): string {
  const dir = configured.trim() || join(appDir, 'Downloads')
  mkdirSync(dir, { recursive: true })
  return dir
}

function extract_video_id(url: string): string {
  const m = url.match(/[?&]v=([^&]+)/)
  return m ? m[1] : url
}

function sanitize_filename(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 200) || 'audio'
}
