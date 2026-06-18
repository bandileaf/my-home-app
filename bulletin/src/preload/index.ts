import { contextBridge, ipcRenderer } from 'electron'
import type { Identity } from '../main/services/identity'
import type { Notice } from '../main/services/store'

const api = {
  get_identity: (): Promise<Identity> => ipcRenderer.invoke('identity:get'),
  list_notices: (): Promise<Notice[]> => ipcRenderer.invoke('notice:list'),
  create_notice: (text: string): Promise<Notice> => ipcRenderer.invoke('notice:create', text),
  confirm_notice: (noticeId: string): Promise<Notice | null> =>
    ipcRenderer.invoke('notice:confirm', noticeId)
}

export type PreloadApi = typeof api

function expose_api(bridgeApi: PreloadApi): void {
  if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('api', bridgeApi)
  } else {
    ;(globalThis as unknown as { api: PreloadApi }).api = bridgeApi
  }
}

expose_api(api)
