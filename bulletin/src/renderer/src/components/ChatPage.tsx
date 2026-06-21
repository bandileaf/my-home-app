import { useEffect, useRef, useState } from 'react'
import { Send, Trash2 } from 'lucide-react'
import type { ChatMessage, Identity, UserProfile } from '../bridge'
import { get_bridge } from '../bridge'
import { display_name_of, initials_of } from '../hooks/useUsers'

interface ChatPageProps {
  identity: Identity | null
  my_profile: UserProfile | null
  get_profile: (deviceId: string) => UserProfile | null
  refresh_users: () => void
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

function same_day(a: number, b: number): boolean {
  const da = new Date(a), db = new Date(b)
  return da.getFullYear() === db.getFullYear()
    && da.getMonth() === db.getMonth()
    && da.getDate() === db.getDate()
}

export function ChatPage({ identity, my_profile, get_profile, refresh_users }: ChatPageProps): JSX.Element {
  const [messages, set_messages] = useState<ChatMessage[]>([])
  const [text, set_text] = useState('')
  const scroll_ref = useRef<HTMLDivElement>(null)
  const bottom_ref = useRef<HTMLDivElement>(null)
  const prev_count_ref = useRef(0)
  const my_id = identity?.deviceId

  function load(): void {
    get_bridge()?.list_chat?.()
      .then(set_messages)
      .catch(() => {})
  }

  useEffect(() => {
    refresh_users()
    load()
    const timer = setInterval(load, 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const new_count = messages.length
    if (new_count > prev_count_ref.current) {
      const container = scroll_ref.current
      if (container) {
        const { scrollTop, scrollHeight, clientHeight } = container
        const near_bottom = scrollHeight - scrollTop - clientHeight < 120
        if (near_bottom || prev_count_ref.current === 0) {
          bottom_ref.current?.scrollIntoView({ behavior: 'smooth' })
        }
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
        <Avatar profile={my_profile} size={48} />
        <span className="chat-header-name">{display_name_of(my_profile)}</span>
      </div>

      <div className="chat-messages" ref={scroll_ref}>
        {messages.map((msg, i) => {
          const is_mine = msg.userId === my_id
          const profile = get_profile(msg.userId)
          const show_date = i === 0 || !same_day(messages[i - 1].createdAt, msg.createdAt)

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
                    <div className="chat-bubble chat-bubble-mine">{msg.text}</div>
                  </>
                ) : (
                  <>
                    <Avatar profile={profile} size={32} />
                    <div className="chat-bubble chat-bubble-other">
                      <span className="chat-bubble-name">{display_name_of(profile)}</span>
                      <span>{msg.text}</span>
                    </div>
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
