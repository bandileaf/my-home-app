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

interface DragIndicator { sx: number; sy: number; cy: number }

const R = 26

export function NoticePage({ identity, notices, on_post, on_reply, on_edit, on_vote, get_profile }: NoticePageProps): JSX.Element {
  const [composing, set_composing] = useState(false)
  const [compose_text, set_compose_text] = useState('')
  const [kind, set_kind] = useState<NoticeKind>('sticker')
  const [ind, set_ind] = useState<DragIndicator | null>(null)

  const composing_ref = useRef(composing)
  useEffect(() => { composing_ref.current = composing }, [composing])

  useEffect(() => {
    let sy: number | null = null
    let sx: number | null = null

    function on_down(e: MouseEvent): void {
      sy = e.clientY; sx = e.clientX
      set_ind({ sx: e.clientX, sy: e.clientY, cy: e.clientY })
    }
    function on_move(e: MouseEvent): void {
      if (sy === null || sx === null) return
      set_ind({ sx: sx, sy: sy, cy: e.clientY })
    }
    function on_up(e: MouseEvent): void {
      if (sy === null) return
      const delta = e.clientY - sy
      sy = null; sx = null
      set_ind(null)
      if (delta > 60 && !composing_ref.current) set_composing(true)
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

  const renderDrag = (): JSX.Element | null => {
    if (!ind) return null
    const { sx, sy, cy } = ind
    const delta = cy - sy
    const abs = Math.abs(delta)
    const chevronOpacity = Math.min(Math.max((abs - 15) / 35, 0), 1)
    const down = delta >= 0
    // chevron path: V shape pointing in drag direction, centered in circle
    const cx = sx, top = sy - 9, bot = sy + 9
    const chevron = down
      ? `M ${cx - 9},${top} L ${cx},${bot} L ${cx + 9},${top}`
      : `M ${cx - 9},${bot} L ${cx},${top} L ${cx + 9},${bot}`

    return (
      <svg className="drag-svg-overlay">
        <circle cx={sx} cy={sy} r={R} className="drag-svg-circle"
          fill="rgba(255,255,255,0.88)"
          style={{ filter: 'drop-shadow(0 2px 12px rgba(0,0,0,0.16))' }}
        />
        <path d={chevron}
          stroke="rgba(120,90,220,0.85)" strokeWidth={2.5}
          strokeLinecap="round" strokeLinejoin="round"
          fill="none"
          style={{ opacity: chevronOpacity, transition: 'opacity 0.12s' }}
        />
      </svg>
    )
  }

  return (
    <div className="page" style={{ position: 'relative', userSelect: 'none' }}>
      {renderDrag()}

      {composing ? (
        <div className="compose-view">
          <div className="compose-topbar">
            <div className="kind-selector">
              {KIND_OPTIONS.map((o) => (
                <button key={o.key} className={`kind-btn ${kind === o.key ? 'active' : ''}`} onClick={() => set_kind(o.key)}>
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
