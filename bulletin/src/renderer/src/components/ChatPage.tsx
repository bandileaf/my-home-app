import { useEffect, useRef, useState } from 'react'
import { Send, Trash2 } from 'lucide-react'
import type { ChatMessage, Identity, UserProfile } from '../bridge'
import { get_bridge } from '../bridge'
import { display_name_of, initials_of } from '../hooks/useUsers'

interface ChatPageProps {
  identity: Identity | null
  my_profile: UserProfile | null
  get_profile: (deviceId: string) => UserProfile | null
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

export function ChatPage({ identity, my_profile, get_profile }: ChatPageProps): JSX.Element {
  const [messages, set_messages] = useState<ChatMessage[]>([])
  const [text, set_text] = useState('')
  const bottom_ref = useRef<HTMLDivElement>(null)
  const my_id = identity?.deviceId

  function load(): void {
    get_bridge()?.list_chat?.()
      .then(set_messages)
      .catch(() => {})
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    bottom_ref.current?.scrollIntoView({ behavior: 'smooth' })
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
    <div className="chat-page">
      <div className="chat-header">
        <Avatar profile={my_profile} size={48} />
        <span className="chat-header-name">{display_name_of(my_profile)}</span>
      </div>

      <div className="chat-messages">
        {messages.map((msg) => {
          const is_mine = msg.userId === my_id
          const profile = get_profile(msg.userId)
          return (
            <div key={msg.id} className={`chat-row ${is_mine ? 'chat-row-mine' : 'chat-row-other'}`}>
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
                  <div className="chat-other-body">
                    <span className="chat-other-name">{display_name_of(profile)}</span>
                    <div className="chat-bubble chat-bubble-other">{msg.text}</div>
                  </div>
                </>
              )}
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
