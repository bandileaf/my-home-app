import { app, BrowserWindow, clipboard, ipcMain, Menu, shell, type WebContents } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, watch, writeFileSync } from 'fs'
import { stat } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import { load_settings } from './services/settings'
import {
  resolve_download_dir,
  resolve_ytdlp_path,
  resolve_ffmpeg_dir,
  youtube_search,
  youtube_download,
  youtube_download_video,
  youtube_cancel,
  youtube_cancel_video,
  type YoutubeResult,
  type YoutubeProgress
} from './services/youtube'
import {
  build_index,
  create_excluder,
  is_under_dir,
  to_posix,
  type FileEntry,
  type IndexSummary
} from './services/indexer'
import { search_files, type SearchOptions, type SearchResult } from './services/search'
import {
  open_db,
  db_load_entries,
  db_upsert_entries,
  db_upsert_entry,
  db_delete_entry,
  db_delete_entries_for_dir,
  db_is_dir_done,
  db_checkpoint_dir,
  db_remove_checkpoint,
  db_load_summary,
  db_save_summary,
  db_get_state,
  db_set_state,
  type DB
} from './services/db'

interface IndexState {
  entries: FileEntry[]
  // open-file watchers (에디터 탭 외부 수정 감지)
  fileWatchers: Map<string, ReturnType<typeof watch>>
  ignoreUntil: Map<string, number>
  // indexed-dir watchers (추가/삭제 자동 감지)
  dirWatchers: Map<string, ReturnType<typeof watch>>
  dirUpdateTimers: Map<string, ReturnType<typeof setTimeout>>
  // 현재 스캔 설정 (검색 시 즉시 필터에도 사용)
  currentDirs: string[]
  currentExcludePatterns: string[]
  currentExcludeSig: string
  lastSummary: IndexSummary | null
  scanning: boolean
}

function app_dir(): string {
  if (app.isPackaged) {
    return process.env.PORTABLE_EXECUTABLE_DIR ?? dirname(app.getPath('exe'))
  }
  return process.cwd()
}

let _log_path: string | null = null
function log_event(message: string): void {
  try {
    if (!_log_path) {
      const logDir = join(app_dir(), 'log')
      mkdirSync(logDir, { recursive: true })
      _log_path = join(logDir, `myhome_v${app.getVersion()}.log`)
    }
    appendFileSync(_log_path, `[${new Date().toISOString()}] ${message}\n`)
  } catch {
    // ignore
  }
}

function log_error(message: string, err: unknown): void {
  const e = err as Error
  log_event(`${message}: ${e.message}`)
  if (e.stack) log_event(e.stack)
}

function resolve_settings_path(): string {
  return join(app_dir(), 'settings.json')
}

function resolve_db_path(): string {
  return join(app_dir(), 'indexing.db')
}

function default_settings_text(): string {
  return [
    '{',
    '  // Folders to index (multiple allowed).',
    '  // On Windows use \\\\ (two backslashes) or / — e.g. "D:\\\\Music" or "D:/Music"',
    '  "musicSearch.searchDirectories": [],',
    '',
    '  // Exclude patterns (VS Code files.exclude format)',
    '  "musicSearch.exclude": {',
    '    "**/*.jpg": true,',
    '    "**/*.png": true',
    '  }',
    '}',
    ''
  ].join('\n')
}

function notify_renderer(
  sender: WebContents,
  message: string,
  type: 'info' | 'error' = 'info'
): void {
  sender.send('notify', { message, type })
}

// settings 를 로드하고 존재 여부를 분리해 반환한다.
interface ResolvedDirs {
  existing: string[]
  missing: string[]
  excludePatterns: string[]
  excludeSig: string
}
function resolve_scan_dirs(settingsPath: string): ResolvedDirs {
  const settings = load_settings(settingsPath)
  const existing: string[] = []
  const missing: string[] = []
  for (const dir of settings.searchDirectories) {
    let isDir = false
    try {
      isDir = statSync(dir).isDirectory()
    } catch {
      isDir = false
    }
    if (isDir) existing.push(dir)
    else missing.push(dir)
  }
  const excludePatterns = settings.exclude   // settings.ts 가 이미 true 인 패턴만 추렸다
  const excludeSig = JSON.stringify(excludePatterns)
  return { existing, missing, excludePatterns, excludeSig }
}

// indexed-dir watcher: 파일 추가/삭제/변경을 감지해 index 를 실시간 업데이트한다.
function setup_dir_watchers(
  sender: WebContents,
  db: DB,
  state: IndexState,
  dirs: string[],
  excludePatterns: string[]
): void {
  // 기존 dir watcher 전체 해제
  for (const w of state.dirWatchers.values()) {
    try {
      w.close()
    } catch {
      /* ignore */
    }
  }
  state.dirWatchers.clear()

  const is_excluded = create_excluder(excludePatterns)

  for (const rootDir of dirs) {
    try {
      // Windows: { recursive: true } 지원. Linux: 미지원이므로 catch 에서 shallow watch.
      const watcher = watch(rootDir, { recursive: true }, (_evType, filename) => {
        if (!filename) return
        const fullPath = join(rootDir, filename as string)
        // 같은 파일에 대한 연속 이벤트는 debounce
        const existing = state.dirUpdateTimers.get(fullPath)
        if (existing) clearTimeout(existing)
        const timer = setTimeout(() => {
          state.dirUpdateTimers.delete(fullPath)
          void handle_dir_change(sender, db, state, rootDir, fullPath, is_excluded)
        }, 800)
        state.dirUpdateTimers.set(fullPath, timer)
      })
      state.dirWatchers.set(rootDir, watcher)
      log_event(`dir watch add: ${rootDir}`)
    } catch {
      log_event(`dir watch not supported for: ${rootDir} (non-critical)`)
    }
  }
}

// 파일 하나의 추가/수정/삭제를 state.entries 와 DB 에 반영한다.
async function handle_dir_change(
  sender: WebContents,
  db: DB,
  state: IndexState,
  rootDir: string,
  fullPath: string,
  is_excluded: (path: string) => boolean
): Promise<void> {
  // open-file watcher 가 직접 저장한 파일은 무시 (ignoreUntil 은 editor tab 용)
  if (Date.now() < (state.ignoreUntil.get(fullPath) ?? 0)) return

  let fileExists = false
  let sizeBytes = 0
  let modifiedMs = 0
  try {
    const info = await stat(fullPath)
    if (info.isFile()) {
      fileExists = true
      sizeBytes = info.size
      modifiedMs = info.mtimeMs
    }
  } catch {
    fileExists = false
  }

  const relativePosix = to_posix(fullPath.slice(rootDir.length + 1))

  if (!fileExists) {
    // 삭제된 파일 → index 에서 제거
    const idx = state.entries.findIndex((e) => e.fullPath === fullPath)
    if (idx >= 0) {
      state.entries.splice(idx, 1)
      db_delete_entry(db, fullPath)
      log_event(`dir watch: removed ${fullPath}`)
      update_and_send_summary(sender, db, state)
    }
  } else if (!is_excluded(relativePosix)) {
    // 추가/수정 파일 → index 갱신
    const entry: FileEntry = {
      fullPath,
      fileName: basename(fullPath),
      dirPath: dirname(fullPath),
      ext: extname(fullPath).slice(1).toLowerCase(),
      sizeBytes,
      modifiedMs
    }
    const idx = state.entries.findIndex((e) => e.fullPath === fullPath)
    if (idx >= 0) state.entries[idx] = entry
    else state.entries.push(entry)
    db_upsert_entry(db, entry)
    log_event(`dir watch: upserted ${fullPath}`)
    update_and_send_summary(sender, db, state)
  }
}

function update_and_send_summary(
  sender: WebContents,
  db: DB,
  state: IndexState
): void {
  const summary: IndexSummary = state.lastSummary
    ? {
        ...state.lastSummary,
        indexed: state.entries.length
      }
    : {
        scanned: state.entries.length,
        indexed: state.entries.length,
        excluded: 0,
        hasTarget: true,
        missing: []
      }
  state.lastSummary = summary
  db_save_summary(db, summary)
  if (!sender.isDestroyed()) sender.send('index:done', summary)
}

/**
 * 백그라운드 스캔. 설계 원칙:
 * 1. settings 에서 제거된 dir → DB/state 에서 삭제
 * 2. 새로 추가된 dir 또는 exclude 패턴이 바뀐 dir → 재스캔
 * 3. 변경 없는 dir(체크포인트 일치) → 스킵
 * 4. 스캔 중 state.entries 에 직접 채움 → 중간 검색 가능
 * 5. 각 dir 완료 시 DB 저장 + 체크포인트 → 중간 종료 후 이어서 가능
 * 6. 완료 후 dir watcher 설정
 */
async function background_scan(
  sender: WebContents,
  db: DB,
  state: IndexState,
  settingsPath: string
): Promise<void> {
  if (state.scanning) return
  state.scanning = true
  log_event('background_scan: start')

  try {
    const { existing, missing, excludePatterns, excludeSig } = resolve_scan_dirs(settingsPath)

    // exclude 패턴을 즉시 반영 — 검색이 스캔 완료 전에도 올바른 필터를 사용한다
    state.currentExcludePatterns = excludePatterns

    // settings 에서 제거된 dir: DB 엔트리 + 체크포인트 + state.entries 에서 삭제
    const removedDirs = state.currentDirs.filter((d) => !existing.includes(d))
    for (const dir of removedDirs) {
      state.entries = state.entries.filter((e) => !is_under_dir(dir, e.fullPath))
      db_delete_entries_for_dir(db, dir)
      db_remove_checkpoint(db, dir)
      log_event(`removed dir from index: ${dir}`)
    }

    // 없는 폴더 알림
    for (const dir of missing) {
      notify_renderer(sender, `Cannot find folder: ${dir} (settings.json)`, 'error')
    }

    if (existing.length === 0) {
      state.entries = []
      const summary: IndexSummary = { scanned: 0, indexed: 0, excluded: 0, hasTarget: false, missing }
      state.lastSummary = summary
      state.currentDirs = []
      state.currentExcludeSig = excludeSig
      db_save_summary(db, summary)
      if (missing.length === 0) {
        notify_renderer(
          sender,
          'No folders to index — set musicSearch.searchDirectories in settings.json',
          'error'
        )
      }
      if (!sender.isDestroyed()) sender.send('index:done', summary)
      state.scanning = false
      return
    }

    let totalScanned = 0
    let totalExcluded = 0

    for (const dir of existing) {
      // 체크포인트 확인: 이 dir 가 같은 exclude 패턴으로 완전히 스캔됐으면 스킵
      if (db_is_dir_done(db, dir, excludeSig)) {
        log_event(`skip (checkpoint ok): ${dir}`)
        continue
      }

      // 이 dir 의 기존 엔트리 제거 (부분 데이터 정리)
      state.entries = state.entries.filter((e) => !is_under_dir(dir, e.fullPath))
      db_delete_entries_for_dir(db, dir)

      const beforeCount = state.entries.length

      // state.entries 에 직접 채움 → 스캔 중에도 검색 가능
      const result = await build_index([dir], excludePatterns, state.entries, (progress) => {
        if (!sender.isDestroyed()) sender.send('index:progress', progress)
      })

      totalScanned += result.scanned
      totalExcluded += result.excluded

      // 이 dir 에서 새로 추가된 엔트리만 DB 에 저장
      const newEntries = state.entries.slice(beforeCount)
      db_upsert_entries(db, newEntries)
      db_checkpoint_dir(db, dir, excludeSig)
      log_event(`scanned dir: ${dir} → ${newEntries.length} entries`)
    }

    state.currentDirs = existing
    state.currentExcludePatterns = excludePatterns
    state.currentExcludeSig = excludeSig

    const summary: IndexSummary = {
      scanned: totalScanned,
      indexed: state.entries.length,
      excluded: totalExcluded,
      hasTarget: true,
      missing
    }
    state.lastSummary = summary
    db_save_summary(db, summary)

    log_event(`background_scan done: ${state.entries.length} total entries`)
    if (!sender.isDestroyed()) sender.send('index:done', summary)

    // 스캔 완료 후 dir watcher 설정
    setup_dir_watchers(sender, db, state, existing, excludePatterns)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log_event(`background_scan ERROR: ${message}`)
    notify_renderer(sender, message, 'error')
  } finally {
    state.scanning = false
  }
}

function register_ipc(settingsPath: string, db: DB, state: IndexState): void {
  ipcMain.on('window:close', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })

  // DB 캐시를 즉시 반환하고 백그라운드 스캔을 시작한다.
  ipcMain.handle('index:start', async (event): Promise<IndexSummary> => {
    log_event(`index:start — entries in cache: ${state.entries.length}`)
    const cached: IndexSummary = state.lastSummary ?? {
      scanned: 0,
      indexed: state.entries.length,
      excluded: 0,
      hasTarget: state.entries.length > 0,
      missing: []
    }
    void background_scan(event.sender, db, state, settingsPath)
    return cached
  })

  ipcMain.handle('search:query', (_event, query: string, options: SearchOptions): SearchResult => {
    // 현재 exclude 패턴을 검색에도 적용 → settings 변경 즉시 반영 (DB 정리 기다릴 필요 없음)
    const result = search_files(state.entries, query, {
      ...options,
      excludePatterns: state.currentExcludePatterns
    })
    log_event(`search q="${query}" entries=${state.entries.length} total=${result.total}`)
    return result
  })

  ipcMain.on('file:reveal', (_event, fullPath: string) => {
    shell.showItemInFolder(fullPath)
  })

  ipcMain.on('file:copyPath', (_event, fullPath: string) => {
    clipboard.writeText(fullPath)
  })

  ipcMain.on('clipboard:write', (_event, text: string) => {
    clipboard.writeText(text)
  })

  ipcMain.handle('settings:path', (): string => settingsPath)

  ipcMain.handle('settings:status', (): { path: string; exists: boolean } => ({
    path: settingsPath,
    exists: existsSync(settingsPath)
  }))

  ipcMain.handle('settings:createDefault', (event): void => {
    if (existsSync(settingsPath)) return
    writeFileSync(settingsPath, default_settings_text(), 'utf-8')
    log_event(`settings created (default): ${settingsPath}`)
    notify_renderer(event.sender, 'Created default settings.json')
  })

  ipcMain.handle('file:read', (_event, path: string): { path: string; text: string } => {
    const text = existsSync(path) ? readFileSync(path, 'utf-8') : ''
    return { path, text }
  })

  ipcMain.handle('file:write', (_event, path: string, text: string): void => {
    state.ignoreUntil.set(path, Date.now() + 800)
    writeFileSync(path, text, 'utf-8')
    log_event(`file written: ${path}`)
  })

  // open-file watcher (에디터 탭 외부 수정 감지)
  ipcMain.on('watch:add', (event, path: string) => {
    if (state.fileWatchers.has(path)) return
    try {
      const dir = dirname(path)
      const name = basename(path)
      let timer: ReturnType<typeof setTimeout> | null = null
      const watcher = watch(dir, (_eventType, changed) => {
        if (changed !== name) return
        if (Date.now() < (state.ignoreUntil.get(path) ?? 0)) return
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('file:changed', path)
            log_event(`file changed on disk: ${path}`)
          }
        }, 200)
      })
      state.fileWatchers.set(path, watcher)
      log_event(`watch add: ${path}`)
    } catch (error) {
      log_error(`watch add failed ${path}`, error)
    }
  })

  ipcMain.on('watch:remove', (_event, path: string) => {
    const watcher = state.fileWatchers.get(path)
    if (watcher) {
      try {
        watcher.close()
      } catch {
        /* ignore */
      }
      state.fileWatchers.delete(path)
      log_event(`watch remove: ${path}`)
    }
  })

  // 앱 상태(탭 등) DB 영속화
  ipcMain.handle('app_state:get', (_event, key: string): string | null => {
    return db_get_state(db, key)
  })

  ipcMain.on('app_state:set', (_event, key: string, value: string) => {
    db_set_state(db, key, value)
  })

  // ── YouTube 검색 / 다운로드 ──────────────────────────────────────────────
  ipcMain.handle('youtube:search', async (_event, query: string): Promise<YoutubeResult[]> => {
    log_event(`youtube:search q="${query}"`)
    return youtube_search(query)
  })

  ipcMain.on('youtube:download', (event, url: string, audioFormat: string = 'm4a') => {
    log_event(`youtube:download url=${url} fmt=${audioFormat}`)
    let downloadDir: string
    try {
      const settings = load_settings(settingsPath)
      downloadDir = resolve_download_dir(app_dir(), settings.downloadDirectory)
    } catch {
      downloadDir = resolve_download_dir(app_dir(), '')
    }
    const ytdlpPath = resolve_ytdlp_path(app.isPackaged)
    const ffmpegDir = resolve_ffmpeg_dir(app.isPackaged)
    log_event(`youtube:download dir=${downloadDir} fmt=${audioFormat}`)

    if (!existsSync(ytdlpPath)) {
      event.sender.send('youtube:error', { url, message: 'yt-dlp.exe not found. Run FamilyHub to download it.' })
      return
    }

    youtube_download(
      url,
      downloadDir,
      ytdlpPath,
      ffmpegDir,
      audioFormat,
      (progress: YoutubeProgress) => {
        if (!event.sender.isDestroyed()) event.sender.send('youtube:progress', progress)
      },
      (filePath: string) => {
        log_event(`youtube:done url=${url} file=${filePath}`)
        if (!event.sender.isDestroyed()) event.sender.send('youtube:done', { url, filePath })
      },
      (message: string) => {
        log_event(`youtube:error url=${url} msg=${message}`)
        if (!event.sender.isDestroyed()) {
          event.sender.send('youtube:error', { url, message })
          event.sender.send('notify', { message: `Download failed: ${message}`, type: 'error' })
        }
      }
    ).catch((err: unknown) => log_error('youtube:download unhandled', err))
  })

  ipcMain.on('youtube:cancel', (_event, url: string) => {
    log_event(`youtube:cancel url=${url}`)
    youtube_cancel(url)
  })

  ipcMain.on('youtube:download-video', (event, url: string) => {
    log_event(`youtube:download-video url=${url}`)
    let downloadDir: string
    try {
      const settings = load_settings(settingsPath)
      downloadDir = resolve_download_dir(app_dir(), settings.downloadDirectory)
    } catch {
      downloadDir = resolve_download_dir(app_dir(), '')
    }
    const ytdlpPath = resolve_ytdlp_path(app.isPackaged)
    const ffmpegDir = resolve_ffmpeg_dir(app.isPackaged)

    if (!existsSync(ytdlpPath)) {
      event.sender.send('youtube:error-video', { url, message: 'yt-dlp.exe not found. Run FamilyHub to download it.' })
      return
    }

    youtube_download_video(
      url,
      downloadDir,
      ytdlpPath,
      ffmpegDir,
      (progress: YoutubeProgress) => {
        if (!event.sender.isDestroyed()) event.sender.send('youtube:progress-video', progress)
      },
      (filePath: string) => {
        log_event(`youtube:done-video url=${url} file=${filePath}`)
        if (!event.sender.isDestroyed()) event.sender.send('youtube:done-video', { url, filePath })
      },
      (message: string) => {
        log_event(`youtube:error-video url=${url} msg=${message}`)
        if (!event.sender.isDestroyed()) {
          event.sender.send('youtube:error-video', { url, message })
          event.sender.send('notify', { message: `Video download failed: ${message}`, type: 'error' })
        }
      }
    ).catch((err: unknown) => log_error('youtube:download-video unhandled', err))
  })

  ipcMain.on('youtube:cancel-video', (_event, url: string) => {
    log_event(`youtube:cancel-video url=${url}`)
    youtube_cancel_video(url)
  })

  ipcMain.on('youtube:open-folder', (_event, filePath: string) => {
    let folderPath = filePath
    try {
      if (!statSync(filePath).isDirectory()) folderPath = dirname(filePath)
    } catch {
      folderPath = dirname(filePath)
    }
    shell.openPath(folderPath)
  })

  ipcMain.on('youtube:open-url', (_event, url: string) => {
    shell.openExternal(url)
  })
}

function scan_bins(win: BrowserWindow): void {
  setImmediate(() => {
    try {
      const raw = JSON.parse(readFileSync(join(app_dir(), 'settings.json'), 'utf-8')) as {
        'hub.bins'?: Array<{ exes?: string | string[] }>
      }
      const bins = raw['hub.bins'] ?? []
      const found: Record<string, string> = {}
      for (const bin of bins) {
        const exes = Array.isArray(bin.exes) ? bin.exes : (bin.exes ? [bin.exes] : [])
        for (const exe of exes) {
          const name = basename(exe)
          const p = join(app_dir(), 'bin', name)
          if (existsSync(p)) found[name] = p
        }
      }
      log_event(`bins:ready ${JSON.stringify(Object.keys(found))}`)
      if (!win.isDestroyed()) win.webContents.send('bins:ready', found)
    } catch (err) {
      log_error('scan_bins', err)
      if (!win.isDestroyed()) win.webContents.send('bins:ready', {})
    }
  })
}

function resolve_icon(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(__dirname, '../../../build/icon.ico')
}

function create_window(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    title: 'My Home',
    icon: resolve_icon(),
    show: true,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  const contents = window.webContents
  contents.on('did-finish-load', () => log_event('renderer: did-finish-load'))
  contents.on('did-fail-load', (_e, code, desc, url) =>
    log_event(`renderer: did-fail-load code=${code} desc=${desc} url=${url}`)
  )
  contents.on('render-process-gone', (_e, details) =>
    log_event(`renderer: process-gone reason=${details.reason}`)
  )
  contents.on('preload-error', (_e, path, error) =>
    log_error(`preload-error ${path}`, error)
  )
  contents.on('console-message', (_e, level, message, line, source) =>
    log_event(`console[${level}] ${message} (${source}:${line})`)
  )

  window.on('ready-to-show', () => {
    log_event('window: ready-to-show')
    window.show()
  })

  contents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    log_event(`loadURL ${devUrl}`)
    window.loadURL(devUrl)
  } else {
    const indexHtml = join(__dirname, '../renderer/index.html')
    log_event(`loadFile ${indexHtml}`)
    window.loadFile(indexHtml)
  }

  return window
}

process.on('uncaughtException', (error) => log_event(`uncaughtException: ${error.stack ?? error}`))
process.on('unhandledRejection', (reason) => log_event(`unhandledRejection: ${String(reason)}`))

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  log_event(`app ready. packaged=${app.isPackaged} appDir=${app_dir()}`)

  const dbPath = resolve_db_path()
  const settingsPath = resolve_settings_path()
  log_event(`db path: ${dbPath}`)

  const { db, recreated } = open_db(dbPath)
  if (recreated) {
    log_event(`db version mismatch → recreated: ${dbPath}`)
  }

  // 시작 시 DB 에서 엔트리와 마지막 요약을 즉시 로드 → 검색 바로 가능
  const cachedEntries = db_load_entries(db)
  const cachedSummary = db_load_summary(db)
  log_event(`db loaded: ${cachedEntries.length} entries${recreated ? ' (fresh — schema upgraded)' : ''}`)

  const state: IndexState = {
    entries: cachedEntries,
    fileWatchers: new Map(),
    ignoreUntil: new Map(),
    dirWatchers: new Map(),
    dirUpdateTimers: new Map(),
    currentDirs: [],
    currentExcludePatterns: [],
    currentExcludeSig: '',
    lastSummary: cachedSummary,
    scanning: false
  }

  register_ipc(settingsPath, db, state)
  const win = create_window()
  scan_bins(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      scan_bins(create_window())
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
