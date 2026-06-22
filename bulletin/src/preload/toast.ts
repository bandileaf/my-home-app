import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('toast', {
  onStatus:   (cb: (msg: string) => void)                  => { ipcRenderer.on('toast:status',   (_e, msg) => cb(msg)) },
  onProgress: (cb: (pct: number) => void)                  => { ipcRenderer.on('toast:progress', (_e, pct) => cb(pct)) },
  onError:    (cb: (msg: string) => void)                  => { ipcRenderer.on('toast:error',    (_e, msg) => cb(msg)) },
  onChat:     (cb: (sender: string, text: string) => void) => { ipcRenderer.on('toast:chat',     (_e, sender, text) => cb(sender, text)) },
  get_name:   ()                                           => ipcRenderer.invoke('app:name') as Promise<string>,
  openLog:    ()                                           => ipcRenderer.send('toast:open-log'),
  openMain:   ()                                           => ipcRenderer.send('toast:open-main'),
  close:      ()                                           => ipcRenderer.send('toast:close'),
})
