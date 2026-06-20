import { useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Identity, Notice, NoticeKind, UserProfile } from '../bridge'
import { NoticeCard } from './NoticeCard'

interface NoticePageProps {
  identity: Identity | null
  notices: Notice[]
  on_post: (text: string, kind: NoticeKind) => void
  on_reply: (noticeId: string, text: string) => void
  on_edit: (noticeId: string, text: string) => void
  on_vote: (noticeId: string, vote: 'yes' | 'no') => void
  get_profile: (deviceId: string) => UserProfile | null
}

const KIND_OPTIONS: { key: NoticeKind; label: string }[] = [
  { key: 'sticker',        label: '일반'      },
  { key: 'reply_request',  label: '답글 요청' },
  { key: 'vote',           label: 'Yes / No'  },
]

export function NoticePage({ identity, notices, on_post, on_reply, on_edit, on_vote, get_profile }: NoticePageProps): JSX.Element {
  const [composing, set_composing] = useState(false)
  const [compose_text, set_compose_text] = useState('')
  const [kind, set_kind] = useState<NoticeKind>('sticker')
  const drag_start = useRef<number | null>(null)

  function handle_mouse_down(e: React.MouseEvent): void {
    drag_start.current = e.clientY
  }

  function handle_mouse_up(e: React.MouseEvent): void {
    if (drag_start.current === null) return
    const delta = e.clientY - drag_start.current
    drag_start.current = null
    if (delta > 60 && !composing) set_composing(true)
    if (delta < -60 && composing) { set_composing(false); set_compose_text(''); set_kind('sticker') }
  }

  function handle_post(): void {
    if (!compose_text.trim()) return
    on_post(compose_text, kind)
    set_compose_text('')
    set_kind('sticker')
    set_composing(false)
  }

  return (
    <div
      className="page"
      style={{ position: 'relative', userSelect: 'none' }}
      onMouseDown={handle_mouse_down}
      onMouseUp={handle_mouse_up}
      onMouseLeave={() => { drag_start.current = null }}
    >
      {composing ? (
        <div className="compose-view">
          <div className="compose-topbar">
            <div className="kind-selector">
              {KIND_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  className={`kind-btn ${kind === o.key ? 'active' : ''}`}
                  onClick={() => set_kind(o.key)}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <button className="compose-close-btn" onClick={() => { set_composing(false); set_compose_text(''); set_kind('sticker') }}>
              <X size={20} />
            </button>
          </div>
          <div className="compose-area">
            <textarea
              className="compose-textarea"
              placeholder="가족에게 알릴 내용을 입력하세요..."
              value={compose_text}
              onChange={(e) => set_compose_text(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              autoFocus
            />
            <button className="compose-post-btn" onClick={handle_post}>게시</button>
          </div>
        </div>
      ) : (
        <>
          <div className="page-head">
            <h2>알림장</h2>
          </div>

          {notices.map((notice) => (
            <NoticeCard
              key={notice.id}
              notice={notice}
              myIdentity={identity}
              my_profile={identity ? get_profile(identity.deviceId) : null}
              get_profile={get_profile}
              on_reply={on_reply}
              on_edit={on_edit}
              on_vote={on_vote}
            />
          ))}
        </>
      )}
    </div>
  )
}
