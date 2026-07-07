export interface Reply {
  id: string
  userId: string
  text: string
  createdAt: number
}

export interface Vote {
  userId: string
  vote: 'yes' | 'no'
  votedAt: number
}

export interface Notice {
  id: string
  userId: string
  kind: 'sticker' | 'reply_request' | 'vote'
  text: string
  createdAt: number
  replies: Reply[]
  votes: Vote[]
}

export interface ChatMessage {
  id: string
  userId: string
  text: string
  createdAt: number
  readBy: string[]
}

export interface Schedule {
  id: string
  userId: string
  title: string
  date: string
  endDate: string | null
  allDay: boolean
  startTime: string | null
  endTime: string | null
  repeatWeekly: boolean
  repeatMonthly: boolean
  memo: string | null
  color: string
  createdAt: number
}

export interface UserProfile {
  id: string
  deviceId: string
  hostname: string
  alias: string | null
  avatar: string | null
  isOnline: boolean
}

export interface UserSession {
  userId: string
  alias: string | null
  avatar: string | null
}

export interface DeviceStatus {
  ip: string
  deviceId: string
  hostname: string
  version: string
  hasSettings: boolean
  disabled: boolean
}

export interface Settings {
  'hub.supabase.url': string
  'hub.supabase.key': string
  'hub.device-id'?: string
  'hub.tag'?: string
  'hub.auto-update'?: boolean
  'hub.disabled'?: boolean
  'hub.app.bulletin.admin'?: boolean
}
