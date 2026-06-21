import { contextBridge, ipcRenderer } from 'electron'
import type { Identity } from '../main/services/identity'
import type { Notice } from '../main/services/store'

const api = {
  window_close:    (): void => ipcRenderer.send('window:close'),
  window_minimize: (): void => ipcRenderer.send('window:minimize'),
  app_name: (): Promise<string> => ipcRenderer.invoke('app:name'),
  get_identity: (): Promise<Identity> => ipcRenderer.invoke('identity:get'),
  list_notices: (): Promise<Notice[]> => ipcRenderer.invoke('notice:list'),
  create_notice: (text: string, kind: string): Promise<Notice> => ipcRenderer.invoke('notice:create', text, kind),
  create_reply: (noticeId: string, text: string): Promise<void> =>
    ipcRenderer.invoke('notice:reply', noticeId, text),
  update_notice: (noticeId: string, text: string): Promise<void> =>
    ipcRenderer.invoke('notice:update', noticeId, text),
  cast_vote: (noticeId: string, vote: 'yes' | 'no'): Promise<void> =>
    ipcRenderer.invoke('notice:vote', noticeId, vote),
  list_users: (): Promise<unknown[]> => ipcRenderer.invoke('user:list'),
  get_alias:        (): Promise<string | null>  => ipcRenderer.invoke('user:alias'),
  get_avatar:       (): Promise<string | null>  => ipcRenderer.invoke('user:avatar'),
  save_profile: (alias: string | null, avatar: string | null): Promise<void> =>
    ipcRenderer.invoke('user:save_profile', alias, avatar),
  list_chat:   (): Promise<unknown[]>     => ipcRenderer.invoke('chat:list'),
  send_chat:   (text: string): Promise<void> => ipcRenderer.invoke('chat:send', text),
  delete_chat: (id: string):  Promise<void> => ipcRenderer.invoke('chat:delete', id),
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
