import { useEffect, useRef, useState } from 'react'
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

interface DragIndicator {
  x: number
  y: number
  delta: number
}

export function NoticePage({ identity, notices, on_post, on_reply, on_edit, on_vote, get_profile }: NoticePageProps): JSX.Element {
  const [composing, set_composing] = useState(false)
  const [compose_text, set_compose_text] = useState('')
  const [kind, set_kind] = useState<NoticeKind>('sticker')
  const [indicator, set_indicator] = useState<DragIndicator | null>(null)

  const composing_ref = useRef(composing)
  useEffect(() => { composing_ref.current = composing }, [composing])

  useEffect(() => {
    let start_y: number | null = null
    let start_x: number | null = null

    function on_down(e: MouseEvent): void {
      start_y = e.clientY
      start_x = e.clientX
      set_indicator({ x: e.clientX, y: e.clientY, delta: 0 })
    }

    function on_move(e: MouseEvent): void {
      if (start_y === null || start_x === null) return
      set_indicator({ x: start_x, y: start_y, delta: e.clientY - start_y })
    }

    function on_up(e: MouseEvent): void {
      if (start_y === null) return
      const delta = e.clientY - start_y
      start_y = null
      start_x = null
      set_indicator(null)
      if (delta > 60 && !composing_ref.current) { set_composing(true) }
      else if (delta < -60 && composing_ref.current) { set_composing(false); set_compose_text(''); set_kind('sticker') }
    }

    document.addEventListener('mousedown', on_down)
    document.addEventListener('mousemove', on_move)
    document.addEventListener('mouseup', on_up)
    return () => {
      document.removeEventListener('mousedown', on_down)
      document.removeEventListener('mousemove', on_move)
      document.removeEventListener('mouseup', on_up)
    }
  }, [])

  function handle_post(): void {
    if (!compose_text.trim()) return
    on_post(compose_text, kind)
    set_compose_text('')
    set_kind('sticker')
    set_composing(false)
  }

  return (
    <div className="page" style={{ position: 'relative', userSelect: 'none' }}>

      {indicator && (
        <div
          className="drag-indicator"
          style={{ left: indicator.x, top: indicator.y }}
        >
          <div className="drag-circle" />
          {indicator.delta > 20 && (
            <div className="drag-arrow" style={{ opacity: Math.min((indicator.delta - 20) / 40, 1) }}>↓</div>
          )}
        </div>
      )}

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
