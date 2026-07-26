import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useState, useEffect, useCallback } from 'react'
import type { LiarRoomView, LiarMessage } from '../../types'

export function useLiarGame() {
  const [room, setRoom] = useState<LiarRoomView | null>(null)
  const [messages, setMessages] = useState<LiarMessage[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const r = await invoke<LiarRoomView | null>('liar_get_room')
      setRoom(r)
      setMessages(r ? await invoke<LiarMessage[]>('liar_list_messages', { roomId: r.id }) : [])
    } catch { /* db not ready */ }
  }, [])

  useEffect(() => {
    refresh()
    const unsub = listen('refresh', refresh)
    return () => { unsub.then(f => f()) }
  }, [refresh])

  const run = async (fn: () => Promise<LiarRoomView>) => {
    try {
      setError(null)
      setRoom(await fn())
    } catch (e) {
      setError(String(e))
    }
  }

  const join = () => run(() => invoke<LiarRoomView>('liar_join'))

  const leave = async () => {
    try { await invoke('liar_leave') } catch (e) { setError(String(e)) }
  }

  const toggleReady = (roomId: string) => run(() => invoke<LiarRoomView>('liar_toggle_ready', { roomId }))

  const openVoting = (roomId: string) => run(() => invoke<LiarRoomView>('liar_open_voting', { roomId }))

  const castVote = (roomId: string, targetUserId: string) =>
    run(() => invoke<LiarRoomView>('liar_cast_vote', { roomId, targetUserId }))

  const sendMessage = async (roomId: string, text: string) => {
    try {
      await invoke('liar_send_message', { roomId, text })
      await refresh()
    } catch (e) { setError(String(e)) }
  }

  const reset = async () => {
    try {
      await invoke('liar_reset')
      await refresh()
    } catch (e) { setError(String(e)) }
  }

  return { room, messages, error, refresh, join, leave, toggleReady, openVoting, castVote, sendMessage, reset }
}
