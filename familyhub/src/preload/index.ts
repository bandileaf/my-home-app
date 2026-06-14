import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('hub', {
  onStatus: (cb: (data: { message?: string; done: boolean }) => void) => {
    ipcRenderer.on('status', (_e, data) => cb(data))
  }
})
