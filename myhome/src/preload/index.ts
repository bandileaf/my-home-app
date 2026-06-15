import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IndexProgress, IndexSummary } from '../main/services/indexer'
import type { SearchOptions, SearchResult } from '../main/services/search'
import type { YoutubeResult, YoutubeProgress } from '../main/services/youtube'

// 렌더러에 노출할 API.
const api = {
  close_window: (): void => ipcRenderer.send('window:close'),

  // 인덱싱은 "요청이 올 때만" 수행한다 (기능 enable 시 렌더러가 호출).
  start_indexing: (): Promise<IndexSummary> => ipcRenderer.invoke('index:start'),

  // 인덱싱 진행 상황 구독. 해제 함수를 반환.
  on_index_progress: (callback: (progress: IndexProgress) => void): (() => void) => {
    const listener = (_event: unknown, data: IndexProgress): void => callback(data)
    ipcRenderer.on('index:progress', listener)
    return () => ipcRenderer.removeListener('index:progress', listener)
  },

  // 색인 검색.
  search_files: (query: string, options: SearchOptions = {}): Promise<SearchResult> =>
    ipcRenderer.invoke('search:query', query, options),

  // 파일 위치 열기 / 경로 복사.
  reveal_file: (fullPath: string): void => ipcRenderer.send('file:reveal', fullPath),
  copy_path: (fullPath: string): void => ipcRenderer.send('file:copyPath', fullPath),

  // 임의 텍스트 클립보드 복사
  write_clipboard: (text: string): void => ipcRenderer.send('clipboard:write', text),

  // 파일 외부 수정 감지 (watch 정책이 있는 doc 용)
  watch_file: (path: string): void => ipcRenderer.send('watch:add', path),
  unwatch_file: (path: string): void => ipcRenderer.send('watch:remove', path),
  on_file_changed: (callback: (path: string) => void): (() => void) => {
    const listener = (_event: unknown, path: string): void => callback(path)
    ipcRenderer.on('file:changed', listener)
    return () => ipcRenderer.removeListener('file:changed', listener)
  },

  // 범용 파일 읽기/쓰기 (에디터 탭).
  read_file: (path: string): Promise<{ path: string; text: string }> =>
    ipcRenderer.invoke('file:read', path),
  write_file: (path: string, text: string): Promise<void> =>
    ipcRenderer.invoke('file:write', path, text),

  // settings.json 경로 (Settings 아이콘/메뉴가 이 파일을 에디터로 연다).
  get_settings_path: (): Promise<string> => ipcRenderer.invoke('settings:path'),

  // settings.json 존재 여부 / 기본값 생성
  settings_status: (): Promise<{ path: string; exists: boolean }> =>
    ipcRenderer.invoke('settings:status'),
  create_default_settings: (): Promise<void> => ipcRenderer.invoke('settings:createDefault'),

  // 드롭된 File 의 실제 디스크 경로 (Electron webUtils).
  path_for_file: (file: File): string => webUtils.getPathForFile(file),

  // 메인이 보내는 알림 구독 (메시지 큐 입력). 해제 함수 반환.
  on_notify: (
    callback: (payload: { message: string; type?: 'info' | 'error' }) => void
  ): (() => void) => {
    const listener = (_event: unknown, payload: { message: string; type?: 'info' | 'error' }): void =>
      callback(payload)
    ipcRenderer.on('notify', listener)
    return () => ipcRenderer.removeListener('notify', listener)
  },

  // 백그라운드 스캔 완료 이벤트
  on_index_done: (callback: (summary: IndexSummary) => void): (() => void) => {
    const listener = (_event: unknown, summary: IndexSummary): void => callback(summary)
    ipcRenderer.on('index:done', listener)
    return () => ipcRenderer.removeListener('index:done', listener)
  },

  // 앱 상태(탭 등) DB 영속화
  app_state_get: (key: string): Promise<string | null> =>
    ipcRenderer.invoke('app_state:get', key),
  app_state_set: (key: string, value: string): void =>
    ipcRenderer.send('app_state:set', key, value),

  get_bins: (): Promise<Record<string, string>> => ipcRenderer.invoke('get-bins'),

  // ── YouTube ──────────────────────────────────────────────────────────────
  youtube_search: (query: string): Promise<YoutubeResult[]> =>
    ipcRenderer.invoke('youtube:search', query),
  youtube_download: (url: string, audioFormat: string): void => ipcRenderer.send('youtube:download', url, audioFormat),
  youtube_download_video: (url: string): void => ipcRenderer.send('youtube:download-video', url),
  youtube_cancel: (url: string): void => ipcRenderer.send('youtube:cancel', url),
  youtube_cancel_video: (url: string): void => ipcRenderer.send('youtube:cancel-video', url),
  youtube_open_folder: (filePath: string): void => ipcRenderer.send('youtube:open-folder', filePath),
  youtube_open_url: (url: string): void => ipcRenderer.send('youtube:open-url', url),

  on_youtube_progress: (callback: (p: YoutubeProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: YoutubeProgress): void => callback(p)
    ipcRenderer.on('youtube:progress', listener)
    return () => ipcRenderer.removeListener('youtube:progress', listener)
  },
  on_youtube_done: (callback: (data: { url: string; filePath: string }) => void): (() => void) => {
    const listener = (_e: unknown, data: { url: string; filePath: string }): void => callback(data)
    ipcRenderer.on('youtube:done', listener)
    return () => ipcRenderer.removeListener('youtube:done', listener)
  },
  on_youtube_error: (callback: (data: { url: string; message: string }) => void): (() => void) => {
    const listener = (_e: unknown, data: { url: string; message: string }): void => callback(data)
    ipcRenderer.on('youtube:error', listener)
    return () => ipcRenderer.removeListener('youtube:error', listener)
  },

  on_youtube_progress_video: (callback: (p: YoutubeProgress) => void): (() => void) => {
    const listener = (_e: unknown, p: YoutubeProgress): void => callback(p)
    ipcRenderer.on('youtube:progress-video', listener)
    return () => ipcRenderer.removeListener('youtube:progress-video', listener)
  },
  on_youtube_done_video: (callback: (data: { url: string; filePath: string }) => void): (() => void) => {
    const listener = (_e: unknown, data: { url: string; filePath: string }): void => callback(data)
    ipcRenderer.on('youtube:done-video', listener)
    return () => ipcRenderer.removeListener('youtube:done-video', listener)
  },
  on_youtube_error_video: (callback: (data: { url: string; message: string }) => void): (() => void) => {
    const listener = (_e: unknown, data: { url: string; message: string }): void => callback(data)
    ipcRenderer.on('youtube:error-video', listener)
    return () => ipcRenderer.removeListener('youtube:error-video', listener)
  }
}

export type PreloadApi = typeof api

function expose_api(bridgeApi: PreloadApi): void {
  if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('api', bridgeApi)
  } else {
    ;(globalThis as unknown as { api: PreloadApi }).api = bridgeApi
  }
}

expose_api(api)
