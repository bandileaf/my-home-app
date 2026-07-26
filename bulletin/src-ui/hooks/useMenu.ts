import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useState, useEffect, useCallback } from 'react'
import type { MenuPoll } from '../types'

export function useMenu() {
  const [polls, setPolls] = useState<MenuPoll[]>([])

  const refresh = useCallback(async () => {
    try { setPolls(await invoke<MenuPoll[]>('list_menu_polls')) } catch { /* db not ready */ }
  }, [])

  useEffect(() => {
    refresh()
    const unsub = listen('refresh', refresh)
    return () => { unsub.then(f => f()) }
  }, [refresh])

  const create = async (title: string, deadline: number) => {
    await invoke('create_menu_poll', { title, deadline })
    await refresh()
  }

  const addOption = async (pollId: string, text: string) => {
    await invoke('add_menu_option', { pollId, text })
    await refresh()
  }

  const vote = async (pollId: string, optionId: string) => {
    await invoke('cast_menu_vote', { pollId, optionId })
    await refresh()
  }

  const remove = async (pollId: string) => {
    await invoke('delete_menu_poll', { pollId })
    await refresh()
  }

  return { polls, refresh, create, addOption, vote, remove }
}
