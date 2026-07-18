import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open as dialog_open, ask as dialog_ask } from '@tauri-apps/plugin-dialog'

export interface FolderChild {
  name: string
  path: string
  sizeBytes: number
  isDir: boolean
  itemCount: number
  error?: string | null
}

export interface ScanProgress {
  done: number
  total: number
  name: string
}

function on_event<T>(event: string, cb: (data: T) => void): () => void {
  let unlisten: (() => void) | null = null
  listen<T>(event, (e) => cb(e.payload)).then((fn) => { unlisten = fn })
  return () => { unlisten?.() }
}

export const bridge = {
  close_window: (): void => { invoke('close_window').catch(() => window.close()) },

  list_drives: (): Promise<string[]> => invoke<string[]>('list_drives'),

  scan_folder: (path: string, force = false): Promise<FolderChild[]> =>
    invoke<FolderChild[]>('scan_folder', { path, force }),

  scan_cancel: (): void => { void invoke('scan_cancel') },

  reveal_path: (fullPath: string): void => { void invoke('reveal_path', { fullPath }) },

  delete_path: (fullPath: string): Promise<void> => invoke<void>('delete_path', { fullPath }),

  confirm_delete: (name: string): Promise<boolean> =>
    dialog_ask(`'${name}'을(를) 휴지통으로 보내시겠습니까?`, { title: '삭제 확인', kind: 'warning' }),

  empty_recycle_bin: (fullPath: string): Promise<void> => invoke<void>('empty_recycle_bin', { fullPath }),

  open_url: (url: string): void => { void invoke('open_url', { url }) },

  confirm_empty_recycle_bin: (): Promise<boolean> =>
    dialog_ask('휴지통을 비우시겠습니까? 이 작업은 되돌릴 수 없습니다.', { title: '휴지통 비우기', kind: 'warning' }),

  pick_folder: async (): Promise<string | null> => {
    const result = await dialog_open({ directory: true, multiple: false })
    if (!result) return null
    return typeof result === 'string' ? result : (result as { path?: string }).path ?? null
  },

  on_scan_progress: (cb: (p: ScanProgress) => void): (() => void) => on_event<ScanProgress>('scan:progress', cb),
}

export function get_bridge(): typeof bridge {
  return bridge
}
