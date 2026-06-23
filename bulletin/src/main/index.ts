import { app, BrowserWindow, ipcMain, Menu, screen, shell, Tray } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'path'
import { release, arch } from 'os'
import { parse as parse_jsonc } from 'jsonc-parser'
import { load_identity, type Identity } from './services/identity'
import {
  init_supabase,
  list_notices,
  create_notice,
  create_reply,
  update_notice,
  cast_vote,
  list_users,
  upsert_user,
  update_app_info,
  save_user_alias,
  get_user_avatar,
  save_user_avatar,
  set_user_offline,
  list_messages,
  send_message,
  delete_message,
  has_unread,
  add_reader,
  subscribe_chat,
  subscribe_notices,
  list_schedules,
  create_schedule,
  delete_schedule,
  type AppInfo,
} from './services/store'
import { run_update_check } from '@shared/update'
import { start_control_server } from './services/control'
import { scan_subnet, send_command, fetch_client_settings, fetch_client_log, get_local_ip } from './services/admin'

function app_dir(): string {
  if (app.isPackaged) {
    return process.env.PORTABLE_EXECUTABLE_DIR ?? dirname(app.getPath('exe'))
  }
  return process.cwd()
}

let _log_path: string | null = null
let _log_fresh = true

function log_event(message: string): void {
  try {
    if (!_log_path) {
      const logDir = join(app_dir(), 'log')
      mkdirSync(logDir, { recursive: true })
      _log_path = join(logDir, `${app.getName()}.log`)
    }
    const line = `[${new Date().toISOString()}] ${message}\n`
    if (_log_fresh) {
      writeFileSync(_log_path, line)
      _log_fresh = false
    } else {
      appendFileSync(_log_path, line)
    }
  } catch { /* ignore */ }
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
    appendFileSync(_log_path, `\n[${new Date().toISOString()}] SESSION START pid=${process.pid} build=${BUILD_NUMBER}\n`)
  } catch { /* fallback: lazy init in log_event */ }
}

function resolve_icon(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(__dirname, '../../build/icon.ico')
}

let win: BrowserWindow | null = null
let tray: Tray | null = null

const TOAST_W = 420
const TOAST_ITEM_H = 72
const TOAST_MAX = 8

function create_toast_window(): BrowserWindow {
  log_event('toast: creating notification window')
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const toast = new BrowserWindow({
    width: TOAST_W, height: TOAST_ITEM_H * TOAST_MAX,
    x: width - TOAST_W - 16, y: height - TOAST_ITEM_H * TOAST_MAX - 24,
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

function create_window(appInfo: AppInfo = {}, show = false): BrowserWindow {
  log_event(`window: creating — title="${app_display_name()}"`)
  const window = new BrowserWindow({
    width:  appInfo.width  ?? 1280,
    height: appInfo.height ?? 800,
    frame: false,
    title: app_display_name(),
    icon: resolve_icon(),
    show,
    autoHideMenuBar: true,
    backgroundColor: '#faf9fc',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  window.on('page-title-updated', (e) => e.preventDefault())
  window.on('close', () => {
    log_event('window: close')
    app.quit()
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) window.loadURL(devUrl)
  else window.loadFile(join(__dirname, '../renderer/index.html'))

  return window
}

function create_tray(window: BrowserWindow): Tray {
  const t = new Tray(resolve_icon())
  t.setToolTip(app_display_name())
  t.setContextMenu(
    Menu.buildFromTemplate([
      { label: '열기', click: () => window.show() },
      { type: 'separator' },
      { label: '종료', click: () => app.quit() }
    ])
  )
  t.on('click',        () => window.show())
  t.on('double-click', () => window.show())
  return t
}

function app_display_name(): string {
  return _display_name ?? app.getName()
}

function log_error(label: string, e: unknown): void {
  let msg: string
  if (e instanceof Error) {
    msg = e.stack ?? e.message
  } else if (e && typeof e === 'object') {
    msg = JSON.stringify(e)
  } else {
    msg = String(e)
  }
  log_event(`[ERROR] ${label}: ${msg}`)
}

function register_ipc(identity: Identity, settingsPath: string): void {
  ipcMain.on('window:close',       () => win?.hide())
  ipcMain.on('window:minimize',    () => win?.hide())
  ipcMain.handle('app:has_settings', () => existsSync(settingsPath))
  ipcMain.handle('app:disabled',     () => _disabled)
  ipcMain.handle('app:name',     (): string => app_display_name())
  ipcMain.handle('identity:get', (): Identity & { userId: string | null } => ({ ...identity, userId: _my_user_id }))
  ipcMain.handle('user:alias',  (): string | null => _alias)
  ipcMain.handle('user:avatar', async (): Promise<string | null> => {
    try { return await get_user_avatar(_my_user_id!) }
    catch (e) { log_error('user:avatar', e); return null }
  })
  ipcMain.handle('user:save_profile', async (_e, alias: string | null, avatar: string | null) => {
    _alias = alias
    try {
      await Promise.all([
        save_user_alias(_my_user_id!, alias),
        save_user_avatar(_my_user_id!, avatar),
      ])
      log_event(`profile saved alias=${alias ?? 'null'} avatar=${avatar ? `${Math.round(avatar.length / 1024)}KB` : 'null'}`)
    } catch (e) { log_error('user:save_profile', e) }
  })
  let _notice_list_count = 0
  ipcMain.handle('notice:list', async () => {
    _notice_list_count++
    log_event(`ipc: notice:list #${_notice_list_count}`)
    try { return await list_notices() }
    catch (e) { log_error('notice:list', e); return [] }
  })
  ipcMain.handle('notice:create', async (_event, text: string, kind: string) => {
    try { return await create_notice(_my_user_id!, text, (kind as 'sticker' | 'reply_request' | 'vote') ?? 'sticker') }
    catch (e) { log_error('notice:create', e); return null }
  })
  ipcMain.handle('notice:reply', async (_event, noticeId: string, text: string) => {
    try { await create_reply(noticeId, _my_user_id!, text) }
    catch (e) { log_error('notice:reply', e) }
  })
  ipcMain.handle('notice:update', async (_event, noticeId: string, text: string) => {
    try { await update_notice(noticeId, text) }
    catch (e) { log_error('notice:update', e) }
  })
  ipcMain.handle('notice:vote', async (_event, noticeId: string, vote: 'yes' | 'no') => {
    try { await cast_vote(noticeId, _my_user_id!, vote) }
    catch (e) { log_error('notice:vote', e) }
  })
  let _user_list_count = 0
  ipcMain.handle('user:list', async () => {
    _user_list_count++
    log_event(`ipc: user:list #${_user_list_count}`)
    try { return await list_users() }
    catch (e) { log_error('user:list', e); return [] }
  })
  ipcMain.handle('chat:list', async () => {
    try { return await list_messages() }
    catch (e) { log_error('chat:list', e); return [] }
  })
  ipcMain.handle('chat:send', async (_event, text: string) => {
    try { await send_message(_my_user_id!, text) }
    catch (e) { log_error('chat:send', e) }
  })
  ipcMain.handle('chat:delete', async (_event, id: string) => {
    try { await delete_message(id, _my_user_id!) }
    catch (e) { log_error('chat:delete', e) }
  })
  ipcMain.handle('chat:has_unread', async () => {
    try { return await has_unread(_my_user_id!) }
    catch (e) { log_error('chat:has_unread', e); return false }
  })
  ipcMain.handle('chat:add_reader', async () => {
    try { await add_reader(_my_user_id!) }
    catch (e) { log_error('chat:add_reader', e) }
  })
  ipcMain.handle('schedule:list', async () => {
    try { return await list_schedules() }
    catch (e) { log_error('schedule:list', e); return [] }
  })
  ipcMain.handle('schedule:create', async (_e, userId: string, title: string, date: string, endDate: string | null, allDay: boolean, startTime: string | null, endTime: string | null, repeatWeekly: boolean, repeatMonthly: boolean, memo: string | null, color: string) => {
    try { await create_schedule(userId, title, date, endDate, allDay, startTime, endTime, repeatWeekly, repeatMonthly, memo, color) }
    catch (e) { log_error('schedule:create', e) }
  })
  ipcMain.handle('schedule:delete', async (_e, id: string) => {
    try { await delete_schedule(id, _my_user_id!) }
    catch (e) { log_error('schedule:delete', e) }
  })
  ipcMain.handle('admin:local_ip', () => get_local_ip())
  ipcMain.handle('admin:is_enabled', () => _is_admin)
  ipcMain.handle('admin:get_settings', () => {
    try { return readFileSync(settingsPath, 'utf-8') } catch { return '{}' }
  })
  ipcMain.handle('admin:scan', async () => {
    try {
      log_event('admin:scan 시작')
      const result = await scan_subnet((ip) => win?.webContents.send('admin:scan_ip', ip))
      log_event(`admin:scan 완료 — ${result.length}개 발견: ${result.map(c => `${c.hostname}(${c.ip})`).join(', ')}`)
      return result
    }
    catch (e) { log_error('admin:scan', e); return [] }
  })
  ipcMain.handle('admin:command', async (_e, ip: string, path: string, body?: unknown) => {
    try { return await send_command(ip, path, body) }
    catch (e) { log_error('admin:command', e); return { ok: false, error: String(e) } }
  })
  ipcMain.handle('admin:fetch_settings', async (_e, ip: string) => {
    try { return await fetch_client_settings(ip) }
    catch (e) { log_error('admin:fetch_settings', e); return null }
  })
  ipcMain.handle('admin:fetch_log', async (_e, ip: string) => {
    try { return await fetch_client_log(ip) }
    catch (e) { log_error('admin:fetch_log', e); return null }
  })
}

// --post-update: launched by update.bat — skip lock check (old process is dead, OS mutex may not have released yet)
const isPostUpdate = process.argv.includes('--post-update') || process.argv.includes('--post-restart')
const got_lock = isPostUpdate || app.requestSingleInstanceLock()
if (!got_lock) {
  try {
    const logDir = join(app.isPackaged
      ? (process.env.PORTABLE_EXECUTABLE_DIR ?? dirname(app.getPath('exe')))
      : process.cwd(), 'log')
    mkdirSync(logDir, { recursive: true })
    const logPath = join(logDir, `${basename(process.execPath, '.exe')}.log`)
    appendFileSync(logPath, `\n[${new Date().toISOString()}] DUPLICATE LAUNCH rejected pid=${process.pid} argv=${JSON.stringify(process.argv)}\n`)
  } catch { /* ignore */ }
  app.quit()
  process.exit(0)
}

app.on('second-instance', (_event, argv, cwd) => {
  log_event(`second-instance: argv=${JSON.stringify(argv)} cwd=${cwd}`)
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus() }
})

let _identity: ReturnType<typeof load_identity> | null = null
let _my_user_id: string | null = null
let _appInfo: AppInfo = {}
let _alias: string | null = null
let _offline_done = false
let _disabled = false
let _is_admin = false
let _db_check_ms = 5000
let _hub_tag: string | null = null

app.whenReady().then(async () => {
  if (!got_lock) return
  Menu.setApplicationMenu(null)
  const baseDir = app_dir()
  const settingsPath = join(baseDir, 'settings.json')
  init_log_path(settingsPath)
  const argv = process.argv
  const reason_flag = argv.find(a => a.startsWith('--reason='))?.slice('--reason='.length) ?? null
  const startup_reason =
    argv.includes('--autostart')                          ? 'PC 부팅 자동 실행' :
    argv.includes('--post-update')                        ? '업데이트 완료 재시작' :
    reason_flag === 'remote-restart'                      ? '원격 재시작' :
    reason_flag === 'remote-update'                       ? '원격 업데이트 재시작' :
    argv.includes('--post-restart')                       ? '재시작' :
                                                            '수동 실행'
  log_event(`startup-reason: ${startup_reason}`)
  log_event(`app ready. packaged=${app.isPackaged} appDir=${baseDir} argv=${JSON.stringify(argv)}`)
  log_event(`os: Windows ${release()} arch=${arch()} portable_file=${process.env.PORTABLE_EXECUTABLE_FILE ?? '(none)'} portable_dir=${process.env.PORTABLE_EXECUTABLE_DIR ?? '(none)'}`)
  const identity = load_identity()
  _identity = identity
  log_event(`identity: deviceId=${identity.deviceId} hostname=${identity.hostname} mac=[${identity.macAddresses.join(', ')}] ip=${identity.ip ?? 'null'}`)

  const has_settings = existsSync(settingsPath)
  log_event(`settings.json: ${has_settings ? '있음' : '없음 — 관리자 대기 모드'}`)

  // 제어서버는 settings 유무 무관하게 항상 시작
  const toast = create_toast_window()
  ipcMain.on('toast:close',     () => { if (_chat_hide_timer) { clearTimeout(_chat_hide_timer); _chat_hide_timer = null } toast.hide() })
  ipcMain.on('toast:open-log',  () => { if (_log_path) void shell.openPath(_log_path) })
  ipcMain.on('toast:open-main', () => { win?.show(); win?.focus(); win?.webContents.send('window:open-chat'); toast.hide() })

  let _chat_hide_timer: ReturnType<typeof setTimeout> | null = null
  function show_chat_notification(sender: string, text: string): void {
    toast.webContents.send('toast:chat', sender, text)
    if (!toast.isVisible()) toast.show()
    if (_chat_hide_timer) clearTimeout(_chat_hide_timer)
    _chat_hide_timer = setTimeout(() => { _chat_hide_timer = null; toast.hide() }, 7700)
  }

  const update_callbacks = {
    set_status:   (msg: string) => { toast.webContents.send('toast:status', msg); if (!toast.isVisible()) toast.show() },
    set_progress: (pct: number) => { toast.webContents.send('toast:progress', pct) },
    on_error:     (msg: string) => { toast.webContents.send('toast:error', msg); toast.show() },
    on_quit:      () => app.quit(),
    log:          log_event,
  }

  register_ipc(identity, settingsPath)

  start_control_server({
    deviceId: identity.deviceId,
    hostname: identity.hostname,
    settingsPath,
    logPath: () => _log_path,
    has_settings: () => existsSync(settingsPath),
    is_disabled: () => _disabled,
    is_admin: () => _is_admin,
    on_update: () => void run_update_check({ baseDir, settingsPath, appKey: 'hub.bulletin.zip' }, update_callbacks),
    log: log_event,
  })

  if (!has_settings) {
    win = create_window({}, true)
    tray = create_tray(win)
    log_event('no settings: waiting for admin to push settings.json')
    return
  }

  // settings.json 있음 — 정상 초기화
  try {
    const raw = parse_jsonc(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>
    const url = raw['hub.supabase.url'] as string | undefined
    const key = raw['hub.supabase.key'] as string | undefined
    _is_admin = raw['hub.app.bulletin.admin'] === true
    const dbCheckMin = typeof raw['hub.bulletin.poll-min'] === 'number'
      ? (raw['hub.bulletin.poll-min'] as number)
      : 10
    _db_check_ms = Math.max(5000, Math.round(dbCheckMin * 60 * 1000))
    _hub_tag = typeof raw['hub.tag'] === 'string' ? (raw['hub.tag'] as string) : null
    const autostart = raw['hub.app.bulletin.autostart'] === true
    const exePath = process.env.PORTABLE_EXECUTABLE_FILE ?? app.getPath('exe')
    app.setLoginItemSettings({ openAtLogin: autostart, path: exePath, args: ['--autostart'] })
    log_event(`autostart: ${autostart}`)

    _disabled = raw['hub.disabled'] === true && !_is_admin
    if (_disabled) {
      log_event('hub.disabled=true — 기능 정지 모드, admin 대기')
      win = create_window({}, true)
      tray = create_tray(win)
      return
    }

    log_event(`supabase init: url=${url ?? '(없음)'} key=${key ? key.slice(0, 8) + '…' : '(없음)'} admin=${_is_admin}`)
    if (!url || !key) throw new Error('hub.supabase.url 또는 hub.supabase.key 가 settings.json 에 없음')
    init_supabase(url, key)
    log_event('supabase init: 성공')
  } catch (e) {
    log_event(`supabase init failed: ${e instanceof Error ? e.message : String(e)}`)
  }

  try {
    const result = await upsert_user(identity.hostname, identity.macAddresses, identity.ip, identity.deviceId, _hub_tag)
    _appInfo = result.appInfo
    _alias = result.alias
    _my_user_id = result.userId
    log_event(`user upsert 완료. userId=${_my_user_id} app_info=${JSON.stringify(_appInfo)} alias=${_alias ?? 'null'}`)
  } catch (e) {
    log_event(`user upsert failed: ${e instanceof Error ? e.message : String(e)}`)
  }

  win = create_window(_appInfo)  // show=false (트레이 시작)
  tray = create_tray(win)

  win.webContents.once('did-finish-load', () => {
    log_event('win: did-finish-load')
    void run_update_check({ baseDir, settingsPath, appKey: 'hub.bulletin.zip' }, update_callbacks)
  })

  // Supabase Realtime 구독 — 새 채팅 즉시 수신
  subscribe_chat(async (msg) => {
    log_event(`realtime: chat msg=${msg.id} from=${msg.userId} my=${_my_user_id ?? 'null'} win_visible=${win?.isVisible() ?? false}`)
    if (!_my_user_id || msg.userId === _my_user_id) return
    if (!win || !win.isVisible()) {
      const profile = (await list_users()).find(u => u.id === msg.userId)
      const sender = profile?.alias ?? profile?.hostname ?? '알 수 없음'
      show_chat_notification(sender, msg.text)
    } else {
      log_event('realtime: → chat:refresh 전송')
      win.webContents.send('chat:refresh')
    }
  })

  // 알림장 Realtime 구독
  subscribe_notices(() => {
    log_event(`realtime: notice 변경 감지 win_visible=${win?.isVisible() ?? false}`)
    if (!win || !win.isVisible()) {
      show_chat_notification('알림장', '새로운 알림장이 있습니다')
    } else {
      log_event('realtime: → notice:refresh 전송')
      win.webContents.send('notice:refresh')
    }
  })

  // 폴링 fallback — Realtime 누락 대비 (chat + notice)
  let _last_chat_time = 0
  let _last_notice_time = 0
  let _poll_count = 0
  log_event(`poll fallback interval: ${_db_check_ms}ms`)
  setInterval(async () => {
    if (!_my_user_id) return
    _poll_count++
    try {
      // chat 체크
      const msgs = await list_messages()
      if (msgs.length > 0) {
        const latest = msgs[msgs.length - 1]
        if (_last_chat_time === 0) {
          _last_chat_time = latest.createdAt
          log_event(`poll#${_poll_count}: chat 초기화 latest=${new Date(latest.createdAt).toISOString()}`)
        } else if (latest.createdAt > _last_chat_time && latest.userId !== _my_user_id) {
          _last_chat_time = latest.createdAt
          log_event(`poll#${_poll_count}: 새 chat from=${latest.userId} win_visible=${win?.isVisible() ?? false}`)
          if (!win || !win.isVisible()) {
            const profile = (await list_users()).find(u => u.id === latest.userId)
            const sender = profile?.alias ?? profile?.hostname ?? '알 수 없음'
            show_chat_notification(sender, latest.text)
          } else {
            log_event(`poll#${_poll_count}: → chat:refresh 전송`)
            win.webContents.send('chat:refresh')
          }
        } else {
          _last_chat_time = Math.max(_last_chat_time, latest.createdAt)
        }
      }
      // notice 체크
      const notices = await list_notices()
      if (notices.length > 0) {
        const latest_n = notices[0] // list_notices는 최신순
        if (_last_notice_time === 0) {
          _last_notice_time = latest_n.createdAt
          log_event(`poll#${_poll_count}: notice 초기화 latest=${new Date(latest_n.createdAt).toISOString()}`)
        } else if (latest_n.createdAt > _last_notice_time && latest_n.userId !== _my_user_id) {
          _last_notice_time = latest_n.createdAt
          log_event(`poll#${_poll_count}: 새 notice from=${latest_n.userId} win_visible=${win?.isVisible() ?? false}`)
          if (!win || !win.isVisible()) {
            show_chat_notification('알림장', '새로운 알림장이 있습니다')
          } else {
            log_event(`poll#${_poll_count}: → notice:refresh 전송`)
            win.webContents.send('notice:refresh')
          }
        } else {
          _last_notice_time = Math.max(_last_notice_time, latest_n.createdAt)
        }
      }
    } catch (e) { log_event(`poll#${_poll_count}: 오류 ${String(e)}`) }
  }, _db_check_ms)

  app.on('activate', () => {
    if (win) win.show()
    else win = create_window()
  })
})

app.on('before-quit', (event) => {
  log_event('app: before-quit')
  if (tray) {
    log_event('tray: destroying')
    tray.destroy()
  }
  if (_offline_done || !_identity) return
  event.preventDefault()
  const bounds = win?.getBounds()
  if (bounds) _appInfo = { ..._appInfo, width: bounds.width, height: bounds.height }
  void Promise.all([
    _my_user_id ? update_app_info(_my_user_id, _appInfo) : Promise.resolve(),
    set_user_offline(_identity.macAddresses, _identity.deviceId),
  ]).finally(() => {
    log_event(`user: set offline, app_info saved ${JSON.stringify(_appInfo)}`)
    _offline_done = true
    app.quit()
  })
})

app.on('window-all-closed', () => {
  log_event('app: window-all-closed')
  // tray-resident app: window closing does not quit
})
