// Tauri-based bridge replacing the Electron preload window.api.
// Keeps the same AppBridge interface so UI panels need no changes.

import { invoke }  from '@tauri-apps/api/core'
import { listen }  from '@tauri-apps/api/event'
import { open as dialog_open } from '@tauri-apps/plugin-dialog'

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
  copy_file?: (fullPath: string) => void
  watch_file?: (path: string) => void
  unwatch_file?: (path: string) => void
  on_file_changed?: (callback: (path: string) => void) => () => void
  read_file?: (path: string) => Promise<{ path: string; text: string }>
  write_file?: (path: string, text: string) => Promise<void>
  get_settings_path?: () => Promise<string>
  settings_status?: () => Promise<{ path: string; exists: boolean }>
  create_default_settings?: () => Promise<void>
  path_for_file?: (file: File) => string
  on_notify?: (callback: (payload: { message: string; type?: 'info' | 'error' }) => void) => () => void
  on_index_done?: (callback: (summary: IndexSummary) => void) => () => void
  app_state_get?: (key: string) => Promise<string | null>
  app_state_set?: (key: string, value: string) => void
  ensure_bins?: () => Promise<Record<string, string>>
  get_bins_status?: () => Promise<BinStatusEntry[]>
  on_bins_status?: (callback: (data: { name: string; state: BinState }) => void) => () => void
  on_bins_progress?: (callback: (data: { name: string; percent: number }) => void) => () => void
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
  convert_pick_folder?: () => Promise<string | null>
  convert_scan_folder?: (dir: string, targetExt: string) => Promise<{ path: string; needsFix?: boolean; fixMessage?: string }[]>
  convert_start?: (srcPath: string, targetFmt: string, deleteOriginal?: boolean, needsFix?: boolean, fixMessage?: string) => void
  convert_cancel?: (srcPath: string) => void
  convert_delete_file?: (filePath: string) => void
  on_convert_file_deleted?: (cb: (d: { path: string }) => void) => () => void
  on_convert_progress?: (cb: (d: { srcPath: string; percent: number }) => void) => () => void
  on_convert_done?: (cb: (d: { srcPath: string; destPath: string }) => void) => () => void
  on_convert_error?: (cb: (d: { srcPath: string; message: string }) => void) => () => void
  on_convert_scan_item?: (cb: (item: { path: string; needsFix?: boolean; fixMessage?: string; isBak?: boolean }) => void) => () => void
  on_convert_scan_progress?: (cb: (d: { current: number; total: number }) => void) => () => void
}

function on_event<T>(event: string, cb: (data: T) => void): () => void {
  let unlisten: (() => void) | null = null
  listen<T>(event, (e) => cb(e.payload)).then((fn) => { unlisten = fn })
  return () => { unlisten?.() }
}

const bridge: AppBridge = {
  close_window: () => invoke('close_window').catch(() => window.close()),

  start_indexing: () => invoke<IndexSummary>('start_indexing'),

  on_index_progress: (cb) => on_event<IndexProgress>('index:progress', cb),

  on_index_done: (cb) => on_event<IndexSummary>('index:done', cb),

  search_files: (query, options) =>
    invoke<SearchResult>('search_files', { query, options: options ?? null }),

  reveal_file: (fullPath) => { void invoke('reveal_file', { fullPath }) },

  copy_file: (fullPath) => { void navigator.clipboard.writeText(fullPath) },

  watch_file: (path) => { void invoke('watch_file', { path }) },

  unwatch_file: (path) => { void invoke('unwatch_file', { path }) },

  on_file_changed: (cb) => on_event<string>('file:changed', cb),

  read_file: (path) => invoke<{ path: string; text: string }>('read_file', { path }),

  write_file: (path, text) => invoke<void>('write_file', { path, text }),

  get_settings_path: () => invoke<string>('get_settings_path'),

  settings_status: () => invoke<{ path: string; exists: boolean }>('settings_status'),

  create_default_settings: () => invoke<void>('create_default_settings'),

  path_for_file: (_file) => '',

  on_notify: (cb) => on_event<{ message: string; type?: 'info' | 'error' }>('notify', cb),

  app_state_get: (key) => invoke<string | null>('app_state_get', { key }),

  app_state_set: (key, value) => { void invoke('app_state_set', { key, value }) },

  // Bins
  ensure_bins: () => invoke<Record<string, string>>('ensure_bins'),

  get_bins_status: () => invoke<BinStatusEntry[]>('get_bins_status'),

  on_bins_status: (cb) => on_event<{ name: string; state: BinState }>('bins:status', cb),

  on_bins_progress: (cb) => on_event<{ name: string; percent: number }>('bins:progress', cb),

  // YouTube
  youtube_search: (query) => invoke<YoutubeResult[]>('youtube_search', { query }),

  youtube_download: (url, audioFormat) => {
    void invoke('youtube_download', { url, audioFormat })
  },

  youtube_download_video: (url) => {
    void invoke('youtube_download_video', { url })
  },

  youtube_cancel: (url) => { void invoke('youtube_cancel', { url }) },

  youtube_cancel_video: (url) => { void invoke('youtube_cancel_video', { url }) },

  youtube_open_folder: (filePath) => { void invoke('youtube_open_folder', { filePath }) },

  youtube_open_url: (url) => { void invoke('youtube_open_url', { url }) },

  on_youtube_progress: (cb) => on_event<YoutubeProgress>('youtube:progress', cb),

  on_youtube_done: (cb) => on_event<{ url: string; filePath: string }>('youtube:done', cb),

  on_youtube_error: (cb) => on_event<{ url: string; message: string }>('youtube:error', cb),

  on_youtube_progress_video: (cb) => on_event<YoutubeProgress>('youtube:progress_video', cb),

  on_youtube_done_video: (cb) => on_event<{ url: string; filePath: string }>('youtube:done_video', cb),

  on_youtube_error_video: (cb) => on_event<{ url: string; message: string }>('youtube:error_video', cb),

  // Convert
  convert_pick_folder: async () => {
    const result = await dialog_open({ directory: true, multiple: false })
    if (!result) return null
    return typeof result === 'string' ? result : (result as { path?: string }).path ?? null
  },

  convert_scan_folder: async (dir, targetExt) => {
    await invoke('convert_scan_folder', { dir, targetExt })
    return []
  },

  convert_start: (srcPath, targetFmt, deleteOriginal, needsFix, fixMessage) => {
    void invoke('convert_start', { srcPath, targetFmt, deleteOriginal, needsFix, fixMessage })
  },

  convert_cancel: (srcPath) => { void invoke('convert_cancel', { srcPath }) },

  convert_delete_file: (filePath) => { void invoke('convert_delete_file', { filePath }) },

  on_convert_file_deleted: (cb) => on_event<{ path: string }>('convert:file_deleted', cb),

  on_convert_progress: (cb) => on_event<{ srcPath: string; percent: number }>('convert:progress', cb),

  on_convert_done: (cb) => on_event<{ srcPath: string; destPath: string }>('convert:done', cb),

  on_convert_error: (cb) => on_event<{ srcPath: string; message: string }>('convert:error', cb),

  on_convert_scan_item: (cb) =>
    on_event<{ path: string; needsFix?: boolean; fixMessage?: string; isBak?: boolean }>(
      'convert:scan_item', cb
    ),

  on_convert_scan_progress: (cb) =>
    on_event<{ current: number; total: number }>('convert:scan_progress', cb),
}

export function get_bridge(): AppBridge | undefined {
  return bridge
}
