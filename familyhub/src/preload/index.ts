import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('hub', {
  onInit: (cb: (data: { version: string; logPath: string }) => void) => {
    ipcRenderer.on('init', (_e, data) => cb(data))
  },
  onStatus: (cb: (data: { message?: string; done: boolean }) => void) => {
    ipcRenderer.on('status', (_e, data) => cb(data))
  },
  onProgress: (cb: (pct: number) => void) => {
    ipcRenderer.on('progress', (_e, pct) => cb(pct))
  },
  onError: (cb: (logPath: string) => void) => {
    ipcRenderer.on('error', (_e, logPath) => cb(logPath))
  },
  openLog: () => ipcRenderer.send('open-log'),
  close: () => ipcRenderer.send('close')
})
