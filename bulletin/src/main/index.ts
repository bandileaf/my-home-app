import { app, BrowserWindow, ipcMain, Menu, screen, shell, Tray } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'path'
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
  type AppInfo,
} from './services/store'
import { run_update_check } from '@shared/update'
import { start_control_server } from './services/control'
import { scan_subnet, send_command, fetch_client_settings, fetch_client_log } from './services/admin'

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
  ipcMain.on('window:minimize',    () => win?.minimize())
  ipcMain.handle('app:has_settings', () => existsSync(settingsPath))
  ipcMain.handle('app:disabled',     () => _disabled)
  ipcMain.handle('app:name',     (): string => app_display_name())
  ipcMain.handle('identity:get', (): Identity => identity)
  ipcMain.handle('user:alias',  (): string | null => _alias)
  ipcMain.handle('user:avatar', async (): Promise<string | null> => {
    try { return await get_user_avatar(_identity!.deviceId) }
    catch (e) { log_error('user:avatar', e); return null }
  })
  ipcMain.handle('user:save_profile', async (_e, alias: string | null, avatar: string | null) => {
    _alias = alias
    try {
      await Promise.all([
        save_user_alias(_identity!.deviceId, alias),
        save_user_avatar(_identity!.deviceId, avatar),
      ])
      log_event(`profile saved alias=${alias ?? 'null'} avatar=${avatar ? `${Math.round(avatar.length / 1024)}KB` : 'null'}`)
    } catch (e) { log_error('user:save_profile', e) }
  })
  ipcMain.handle('notice:list', async () => {
    try { return await list_notices() }
    catch (e) { log_error('notice:list', e); return [] }
  })
  ipcMain.handle('notice:create', async (_event, text: string, kind: string) => {
    try { return await create_notice(identity.deviceId, text, (kind as 'sticker' | 'reply_request' | 'vote') ?? 'sticker') }
    catch (e) { log_error('notice:create', e); return null }
  })
  ipcMain.handle('notice:reply', async (_event, noticeId: string, text: string) => {
    try { await create_reply(noticeId, identity.deviceId, text) }
    catch (e) { log_error('notice:reply', e) }
  })
  ipcMain.handle('notice:update', async (_event, noticeId: string, text: string) => {
    try { await update_notice(noticeId, text) }
    catch (e) { log_error('notice:update', e) }
  })
  ipcMain.handle('notice:vote', async (_event, noticeId: string, vote: 'yes' | 'no') => {
    try { await cast_vote(noticeId, identity.deviceId, vote) }
    catch (e) { log_error('notice:vote', e) }
  })
  ipcMain.handle('user:list', async () => {
    try { return await list_users() }
    catch (e) { log_error('user:list', e); return [] }
  })
  ipcMain.handle('chat:list', async () => {
    try { return await list_messages() }
    catch (e) { log_error('chat:list', e); return [] }
  })
  ipcMain.handle('chat:send', async (_event, text: string) => {
    try { await send_message(identity.deviceId, text) }
    catch (e) { log_error('chat:send', e) }
  })
  ipcMain.handle('chat:delete', async (_event, id: string) => {
    try { await delete_message(id, identity.deviceId) }
    catch (e) { log_error('chat:delete', e) }
  })
  ipcMain.handle('chat:has_unread', async () => {
    try { return await has_unread(identity.deviceId) }
    catch (e) { log_error('chat:has_unread', e); return false }
  })
  ipcMain.handle('chat:add_reader', async () => {
    try { await add_reader(identity.deviceId) }
    catch (e) { log_error('chat:add_reader', e) }
  })
  ipcMain.handle('admin:is_enabled', () => _is_admin)
  ipcMain.handle('admin:get_settings', () => {
    try { return readFileSync(settingsPath, 'utf-8') } catch { return '{}' }
  })
  ipcMain.handle('admin:scan', async () => {
    try { return await scan_subnet() }
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
let _appInfo: AppInfo = {}
let _alias: string | null = null
let _offline_done = false
let _disabled = false
let _is_admin = false

app.whenReady().then(async () => {
  if (!got_lock) return
  Menu.setApplicationMenu(null)
  const baseDir = app_dir()
  const settingsPath = join(baseDir, 'settings.json')
  init_log_path(settingsPath)
  log_event(`app ready. packaged=${app.isPackaged} appDir=${baseDir} argv=${JSON.stringify(process.argv)}`)
  const identity = load_identity(baseDir)
  _identity = identity
  log_event(`identity: deviceId=${identity.deviceId} mac=[${identity.macAddresses.join(', ')}] ip=${identity.ip ?? 'null'}`)

  const has_settings = existsSync(settingsPath)
  log_event(`settings.json: ${has_settings ? '있음' : '없음 — 관리자 대기 모드'}`)

  // 제어서버는 settings 유무 무관하게 항상 시작
  const toast = create_toast_window()
  ipcMain.on('toast:close',    () => toast.hide())
  ipcMain.on('toast:open-log', () => { if (_log_path) void shell.openPath(_log_path) })

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
    on_settings_received: () => {
      log_event('control: settings received → restarting')
      setTimeout(() => { app.relaunch(); app.quit() }, 500)
    },
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
    const autostart = raw['hub.app.bulletin.autostart'] === true
    app.setLoginItemSettings({ openAtLogin: autostart, path: app.getPath('exe') })
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
    const result = await upsert_user(identity.hostname, identity.macAddresses, identity.ip, identity.deviceId)
    _appInfo = result.appInfo
    _alias = result.alias
    log_event(`user upsert 완료. app_info=${JSON.stringify(_appInfo)} alias=${_alias ?? 'null'}`)
  } catch (e) {
    log_event(`user upsert failed: ${e instanceof Error ? e.message : String(e)}`)
  }

  win = create_window(_appInfo)  // show=false (트레이 시작)
  tray = create_tray(win)

  win.webContents.once('did-finish-load', () => {
    log_event('win: did-finish-load')
    void run_update_check({ baseDir, settingsPath, appKey: 'hub.bulletin.zip' }, update_callbacks)
  })

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
    update_app_info(_identity.deviceId, _appInfo),
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
