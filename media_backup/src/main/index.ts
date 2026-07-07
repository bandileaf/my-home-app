import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell, type WebContents } from 'electron'
import { execFile, execFileSync, spawnSync } from 'child_process'
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, watch, writeFileSync } from 'fs'
import { stat } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import { load_settings } from './services/settings'
import { parse as parse_jsonc } from 'jsonc-parser'
import {
  resolve_download_dir,
  resolve_ytdlp_path,
  resolve_ffmpeg_dir,
  youtube_search,
  youtube_download,
  youtube_download_video,
  youtube_cancel,
  youtube_cancel_video,
  youtube_cancel_all,
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
import { ensure_bins, installed_bins, list_bins, read_bin_entries, type BinState, type BinStatusEntry } from './services/bins'
import { run_update_check } from '@shared/update'
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
  binsPromise: Promise<Record<string, string>> | null
  // 현재까지의 bin 설치 상태 스냅샷 — 렌더러가 늦게 마운트돼도 'bins:snapshot' 으로 즉시 조회 가능
  binStatus: BinStatusEntry[]
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
      _log_path = join(logDir, `${app.getName()}.log`)
    }
    appendFileSync(_log_path, `[${new Date().toISOString()}] ${message}\n`, { encoding: 'utf8' })
  } catch {
    // ignore
  }
}

let _display_name: string | null = null

function resolve_display_name(settingsPath: string): string {
  if (app.isPackaged && process.env.PORTABLE_EXECUTABLE_FILE) {
    return basename(process.env.PORTABLE_EXECUTABLE_FILE, '.exe')
  }
  try {
    const raw = parse_jsonc(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>
    const exeName = raw[`hub.app.${app.getName()}.name`] as string | undefined
    if (exeName) return basename(exeName, '.exe')
  } catch { /* ignore */ }
  return app.getName()
}

function init_log_path(settingsPath: string): void {
  _display_name = resolve_display_name(settingsPath)
  try {
    const logDir = join(app_dir(), 'log')
    mkdirSync(logDir, { recursive: true })
    _log_path = join(logDir, `${_display_name}.log`)
    const BUILD_NUMBER = 8
    appendFileSync(_log_path, `\n[${new Date().toISOString()}] SESSION START pid=${process.pid} build=${BUILD_NUMBER}\n`, { encoding: 'utf8' })
  } catch {
    // fallback: lazy init in log_event will set it
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

function resolve_db_path(settingsPath: string): string {
  try {
    const raw = parse_jsonc(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>
    const key = `hub.app.${app.getName()}.db`
    const dbFile = typeof raw[key] === 'string' ? (raw[key] as string) : 'indexing.db'
    return join(app_dir(), dbFile)
  } catch {
    return join(app_dir(), 'indexing.db')
  }
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
        log_event(`index: ${dir} — up to date, no rescan needed`)
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
      excludePatterns: state.currentExcludePatterns,
      rootDirs: state.currentDirs,
    })
    log_event(`search q="${query}" entries=${state.entries.length} total=${result.total}`)
    return result
  })

  ipcMain.on('file:reveal', (_event, fullPath: string) => {
    shell.showItemInFolder(fullPath)
  })

  ipcMain.on('file:copyFile', (event, fullPath: string) => {
    try {
      const q = fullPath.replace(/'/g, "''")
      execFileSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
        '-Command', `Set-Clipboard -LiteralPath '${q}'`,
      ], { windowsHide: true })
      log_event(`file:copyFile ok [${fullPath}]`)
    } catch (err: unknown) {
      const msg = (err as Error).message
      log_event(`file:copyFile 오류 [${fullPath}]: ${msg}`)
      notify_renderer(event.sender, `파일 복사 실패: ${msg}`, 'error')
    }
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
    const ytdlpPath = resolve_ytdlp_path(app_dir())
    const ffmpegDir = resolve_ffmpeg_dir(app_dir())
    const ytdlpExists = existsSync(ytdlpPath)
    log_event(`youtube:download dir=${downloadDir} fmt=${audioFormat} ytdlp=${ytdlpPath} exists=${ytdlpExists}`)

    if (!ytdlpExists) {
      event.sender.send('youtube:error', { url, message: '실행 환경이 구성되지 않았습니다. 잠시 후 다시 시도하세요.' })
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
      },
      (msg: string) => log_event(msg)
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
    const ytdlpPath = resolve_ytdlp_path(app_dir())
    const ffmpegDir = resolve_ffmpeg_dir(app_dir())
    const ytdlpExists = existsSync(ytdlpPath)
    log_event(`youtube:download-video ytdlp=${ytdlpPath} exists=${ytdlpExists}`)

    if (!ytdlpExists) {
      event.sender.send('youtube:error-video', { url, message: '실행 환경이 구성되지 않았습니다. 잠시 후 다시 시도하세요.' })
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
      },
      (msg: string) => log_event(msg)
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

  // ── Convert ──────────────────────────────────────────────────────────────
  const CONVERTIBLE = new Set(['mp3','flac','wav','aac','m4a','ogg','opus','wma','ape','mp4','mkv','avi','mov','wmv','webm','m4v'])
  let convert_scan_id = 0

  ipcMain.handle('convert:pick-folder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return canceled ? null : filePaths[0]
  })

  type ScanResult = { path: string; needsFix?: boolean; fixMessage?: string }

  function find_mp3val_exe(binDir: string): string | null {
    const p = join(binDir, 'mp3val.exe')
    return existsSync(p) ? p : null
  }

  function run_mp3val_check(mp3valPath: string, filePath: string): Promise<string> {
    return new Promise((resolve) => {
      try {
        execFile(mp3valPath, [filePath], (err, stdout) => {
          if (err && !stdout) { resolve(''); return }
          const lines = (stdout ?? '').split('\n')
            .filter(l => /^WARNING:/i.test(l.trim()))
            .filter(l => !/no supported tags/i.test(l))
            .map(l => l.replace(/^WARNING:\s*"[^"]*":\s*/i, '').trim())
          resolve(lines.join(' | '))
        })
      } catch { resolve('') }
    })
  }

  ipcMain.handle('convert:scan-folder', async (event, dir: string, targetExt: string): Promise<ScanResult[]> => {
    const myId = ++convert_scan_id
    const target = targetExt.toLowerCase().replace(/^\./, '')
    const toConvert: string[] = []
    const mp3Files: string[] = []
    const scan = (d: string): void => {
      let names: string[]
      try { names = readdirSync(d) } catch { return }
      for (const name of names) {
        const full = join(d, name)
        let isDir = false
        try { isDir = statSync(full).isDirectory() } catch { continue }
        if (isDir) { scan(full); continue }
        const ext = extname(name).slice(1).toLowerCase()
        if (CONVERTIBLE.has(ext) && ext !== target) toConvert.push(full)
        else if (target === 'mp3' && ext === 'mp3') mp3Files.push(full)
      }
    }
    const bakFiles: string[] = []
    const scanDir = (d: string): void => {
      let names: string[]
      try { names = readdirSync(d) } catch { return }
      for (const name of names) {
        const full = join(d, name)
        let isDir = false
        try { isDir = statSync(full).isDirectory() } catch { continue }
        if (isDir) { scanDir(full); continue }
        if (name.toLowerCase().endsWith('.bak')) bakFiles.push(full)
      }
    }
    scan(dir)
    scanDir(dir)
    for (const p of bakFiles) {
      if (myId !== convert_scan_id) return []
      event.sender.send('convert:scan-item', { path: p, isBak: true })
    }
    for (const p of toConvert) {
      if (myId !== convert_scan_id) return []
      event.sender.send('convert:scan-item', { path: p })
    }
    if (target === 'mp3' && mp3Files.length > 0) {
      const mp3valPath = find_mp3val_exe(join(app_dir(), 'bin'))
      if (!mp3valPath) {
        log_event('convert:scan-folder mp3val not found')
      } else {
        const total = mp3Files.length
        for (let i = 0; i < total; i++) {
          if (myId !== convert_scan_id) return []
          const p = mp3Files[i]
          event.sender.send('convert:scan-progress', { current: i, total })
          const warnings = await run_mp3val_check(mp3valPath, p)
          if (myId !== convert_scan_id) return []
          if (warnings) {
            event.sender.send('convert:scan-item', { path: p, needsFix: true, fixMessage: warnings })
          }
        }
        if (myId !== convert_scan_id) return []
        event.sender.send('convert:scan-progress', { current: total, total })
      }
    }
    return []
  })

  const active_converts = new Map<string, () => void>()

  function find_ffmpeg_exe(binDir: string): string | null {
    const candidates = [
      join(binDir, 'ffmpeg.exe'),
      join(binDir, 'ffmpeg-master-latest-win64-gpl', 'bin', 'ffmpeg.exe'),
    ]
    for (const p of candidates) { if (existsSync(p)) return p }
    return null
  }

  function ffmpeg_args(src: string, dest: string, fmt: string): string[] {
    const base = ['-i', src, '-y']
    if (fmt === 'mp3')  return [...base, '-c:a', 'libmp3lame', '-q:a', '0', dest]
    if (fmt === 'flac') return [...base, dest]
    if (fmt === 'mp4')  return [...base, '-c:v', 'copy', '-c:a', 'aac', dest]
    return [...base, dest]
  }

  function parse_secs(t: string): number {
    const p = t.split(':').map(parseFloat)
    return (p[0] ?? 0) * 3600 + (p[1] ?? 0) * 60 + (p[2] ?? 0)
  }

  ipcMain.on('convert:start', (event, srcPath: string, targetFmt: string, deleteOriginal: boolean, needsFix: boolean, fixMessage?: string) => {
    if (needsFix) {
      const src_ext = extname(srcPath)
      const destPath = deleteOriginal
        ? srcPath
        : srcPath.slice(0, srcPath.length - src_ext.length) + '-수정완료' + src_ext
      const isVbr = /VBR/i.test(fixMessage ?? '')
      log_event(`convert:start needsFix deleteOriginal=${deleteOriginal} isVbr=${isVbr} src=[${srcPath}] dest=[${destPath}]`)
      if (isVbr) {
        const ffmpegPath = find_ffmpeg_exe(resolve_ffmpeg_dir(app_dir()))
        if (!ffmpegPath) {
          log_event(`convert:start ffmpeg 없음 [${srcPath}]`)
          event.sender.send('convert:error', { srcPath, message: 'ffmpeg를 찾을 수 없습니다.' })
          return
        }
        try {
          const tmpPath = destPath + '.tmp'
          // srcPath 를 항상 input 으로 읽음
          // deleteOriginal=false: ffmpeg -i srcPath -c:a copy -y destPath.tmp → rename → destPath (원본 보존)
          // deleteOriginal=true:  ffmpeg -i srcPath -c:a copy -y srcPath.tmp  → delete srcPath → rename (원본 교체)
          const ffResult = spawnSync(ffmpegPath, ['-i', srcPath, '-c:a', 'copy', '-f', 'mp3', '-y', tmpPath], { windowsHide: true })
          const ffLog = [ffResult.stdout, ffResult.stderr].map(b => b?.toString('utf8') ?? '').filter(Boolean).join('\n')
          if (ffLog) log_event(`convert:start VBR ffmpeg 출력 [${srcPath}]:\n${ffLog}`)
          if (ffResult.error) throw ffResult.error
          if (ffResult.status !== 0) throw new Error(`ffmpeg 종료코드 ${ffResult.status}`)
          if (deleteOriginal) unlinkSync(srcPath)
          const { renameSync } = require('fs') as typeof import('fs')
          renameSync(tmpPath, destPath)
          event.sender.send('convert:progress', { srcPath, percent: 100 })
          event.sender.send('convert:done', { srcPath, destPath })
        } catch (err: unknown) {
          const msg = (err as Error).message
          log_event(`convert:start VBR ffmpeg 오류 [${srcPath}]: ${msg}`)
          event.sender.send('convert:error', { srcPath, message: msg })
        }
      } else {
        // 스트림 오류 등 → mp3val -f -nb 로 수정 후 재검사
        const mp3valPath = find_mp3val_exe(join(app_dir(), 'bin'))
        if (!mp3valPath) {
          log_event(`convert:start mp3val 없음 [${srcPath}]`)
          event.sender.send('convert:error', { srcPath, message: 'mp3val을 찾을 수 없습니다.' })
          return
        }
        try {
          if (!deleteOriginal) copyFileSync(srcPath, destPath)
          const mp3Result = spawnSync(mp3valPath, ['-f', '-nb', destPath], { windowsHide: true })
          const mp3Log = [mp3Result.stdout, mp3Result.stderr].map(b => b?.toString('utf8') ?? '').filter(Boolean).join('\n')
          if (mp3Log) log_event(`convert:start mp3val 출력 [${srcPath}]:\n${mp3Log}`)
          if (mp3Result.error) throw mp3Result.error
          run_mp3val_check(mp3valPath, destPath).then(remaining => {
            if (remaining) log_event(`convert:start mp3val 재검사 후 경고 잔존 [${destPath}]: ${remaining}`)
          })
          event.sender.send('convert:progress', { srcPath, percent: 100 })
          event.sender.send('convert:done', { srcPath, destPath })
        } catch (err: unknown) {
          const msg = (err as Error).message
          log_event(`convert:start mp3val 오류 [${srcPath}]: ${msg}`)
          event.sender.send('convert:error', { srcPath, message: msg })
        }
      }
      return
    }
    const ffmpegPath = find_ffmpeg_exe(resolve_ffmpeg_dir(app_dir()))
    if (!ffmpegPath) {
      log_event(`convert:start ffmpeg 없음 [${srcPath}]`)
      event.sender.send('convert:error', { srcPath, message: 'ffmpeg를 찾을 수 없습니다. 먼저 YouTube 패널에서 도구를 설치해주세요.' })
      return
    }
    const src_ext = extname(srcPath)
    const destPath = srcPath.slice(0, srcPath.length - src_ext.length) + '.' + targetFmt
    log_event(`convert:start [${srcPath}] → [${destPath}]`)
    const { spawn: sp } = require('child_process') as typeof import('child_process')
    const proc = sp(ffmpegPath, ffmpeg_args(srcPath, destPath, targetFmt), { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    active_converts.set(srcPath, () => proc.kill())
    let duration = 0
    let stderr = ''
    proc.stderr.on('data', (data: Buffer) => {
      const text = data.toString('utf8')
      stderr += text
      const dm = text.match(/Duration:\s*(\d+:\d+:\d+\.\d+)/)
      if (dm) duration = parse_secs(dm[1])
      const tm = text.match(/time=(\d+:\d+:\d+\.\d+)/)
      if (tm && duration > 0) {
        const pct = Math.min(99, Math.round(parse_secs(tm[1]) / duration * 100))
        event.sender.send('convert:progress', { srcPath, percent: pct })
      }
    })
    proc.on('close', (code) => {
      active_converts.delete(srcPath)
      if (code === 0) {
        if (deleteOriginal) try { unlinkSync(srcPath) } catch { /* ignore */ }
        event.sender.send('convert:done', { srcPath, destPath })
      } else {
        log_event(`convert:start ffmpeg 종료코드 ${code} [${srcPath}]: ${stderr.slice(-500)}`)
        event.sender.send('convert:error', { srcPath, message: stderr.slice(-300) })
      }
    })
    proc.on('error', (err: Error) => {
      log_event(`convert:start ffmpeg spawn 오류 [${srcPath}]: ${err.message}`)
      event.sender.send('convert:error', { srcPath, message: err.message })
    })
  })

  ipcMain.on('convert:cancel', (_event, srcPath: string) => {
    active_converts.get(srcPath)?.()
    active_converts.delete(srcPath)
  })

  ipcMain.on('convert:delete-file', (event, filePath: string) => {
    try {
      unlinkSync(filePath)
      log_event(`convert:delete-file [${filePath}]`)
      event.sender.send('convert:file-deleted', { path: filePath })
    } catch (err: unknown) {
      log_event(`convert:delete-file 오류 [${filePath}]: ${(err as Error).message}`)
    }
  })

}

// state.binStatus 에 있는 항목 하나를 갱신한다 (렌더러가 늦게 마운트돼도 'bins:snapshot' 으로 항상 최신 상태 조회 가능).
function update_bin_status(state: IndexState, name: string, patch: Partial<BinStatusEntry>): void {
  const row = state.binStatus.find((r) => r.name === name)
  if (row) Object.assign(row, patch)
}

// bin 설치(yt-dlp, ffmpeg 등)는 한 번만 진행하고, 동시 호출은 같은 promise 를 공유한다.
function ensure_bins_once(
  sender: WebContents,
  baseDir: string,
  settingsPath: string,
  state: IndexState
): Promise<Record<string, string>> {
  if (!state.binsPromise) {
    state.binStatus = list_bins(baseDir, settingsPath)
    log_event(`bins: initial status — ${state.binStatus.map(b => `${b.name}:${b.state}`).join(', ') || 'none (settings unreadable?)'}`)
    state.binsPromise = ensure_bins(
      baseDir,
      settingsPath,
      (name, binState: BinState) => {
        update_bin_status(state, name, { state: binState, ...(binState === 'installed' ? { percent: 100 } : {}) })
        if (!sender.isDestroyed()) sender.send('bins:status', { name, state: binState })
      },
      (name, percent) => {
        update_bin_status(state, name, { percent })
        if (!sender.isDestroyed()) sender.send('bins:progress', { name, percent })
      },
      log_event
    )
      .then(() => {
        const result = installed_bins(baseDir, read_bin_entries(settingsPath))
        log_event(`ensure_bins done: ${JSON.stringify(Object.keys(result))}`)
        if (!sender.isDestroyed()) sender.send('bins:done', result)
        return result
      })
      .catch((err: unknown) => {
        log_error('ensure_bins', err)
        if (!sender.isDestroyed()) {
          notify_renderer(sender, err instanceof Error ? err.message : String(err), 'error')
        }
        state.binsPromise = null // 실패 시 다음 호출에서 재시도
        return installed_bins(baseDir, read_bin_entries(settingsPath))
      })
  }
  return state.binsPromise
}

function resolve_icon(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(__dirname, '../../../build/icon.ico')
}

function create_toast_window(): BrowserWindow {
  log_event('toast: creating notification window')
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const W = 420, H = 130
  const toast = new BrowserWindow({
    width: W, height: H,
    x: width - W - 16, y: height - H - 24,
    frame: false, transparent: true,
    backgroundColor: '#00000000',
    skipTaskbar: true, alwaysOnTop: true,
    resizable: false, movable: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/toast.js'),
      contextIsolation: true,
    }
  })
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) toast.loadURL(`${devUrl}/toast.html`)
  else toast.loadFile(join(__dirname, '../renderer/toast.html'))
  return toast
}

function app_display_name(): string {
  return _display_name ?? app.getName()
}

function create_window(): BrowserWindow {
  log_event(`window: creating — title="${app_display_name()}"`)
  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    title: app_display_name(),
    icon: resolve_icon(),
    show: true,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  window.on('page-title-updated', (e) => e.preventDefault())

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

// --post-update: launched by update.bat — skip lock check (old process is dead, OS mutex may not have released yet)
const isPostUpdate = process.argv.includes('--post-update')
const got_lock = isPostUpdate || app.requestSingleInstanceLock()
if (!got_lock) {
  try {
    const logDir = join(app.isPackaged
      ? (process.env.PORTABLE_EXECUTABLE_DIR ?? dirname(app.getPath('exe')))
      : process.cwd(), 'log')
    mkdirSync(logDir, { recursive: true })
    const logPath = join(logDir, `${basename(process.execPath, '.exe')}.log`)
    appendFileSync(logPath, `\n[${new Date().toISOString()}] DUPLICATE LAUNCH rejected pid=${process.pid} argv=${JSON.stringify(process.argv)}\n`, { encoding: 'utf8' })
  } catch { /* ignore */ }
  app.quit()
  process.exit(0)
}

app.on('second-instance', (_event, argv, cwd) => {
  log_event(`second-instance: argv=${JSON.stringify(argv)} cwd=${cwd}`)
  const [win] = BrowserWindow.getAllWindows()
  if (win) { if (win.isMinimized()) win.restore(); win.focus() }
})

app.whenReady().then(() => {
  if (!got_lock) return
  Menu.setApplicationMenu(null)
  const settingsPath = resolve_settings_path()
  init_log_path(settingsPath)
  log_event(`app ready. packaged=${app.isPackaged} appDir=${app_dir()} argv=${JSON.stringify(process.argv)}`)
  const dbPath = resolve_db_path(settingsPath)
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
    scanning: false,
    binsPromise: null,
    binStatus: []
  }

  register_ipc(settingsPath, db, state)
  ipcMain.handle('bins:ensure', (event) => ensure_bins_once(event.sender, app_dir(), settingsPath, state))
  ipcMain.handle('bins:snapshot', (): BinStatusEntry[] => {
    log_event(`bins:snapshot → [${state.binStatus.map(b => `${b.name}:${b.state}`).join(', ') || 'empty'}]`)
    return state.binStatus
  })
  ipcMain.handle('app:name', (): string => app_display_name())

  const toast = create_toast_window()
  ipcMain.on('toast:close',    () => toast.hide())
  ipcMain.on('toast:open-log', () => { if (_log_path) void shell.openPath(_log_path) })

  const window = create_window()
  // 메인 창이 닫히면 toast 도 함께 제거 → window-all-closed 발생 → app.quit()
  window.on('closed', () => {
    log_event('window: closed')
    if (!toast.isDestroyed()) {
      log_event('toast: destroying (window closed)')
      toast.destroy()
    }
  })
  void ensure_bins_once(window.webContents, app_dir(), settingsPath, state)

  // 메인 창과 toast 가 모두 준비된 후에 업데이트 체크 시작
  // → 메인 창이 먼저 보인 뒤 toast 가 나타난다
  let toastReady = false
  let winReady = false
  const start_update = (): void => {
    if (!toastReady || !winReady) return
    log_event('update: starting check (window + toast both ready)')
    void run_update_check(
      { baseDir: app_dir(), settingsPath, appKey: 'hub.media.zip' },
      {
        set_status: (msg) => { toast.webContents.send('toast:status', msg); if (!toast.isVisible()) toast.show() },
        set_progress: (pct) => { toast.webContents.send('toast:progress', pct) },
        on_error:  (msg) => { toast.webContents.send('toast:error', msg); toast.show() },
        on_quit:   () => app.quit(),
        log:       log_event,
      }
    )
  }
  toast.webContents.once('did-finish-load', () => { toastReady = true; start_update() })
  window.webContents.once('did-finish-load', () => { winReady = true; start_update() })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().filter(w => w !== toast).length === 0) create_window()
  })

  app.on('before-quit', () => {
    log_event('app: before-quit')
    youtube_cancel_all()
    for (const w of state.dirWatchers.values())  w.close()
    for (const w of state.fileWatchers.values()) w.close()
    for (const t of state.dirUpdateTimers.values()) clearTimeout(t)
    db.close()
  })
})

app.on('window-all-closed', () => {
  log_event('app: window-all-closed')
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
