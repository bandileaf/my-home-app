import { useEffect, useRef, useState } from 'react'
import { Send, Trash2 } from 'lucide-react'
import type { UserSession, UserProfile } from '../types'
import type { useChat } from '../hooks/useChat'
import { initials_of } from '../utils'

type ChatHook = ReturnType<typeof useChat>

interface ChatPageProps {
  session: UserSession | null
  get_profile: (id: string) => UserProfile | null
  online_users: UserProfile[]
  hook: ChatHook
}

function Avatar({ profile, size = 36 }: { profile: UserProfile | null; size?: number }){
  const style = { width: size, height: size, borderRadius: '50%', flexShrink: 0 as const }
  if (profile?.avatar) return <img src={profile.avatar} style={{ ...style, objectFit: 'cover' }} alt="" />
  return <span className="card-avatar-circle" style={{ ...style, fontSize: size * 0.38 }}>{initials_of(profile)}</span>
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
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate()
}

export function ChatPage({ session, get_profile, online_users, hook }: ChatPageProps){
  const [text, set_text] = useState('')
  const scroll_ref = useRef<HTMLDivElement>(null)
  const bottom_ref = useRef<HTMLDivElement>(null)
  const initialized_ref = useRef(false)
  const prev_count_ref = useRef(0)
  const my_id = session?.userId

  useEffect(() => {
    hook.read()
  }, [])

  useEffect(() => {
    const n = hook.messages.length
    if (!initialized_ref.current && n > 0) {
      bottom_ref.current?.scrollIntoView({ behavior: 'instant' })
      initialized_ref.current = true
    } else if (n > prev_count_ref.current) {
      const c = scroll_ref.current
      if (c) {
        const near_bottom = c.scrollHeight - c.scrollTop - c.clientHeight < 120
        if (near_bottom) bottom_ref.current?.scrollIntoView({ behavior: 'smooth' })
      }
    }
    prev_count_ref.current = n
  }, [hook.messages])

  function send(): void {
    const trimmed = text.trim()
    if (!trimmed) return
    set_text('')
    hook.send(trimmed)
  }

  return (
    <div className="page chat-page">
      <div className="chat-header">
        <div className="chat-online-avatars">
          {online_users.map((u, i) => (
            <div key={u.id} style={{ marginLeft: i === 0 ? 0 : -16, zIndex: online_users.length - i }}>
              <Avatar profile={u} size={36} />
            </div>
          ))}
        </div>
        <span className="chat-header-name">{online_users.length}명 온라인</span>
      </div>

      <div className="chat-messages" ref={scroll_ref}>
        {hook.messages.map((msg, i) => {
          const is_mine = msg.userId === my_id
          const profile = get_profile(msg.userId)
          const show_date = i === 0 || !same_day(hook.messages[i - 1].createdAt, msg.createdAt)
          const read_count = msg.readBy.length
          const is_new = my_id && !msg.readBy.includes(my_id)

          const meta = (
            <div className="chat-meta">
              <span className="chat-time">{format_time(msg.createdAt)}</span>
              <span className={`chat-indicator ${is_new ? 'chat-indicator-new' : ''}`}>{is_new ? 'N' : read_count}</span>
            </div>
          )

          return (
            <div key={msg.id}>
              {show_date && <div className="chat-date-sep"><span>{format_date_label(msg.createdAt)}</span></div>}
              <div className={`chat-row ${is_mine ? 'chat-row-mine' : 'chat-row-other'}`}>
                {is_mine ? (
                  <>
                    <button className="chat-del-btn" onClick={() => hook.remove(msg.id)}><Trash2 size={14} /></button>
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
        <button className="chat-send-btn" onClick={send}><Send size={20} /></button>
      </div>
    </div>
  )
}
