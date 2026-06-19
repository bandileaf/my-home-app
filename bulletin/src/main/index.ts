import { app, BrowserWindow, ipcMain, Menu, screen, shell, Tray } from 'electron'
import { appendFileSync, mkdirSync, readFileSync } from 'fs'
import { basename, dirname, join } from 'path'
import { parse as parse_jsonc } from 'jsonc-parser'
import { load_identity, type Identity } from './services/identity'
import {
  load_notice_state,
  list_notices,
  create_notice,
  confirm_notice,
  type Notice,
  type NoticeState
} from './services/store'
import { run_update_check } from '@shared/update'

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
    appendFileSync(_log_path, `[${new Date().toISOString()}] ${message}\n`)
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
let isQuitting = false

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

function create_window(): BrowserWindow {
  log_event(`window: creating — title="${app_display_name()}"`)
  const window = new BrowserWindow({
    width: 980,
    height: 700,
    title: app_display_name(),
    icon: resolve_icon(),
    show: true,
    autoHideMenuBar: true,
    backgroundColor: '#faf9fc',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  window.on('page-title-updated', (e) => e.preventDefault())
  window.on('close', (event) => {
    if (isQuitting) {
      log_event('window: close (quitting)')
      return
    }
    log_event('window: close → hiding (tray-resident)')
    event.preventDefault()
    window.hide()
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
      { label: '종료', click: () => { isQuitting = true; app.quit() } }
    ])
  )
  t.on('click', () => window.show())
  return t
}

function app_display_name(): string {
  return _display_name ?? app.getName()
}

function register_ipc(baseDir: string, identity: Identity, state: NoticeState): void {
  ipcMain.handle('app:name',     (): string => app_display_name())
  ipcMain.handle('identity:get', (): Identity => identity)
  ipcMain.handle('notice:list',  (): Notice[] => list_notices(state))
  ipcMain.handle('notice:create', (_event, text: string): Notice =>
    create_notice(baseDir, state, identity.deviceId, identity.hostname, text)
  )
  ipcMain.handle('notice:confirm', (_event, noticeId: string): Notice | null =>
    confirm_notice(baseDir, state, noticeId, identity.deviceId, identity.hostname)
  )
}

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
    appendFileSync(logPath, `\n[${new Date().toISOString()}] DUPLICATE LAUNCH rejected pid=${process.pid} argv=${JSON.stringify(process.argv)}\n`)
  } catch { /* ignore */ }
  app.quit()
  process.exit(0)
}

app.on('second-instance', (_event, argv, cwd) => {
  log_event(`second-instance: argv=${JSON.stringify(argv)} cwd=${cwd}`)
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus() }
})

app.whenReady().then(() => {
  if (!got_lock) return
  Menu.setApplicationMenu(null)
  const baseDir = app_dir()
  const settingsPath = join(baseDir, 'settings.json')
  init_log_path(settingsPath)
  log_event(`app ready. packaged=${app.isPackaged} appDir=${baseDir} argv=${JSON.stringify(process.argv)}`)
  const identity = load_identity(baseDir)
  const state = load_notice_state(baseDir)

  register_ipc(baseDir, identity, state)

  const toast = create_toast_window()
  ipcMain.on('toast:close',    () => toast.hide())
  ipcMain.on('toast:open-log', () => { if (_log_path) void shell.openPath(_log_path) })

  win = create_window()
  tray = create_tray(win)

  let toastReady = false
  let winReady = false
  const start_update = (): void => {
    if (!toastReady || !winReady) return
    log_event('update: starting check (window + toast both ready)')
    void run_update_check(
      { baseDir, settingsPath, appKey: app.getName() },
      {
        set_status:   (msg) => { toast.webContents.send('toast:status', msg); if (!toast.isVisible()) toast.show() },
        set_progress: (pct) => { toast.webContents.send('toast:progress', pct) },
        on_error:     (msg) => { toast.webContents.send('toast:error', msg); toast.show() },
        on_quit:      () => { isQuitting = true; app.quit() },
        log:          log_event,
      }
    )
  }
  toast.webContents.once('did-finish-load', () => { toastReady = true; start_update() })
  win.webContents.once('did-finish-load', () => { winReady = true; start_update() })

  app.on('activate', () => {
    if (win) win.show()
    else win = create_window()
  })
})

app.on('before-quit', () => {
  log_event('app: before-quit')
  isQuitting = true
  if (tray) {
    log_event('tray: destroying')
    tray.destroy()
  }
})

app.on('window-all-closed', () => {
  log_event('app: window-all-closed')
  // tray-resident app: window closing does not quit
})
