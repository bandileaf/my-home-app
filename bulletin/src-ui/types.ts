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

export interface MenuOption {
  id: string
  text: string
  addedBy: string
  addedAt: number
}

export interface MenuVote {
  userId: string
  optionId: string
  votedAt: number
}

export interface MenuPoll {
  id: string
  createdBy: string
  title: string
  options: MenuOption[]
  votes: MenuVote[]
  deadline: number
  closed: boolean
  createdAt: number
}

export interface LiarParticipant {
  userId: string
  joinedAt: number
  ready: boolean
}

export interface LiarVote {
  userId: string
  targetUserId: string
  votedAt: number
}

export interface LiarMessage {
  id: string
  userId: string
  text: string
  createdAt: number
}

export interface LiarRoomView {
  id: string
  phase: 'waiting' | 'playing' | 'voting' | 'ended'
  participants: LiarParticipant[]
  yourRole: 'liar' | 'citizen' | null
  word: string | null
  liarUserId: string | null
  votes: LiarVote[]
  result: 'citizens_win' | 'liar_win' | null
  mutedUserIds: string[]
  createdAt: number
  updatedAt: number
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

export interface DbStatus {
  ready: boolean
  error: string | null
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
