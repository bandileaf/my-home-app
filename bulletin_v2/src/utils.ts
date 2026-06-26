import type { UserProfile } from './types'

export function display_name_of(profile: UserProfile | null | undefined): string {
  if (!profile) return '?'
  return profile.alias?.trim() || profile.hostname || '?'
}

export function initials_of(profile: UserProfile | null | undefined): string {
  return display_name_of(profile).slice(0, 2).toUpperCase()
}
