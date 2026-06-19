// 렌더러에서 Electron preload API(window.api)에 타입 안전하게 접근하기 위한 헬퍼.
// 브라우저 미리보기(dev:web)에서는 window.api 가 없으므로 항상 존재 여부를 확인한다.

export interface IndexProgress {
  scanned: number
  indexed: number
  excluded: number
  currentDir: string
}

export interface IndexSummary {
  scanned: number
  indexed: number
  excluded: number
  hasTarget: boolean
  missing: string[]
}

export interface SearchHit {
  fullPath: string
  fileName: string
  dirPath: string
  ext: string
  sizeBytes: number
}

export interface SearchResult {
  hits: SearchHit[]
  total: number
  truncated: boolean
}

export interface SearchOptions {
  extensions?: string[]
  limit?: number
}

export interface YoutubeResult {
  id: string
  url: string
  title: string
  duration: number
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

export type BinState = 'pending' | 'downloading' | 'extracting' | 'installed' | 'failed'

export interface BinStatusEntry {
  name: string
  state: BinState
  percent: number
}

export interface AppBridge {
  close_window?: () => void
  start_indexing?: () => Promise<IndexSummary>
  on_index_progress?: (callback: (progress: IndexProgress) => void) => () => void
  search_files?: (query: string, options?: SearchOptions) => Promise<SearchResult>
  reveal_file?: (fullPath: string) => void
  copy_path?: (fullPath: string) => void
  write_clipboard?: (text: string) => void
  watch_file?: (path: string) => void
  unwatch_file?: (path: string) => void
  on_file_changed?: (callback: (path: string) => void) => () => void
  // 범용 파일 편집 + 설정 경로 + 드롭된 파일의 실제 경로
  read_file?: (path: string) => Promise<{ path: string; text: string }>
  write_file?: (path: string, text: string) => Promise<void>
  get_settings_path?: () => Promise<string>
  settings_status?: () => Promise<{ path: string; exists: boolean }>
  create_default_settings?: () => Promise<void>
  path_for_file?: (file: File) => string
  // 메인 → 렌더러 알림 (메시지 큐 입력)
  on_notify?: (
    callback: (payload: { message: string; type?: 'info' | 'error' }) => void
  ) => () => void
  // 백그라운드 스캔 완료 이벤트
  on_index_done?: (callback: (summary: IndexSummary) => void) => () => void
  // 앱 상태(탭 등) DB 영속화
  app_state_get?: (key: string) => Promise<string | null>
  app_state_set?: (key: string, value: string) => void
  // bin 설치 확인/다운로드 (yt-dlp, ffmpeg 등)
  ensure_bins?: () => Promise<Record<string, string>>
  get_bins_status?: () => Promise<BinStatusEntry[]>
  on_bins_status?: (callback: (data: { name: string; state: BinState }) => void) => () => void
  on_bins_progress?: (callback: (data: { name: string; percent: number }) => void) => () => void
  // YouTube
  youtube_search?: (query: string) => Promise<YoutubeResult[]>
  youtube_download?: (url: string, audioFormat: string) => void
  youtube_download_video?: (url: string) => void
  youtube_cancel?: (url: string) => void
  youtube_cancel_video?: (url: string) => void
  youtube_open_folder?: (filePath: string) => void
  youtube_open_url?: (url: string) => void
  on_youtube_progress?: (callback: (p: YoutubeProgress) => void) => () => void
  on_youtube_done?: (callback: (data: { url: string; filePath: string }) => void) => () => void
  on_youtube_error?: (callback: (data: { url: string; message: string }) => void) => () => void
  on_youtube_progress_video?: (callback: (p: YoutubeProgress) => void) => () => void
  on_youtube_done_video?: (callback: (data: { url: string; filePath: string }) => void) => () => void
  on_youtube_error_video?: (callback: (data: { url: string; message: string }) => void) => () => void
}

export function get_bridge(): AppBridge | undefined {
  return (window as unknown as { api?: AppBridge }).api
}
