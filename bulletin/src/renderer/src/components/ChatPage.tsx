import { useEffect, useRef, useState } from 'react'
import { Send, Trash2 } from 'lucide-react'
import type { ChatMessage, Identity, UserProfile } from '../bridge'
import { get_bridge } from '../bridge'
import { initials_of } from '../hooks/useUsers'

interface ChatPageProps {
  identity: Identity | null
  get_profile: (deviceId: string) => UserProfile | null
  refresh_users: () => void
  online_users: UserProfile[]
}

function Avatar({ profile, size = 36 }: { profile: UserProfile | null; size?: number }): JSX.Element {
  const style = { width: size, height: size, borderRadius: '50%', flexShrink: 0 as const }
  if (profile?.avatar) return <img src={profile.avatar} style={{ ...style, objectFit: 'cover' }} alt="" />
  return (
    <span className="card-avatar-circle" style={{ ...style, fontSize: size * 0.38 }}>
      {initials_of(profile)}
    </span>
  )
}

function format_date_label(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
}

function format_time(ms: number): string {
  return new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })
}

function same_day(a: number, b: number): boolean {
  const da = new Date(a), db = new Date(b)
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate()
}

function read_indicator(msg: ChatMessage, my_id: string | undefined): string {
  if (!my_id || !msg.readBy.includes(my_id)) return 'N'
  if (msg.readBy.length === 0) return '읽지 않음'
  return `${msg.readBy.length}`
}

export function ChatPage({ identity, get_profile, refresh_users, online_users }: ChatPageProps): JSX.Element {
  const [messages, set_messages] = useState<ChatMessage[]>([])
  const [text, set_text] = useState('')
  const scroll_ref = useRef<HTMLDivElement>(null)
  const bottom_ref = useRef<HTMLDivElement>(null)
  const initialized_ref = useRef(false)
  const prev_count_ref = useRef(0)
  const my_id = identity?.deviceId

  function load(): void {
    get_bridge()?.list_chat?.().then(set_messages).catch(() => {})
  }

  useEffect(() => {
    refresh_users()
    load()
    get_bridge()?.add_reader_chat?.().then(load).catch(() => {})
    get_bridge()?.onChatRefresh?.(() => { load(); get_bridge()?.add_reader_chat?.().catch(() => {}) })
    return () => { initialized_ref.current = false }
  }, [])

  useEffect(() => {
    const new_count = messages.length
    if (!initialized_ref.current && new_count > 0) {
      bottom_ref.current?.scrollIntoView({ behavior: 'instant' })
      initialized_ref.current = true
    } else if (new_count > prev_count_ref.current) {
      const container = scroll_ref.current
      if (container) {
        const { scrollTop, scrollHeight, clientHeight } = container
        const near_bottom = scrollHeight - scrollTop - clientHeight < 120
        if (near_bottom) bottom_ref.current?.scrollIntoView({ behavior: 'smooth' })
      }
    }
    prev_count_ref.current = new_count
  }, [messages])

  function send(): void {
    const trimmed = text.trim()
    if (!trimmed) return
    set_text('')
    get_bridge()?.send_chat?.(trimmed).then(load).catch(() => {})
  }

  function delete_msg(id: string): void {
    get_bridge()?.delete_chat?.(id).then(load).catch(() => {})
  }

  return (
    <div className="page chat-page">
      <div className="chat-header">
        <div className="chat-online-avatars">
          {online_users.map((u, i) => (
            <div key={u.deviceId} style={{ marginLeft: i === 0 ? 0 : -16, zIndex: online_users.length - i }}>
              <Avatar profile={u} size={36} />
            </div>
          ))}
        </div>
        <span className="chat-header-name">{online_users.length}명 온라인</span>
      </div>

      <div className="chat-messages" ref={scroll_ref}>
        {messages.map((msg, i) => {
          const is_mine = msg.userId === my_id
          const profile = get_profile(msg.userId)
          const show_date = i === 0 || !same_day(messages[i - 1].createdAt, msg.createdAt)
          const indicator = read_indicator(msg, my_id)
          const is_new = indicator === 'N'

          const meta = (
            <div className="chat-meta">
              <span className="chat-time">{format_time(msg.createdAt)}</span>
              <span className={`chat-indicator ${is_new ? 'chat-indicator-new' : ''}`}>{indicator}</span>
            </div>
          )

          return (
            <div key={msg.id}>
              {show_date && (
                <div className="chat-date-sep">
                  <span>{format_date_label(msg.createdAt)}</span>
                </div>
              )}
              <div className={`chat-row ${is_mine ? 'chat-row-mine' : 'chat-row-other'}`}>
                {is_mine ? (
                  <>
                    <button className="chat-del-btn" onClick={() => delete_msg(msg.id)}>
                      <Trash2 size={14} />
                    </button>
                    {meta}
                    <div className="chat-bubble chat-bubble-mine">{msg.text}</div>
                  </>
                ) : (
                  <>
                    <Avatar profile={profile} size={32} />
                    <div className="chat-bubble chat-bubble-other">{msg.text}</div>
                    {meta}
                  </>
                )}
              </div>
            </div>
          )
        })}
        <div ref={bottom_ref} />
      </div>

      <div className="chat-input-row">
        <input
          className="chat-input"
          placeholder="메시지를 입력하세요..."
          value={text}
          onChange={(e) => set_text(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send() }}
        />
        <button className="chat-send-btn" onClick={send}>
          <Send size={20} />
        </button>
      </div>
    </div>
  )
}
