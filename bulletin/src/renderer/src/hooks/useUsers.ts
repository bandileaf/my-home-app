import { useCallback, useEffect, useState } from 'react'
import { get_bridge, type UserProfile } from '../bridge'

export function display_name_of(profile: UserProfile | null | undefined): string {
  if (!profile) return '?'
  return profile.alias?.trim() || profile.hostname || '?'
}

export function initials_of(profile: UserProfile | null | undefined): string {
  return display_name_of(profile).slice(0, 2).toUpperCase()
}

export function useUsers(): (deviceId: string) => UserProfile | null {
  const [map, set_map] = useState<Map<string, UserProfile>>(new Map())

  useEffect(() => {
    get_bridge()?.list_users?.()
      .then((list) => set_map(new Map(list.map((u) => [u.deviceId, u]))))
      .catch(() => {})
  }, [])

  return useCallback((deviceId: string) => map.get(deviceId) ?? null, [map])
}
