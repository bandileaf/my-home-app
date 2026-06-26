import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useState, useEffect, useCallback } from 'react'
import type { ChatMessage } from '../types'

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])

  const refresh = useCallback(async () => {
    try { setMessages(await invoke<ChatMessage[]>('list_messages')) } catch { /* db not ready */ }
  }, [])

  useEffect(() => {
    refresh()
    const unsub = listen('refresh', refresh)
    return () => { unsub.then(f => f()) }
  }, [refresh])

  const send = async (text: string) => {
    await invoke('send_message', { text })
    await refresh()
  }

  const remove = async (id: string) => {
    await invoke('delete_message', { id })
    await refresh()
  }

  const read = async () => {
    await invoke('mark_read')
  }

  return { messages, refresh, send, remove, read }
}
