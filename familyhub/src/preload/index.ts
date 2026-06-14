import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('hub', {
  onStatus: (cb: (data: { message?: string; done: boolean }) => void) => {
    ipcRenderer.on('status', (_e, data) => cb(data))
  },
  onProgress: (cb: (pct: number) => void) => {
    ipcRenderer.on('progress', (_e, pct) => cb(pct))
  },
  close: () => ipcRenderer.send('close')
})
