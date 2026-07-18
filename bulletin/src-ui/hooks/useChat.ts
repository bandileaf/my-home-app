import { invoke } from '@tauri-apps/api/core'
import { useState, useEffect, useCallback } from 'react'
import type { ChatMessage } from '../types'

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])

  const refresh = useCallback(async () => {
    try { setMessages(await invoke<ChatMessage[]>('list_messages')) } catch { /* db not ready */ }
  }, [])

  useEffect(() => {
    refresh()
    // 'refresh' 이벤트 구독은 ChatPage가 소유 (조회 → 읽음처리 순서를 강제하기 위해)
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
