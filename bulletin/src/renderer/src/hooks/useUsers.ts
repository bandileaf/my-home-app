import { useCallback, useEffect, useState } from 'react'
import { get_bridge, type UserProfile } from '../bridge'

export function display_name_of(profile: UserProfile | null | undefined): string {
  if (!profile) return '?'
  return profile.alias?.trim() || profile.hostname || '?'
}

export function initials_of(profile: UserProfile | null | undefined): string {
  return display_name_of(profile).slice(0, 2).toUpperCase()
}

export function useUsers(): { get_profile: (deviceId: string) => UserProfile | null; refresh_users: () => void; users_count: number } {
  const [map, set_map] = useState<Map<string, UserProfile>>(new Map())

  const load = useCallback(() => {
    get_bridge()?.list_users?.()
      .then((list) => set_map(new Map(list.map((u) => [u.deviceId, u]))))
      .catch(() => {})
  }, [])

  useEffect(() => { load() }, [load])

  const get_profile = useCallback((deviceId: string) => map.get(deviceId) ?? null, [map])

  return { get_profile, refresh_users: load, users_count: map.size }
}
