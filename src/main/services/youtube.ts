import { spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

export interface YoutubeResult {
  id: string
  url: string
  title: string
  duration: number // seconds (0 = unknown / live)
  channel: string
  thumbnail: string
  viewCount?: number
}

export interface YoutubeProgress {
  url: string
  percent: number
  speed: string
  eta: string
  filePath?: string // converting 단계에서 최종 경로가 확정되면 설정
}

// yt-dlp 실행 파일 경로: exe 옆 → PATH 순서로 탐색
export function find_ytdlp(appDir: string): string {
  for (const candidate of [join(appDir, 'yt-dlp.exe'), join(appDir, 'yt-dlp')]) {
    if (existsSync(candidate)) return candidate
  }
  return 'yt-dlp' // PATH fallback
}

// 다운로드 대상 디렉터리. 설정값 없으면 exe 옆 Downloads/ 사용
export function resolve_download_dir(appDir: string, configured: string): string {
  const dir = configured.trim() || join(appDir, 'Downloads')
  mkdirSync(dir, { recursive: true })
  return dir
}

// YouTube 검색 (ytsearch 방식 — API 키 불필요)
export function youtube_search(
  ytdlp: string,
  query: string,
  limit = 10
): Promise<YoutubeResult[]> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ytdlp, [
      '--dump-json',
      '--no-download',
      '--no-playlist',
      '--quiet',
      `ytsearch${limit}:${query}`
    ])

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    proc.on('error', (err) =>
      reject(new Error(`yt-dlp not found — place yt-dlp.exe next to MusicFinder.exe\n${err.message}`))
    )
    proc.on('close', (code) => {
      if (code !== 0 && stdout.trim() === '') {
        reject(new Error(stderr.trim() || `yt-dlp exited with code ${code}`))
        return
      }
      const results: YoutubeResult[] = []
      for (const line of stdout.split('\n')) {
        const t = line.trim()
        if (!t) continue
        try {
          const d = JSON.parse(t) as Record<string, unknown>
          results.push({
            id: String(d['id'] ?? ''),
            url: String(d['webpage_url'] ?? `https://www.youtube.com/watch?v=${d['id']}`),
            title: String(d['title'] ?? '(no title)'),
            duration: typeof d['duration'] === 'number' ? (d['duration'] as number) : 0,
            channel: String(d['channel'] ?? d['uploader'] ?? ''),
            thumbnail: pick_thumbnail(d),
            viewCount: typeof d['view_count'] === 'number' ? (d['view_count'] as number) : undefined
          })
        } catch {
          // 잘못된 JSON 줄 무시
        }
      }
      resolve(results)
    })
  })
}

// 썸네일: 중간 해상도(mqdefault 또는 hqdefault) 선호
function pick_thumbnail(d: Record<string, unknown>): string {
  const thumbnails = d['thumbnails']
  if (Array.isArray(thumbnails)) {
    const preferred = thumbnails.find(
      (t) => typeof t === 'object' && t !== null && String((t as Record<string, unknown>)['id']).includes('mq')
    ) as Record<string, unknown> | undefined
    if (preferred) return String(preferred['url'] ?? '')
  }
  return String(d['thumbnail'] ?? '')
}

// 진행 중인 다운로드 (url → ChildProcess)
const active_downloads = new Map<string, ChildProcess>()

// 오디오 다운로드 (mp3, 최고 품질)
export function youtube_download(
  ytdlp: string,
  url: string,
  outputDir: string,
  on_progress: (p: YoutubeProgress) => void,
  on_done: (filePath: string) => void,
  on_error: (message: string) => void
): void {
  if (active_downloads.has(url)) return

  const proc = spawn(ytdlp, [
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '0',
    '--newline',
    '--no-playlist',
    '-o', join(outputDir, '%(title)s.%(ext)s'),
    url
  ])

  active_downloads.set(url, proc)

  let finalPath = ''
  let buf = ''

  const parse_line = (line: string): void => {
    // [download]  45.3% of 5.23MiB at 1.50MiB/s ETA 00:04
    const m = line.match(/\[download\]\s+([\d.]+)%.*?at\s+(\S+)\s+ETA\s+(\S+)/)
    if (m) {
      on_progress({ url, percent: parseFloat(m[1]), speed: m[2], eta: m[3] })
      return
    }
    // [download] 100% of 5.23MiB in 00:03
    if (/\[download\].*100%/.test(line)) {
      on_progress({ url, percent: 100, speed: '', eta: '' })
    }
    // 최종 파일 경로 (ExtractAudio Destination 또는 Moving)
    const dest = line.match(/(?:Destination|Moving):\s+(.+)$/)
    if (dest) {
      finalPath = dest[1].trim()
      on_progress({ url, percent: 100, speed: '', eta: '', filePath: finalPath })
    }
  }

  proc.stdout.on('data', (d: Buffer) => {
    buf += d.toString()
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const l of lines) parse_line(l)
  })
  proc.stderr.on('data', (d: Buffer) => {
    for (const l of d.toString().split('\n')) parse_line(l)
  })

  proc.on('error', (err) => {
    active_downloads.delete(url)
    on_error(`yt-dlp not found — place yt-dlp.exe next to MusicFinder.exe\n${err.message}`)
  })

  proc.on('close', (code) => {
    active_downloads.delete(url)
    if (code === 0) {
      on_done(finalPath)
    } else {
      on_error(`Download failed (exit ${code})`)
    }
  })
}

// 진행 중인 다운로드 취소
export function youtube_cancel(url: string): void {
  const proc = active_downloads.get(url)
  if (proc) {
    proc.kill()
    active_downloads.delete(url)
  }
}
