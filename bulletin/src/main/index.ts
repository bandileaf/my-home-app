import { app, BrowserWindow, ipcMain, Menu, screen, shell, Tray } from 'electron'
import { appendFileSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { load_identity, type Identity } from './services/identity'
import {
  load_notice_state,
  list_notices,
  create_notice,
  confirm_notice,
  type Notice,
  type NoticeState
} from './services/store'
import { run_update_check } from './services/update'

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
      _log_path = join(logDir, 'bulletin.log')
    }
    appendFileSync(_log_path, `[${new Date().toISOString()}] ${message}\n`)
  } catch { /* ignore */ }
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
  const window = new BrowserWindow({
    width: 980,
    height: 700,
    title: 'Family Bulletin',
    icon: resolve_icon(),
    show: true,
    autoHideMenuBar: true,
    backgroundColor: '#faf9fc',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  window.on('close', (event) => {
    if (isQuitting) return
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
  t.setToolTip('Family Bulletin')
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

function register_ipc(baseDir: string, identity: Identity, state: NoticeState): void {
  ipcMain.handle('identity:get', (): Identity => identity)
  ipcMain.handle('notice:list',  (): Notice[] => list_notices(state))
  ipcMain.handle('notice:create', (_event, text: string): Notice =>
    create_notice(baseDir, state, identity.deviceId, identity.hostname, text)
  )
  ipcMain.handle('notice:confirm', (_event, noticeId: string): Notice | null =>
    confirm_notice(baseDir, state, noticeId, identity.deviceId, identity.hostname)
  )
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  log_event(`app ready. packaged=${app.isPackaged} appDir=${app_dir()}`)

  const baseDir = app_dir()
  const settingsPath = join(baseDir, 'settings.json')
  const identity = load_identity(baseDir)
  const state = load_notice_state(baseDir)

  register_ipc(baseDir, identity, state)

  const toast = create_toast_window()
  ipcMain.on('toast:close',    () => toast.hide())
  ipcMain.on('toast:open-log', () => { if (_log_path) void shell.openPath(_log_path) })

  win = create_window()
  tray = create_tray(win)

  void run_update_check(
    { baseDir, settingsPath, versionKey: 'hub.app.bulletin.version', exeName: 'family_bulletin.exe', processName: 'family_bulletin' },
    {
      set_status:   (msg) => { toast.webContents.send('toast:status', msg);   if (!toast.isVisible()) toast.show() },
      set_progress: (pct) => { toast.webContents.send('toast:progress', pct) },
      on_error:     (msg) => { toast.webContents.send('toast:error', msg);     toast.show() },
      on_quit:      () => { isQuitting = true; app.quit() },
      log:          log_event,
    }
  )

  app.on('activate', () => {
    if (win) win.show()
    else win = create_window()
  })
})

app.on('before-quit', () => {
  isQuitting = true
  tray?.destroy()
})

app.on('window-all-closed', () => {
  // tray-resident app: window closing does not quit
})
