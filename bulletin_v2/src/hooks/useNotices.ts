import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useState, useEffect, useCallback } from 'react'
import type { Notice } from '../types'

export function useNotices() {
  const [notices, setNotices] = useState<Notice[]>([])

  const refresh = useCallback(async () => {
    try { setNotices(await invoke<Notice[]>('list_notices')) } catch { /* db not ready */ }
  }, [])

  useEffect(() => {
    refresh()
    const unsub = listen('refresh', refresh)
    return () => { unsub.then(f => f()) }
  }, [refresh])

  const create = async (text: string, kind: string) => {
    await invoke('create_notice', { text, kind })
    await refresh()
  }

  const reply = async (noticeId: string, text: string) => {
    await invoke('create_reply', { noticeId, text })
    await refresh()
  }

  const vote = async (noticeId: string, vote: string) => {
    await invoke('cast_vote', { noticeId, vote })
    await refresh()
  }

  const update = async (noticeId: string, text: string) => {
    await invoke('update_notice', { noticeId, text })
    await refresh()
  }

  const remove = async (noticeId: string) => {
    await invoke('delete_notice', { noticeId })
    await refresh()
  }

  return { notices, refresh, create, reply, vote, update, remove }
}
