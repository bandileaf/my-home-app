// 렌더러에서 Electron preload API(window.api)에 타입 안전하게 접근하기 위한 헬퍼.
// 브라우저 미리보기(dev:web)에서는 window.api 가 없으므로 항상 존재 여부를 확인한다.

export interface Identity {
  deviceId: string
  hostname: string
  macAddresses: string[]
  ip: string | null
}

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

export type NoticeKind = 'sticker' | 'reply_request' | 'vote'

export interface Notice {
  id: string
  userId: string
  kind: NoticeKind
  text: string
  createdAt: number
  replies: Reply[]
  votes: Vote[]
}

export interface UserProfile {
  deviceId: string
  hostname: string
  alias: string | null
  avatar: string | null
}

export interface ChatMessage {
  id: string
  userId: string
  text: string
  createdAt: number
  readBy: string[]
}

export interface AppBridge {
  window_close?: () => void
  window_minimize?: () => void
  app_name?: () => Promise<string>
  get_identity?: () => Promise<Identity>
  list_notices?: () => Promise<Notice[]>
  create_notice?: (text: string, kind: NoticeKind) => Promise<Notice>
  create_reply?: (noticeId: string, text: string) => Promise<void>
  update_notice?: (noticeId: string, text: string) => Promise<void>
  cast_vote?: (noticeId: string, vote: 'yes' | 'no') => Promise<void>
  list_users?: () => Promise<UserProfile[]>
  get_alias?: () => Promise<string | null>
  get_avatar?: () => Promise<string | null>
  save_profile?: (alias: string | null, avatar: string | null) => Promise<void>
  list_chat?: () => Promise<ChatMessage[]>
  send_chat?: (text: string) => Promise<void>
  delete_chat?: (id: string) => Promise<void>
  mark_read_chat?: () => Promise<void>
}

export function get_bridge(): AppBridge | undefined {
  return (window as unknown as { api?: AppBridge }).api
}
