import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('toast', {
  onStatus:   (cb: (msg: string) => void)  => { ipcRenderer.on('toast:status',   (_e, msg) => cb(msg)) },
  onProgress: (cb: (pct: number) => void)  => { ipcRenderer.on('toast:progress', (_e, pct) => cb(pct)) },
  onError:    (cb: (msg: string) => void)  => { ipcRenderer.on('toast:error',    (_e, msg) => cb(msg)) },
  openLog:    ()                           => ipcRenderer.send('toast:open-log'),
  close:      ()                           => ipcRenderer.send('toast:close'),
})
