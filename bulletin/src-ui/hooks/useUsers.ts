import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useState, useEffect, useCallback } from 'react'
import type { UserProfile, UserSession } from '../types'

export function useUsers() {
  const [session, setSession] = useState<UserSession | null>(null)
  const [users, setUsers] = useState<UserProfile[]>([])

  const refresh_session = useCallback(async () => {
    try { setSession(await invoke<UserSession | null>('get_session')) } catch { /* */ }
  }, [])

  const refresh_users = useCallback(async () => {
    try { setUsers(await invoke<UserProfile[]>('list_users')) } catch { /* */ }
  }, [])

  useEffect(() => {
    refresh_session()
    refresh_users()
    const unsub = listen('refresh', () => { refresh_session(); refresh_users() })
    return () => { unsub.then(f => f()) }
  }, [refresh_session, refresh_users])

  const set_alias = async (alias: string | null) => {
    await invoke('save_alias', { alias })
    await refresh_session()
  }

  const set_avatar = async (avatar: string | null) => {
    await invoke('save_avatar', { avatar })
    await refresh_session()
  }

  return { session, users, set_alias, set_avatar, refresh_session, refresh_users }
}
