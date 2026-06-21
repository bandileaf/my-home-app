import { useState } from 'react'
import { Pencil, Check } from 'lucide-react'
import type { Identity, Notice, UserProfile } from '../bridge'
import { display_name_of, initials_of } from '../hooks/useUsers'

interface NoticeCardProps {
  notice: Notice
  myIdentity: Identity | null
  my_profile: UserProfile | null
  get_profile: (deviceId: string) => UserProfile | null
  on_reply: (noticeId: string, text: string) => void
  on_edit: (noticeId: string, text: string) => void
  on_vote: (noticeId: string, vote: 'yes' | 'no') => void
}

function format_relative_time(ms: number): string {
  const diff = Math.floor((Date.now() - ms) / 60000)
  if (diff < 1) return '방금'
  if (diff < 60) return `${diff}분 전`
  if (diff < 1440) return `${Math.floor(diff / 60)}시간 전`
  return `${Math.floor(diff / 1440)}일 전`
}

function Avatar({ profile, size = 40 }: { profile: UserProfile | null; size?: number }): JSX.Element {
  const style = { width: size, height: size, borderRadius: '50%', flexShrink: 0 as const }
  if (profile?.avatar) return <img src={profile.avatar} style={{ ...style, objectFit: 'cover' }} alt="" />
  return <span className="card-avatar-circle" style={{ ...style, fontSize: size * 0.38 }}>{initials_of(profile)}</span>
}

export function NoticeCard({ notice, myIdentity, my_profile, get_profile, on_reply, on_edit, on_vote }: NoticeCardProps): JSX.Element {
  const is_mine = myIdentity?.deviceId === notice.userId
  const my_vote = notice.votes.find((v) => v.userId === myIdentity?.deviceId)?.vote ?? null
  const yes_count = notice.votes.filter((v) => v.vote === 'yes').length
  const no_count  = notice.votes.filter((v) => v.vote === 'no').length

  const [editing,    set_editing]    = useState(false)
  const [edit_text,  set_edit_text]  = useState(notice.text)
  const [replying,   set_replying]   = useState(false)
  const [leaving,    set_leaving]    = useState(false)
  const [reply_text, set_reply_text] = useState('')

  const author_profile = get_profile(notice.userId)

  function handle_edit_save(): void {
    if (!edit_text.trim()) return
    on_edit(notice.id, edit_text)
    set_editing(false)
  }

  function open_reply(): void {
    set_replying(true)
    set_leaving(false)
  }

  function submit_reply(): void {
    if (!reply_text.trim()) return
    on_reply(notice.id, reply_text)
    set_reply_text('')
    set_leaving(true)
  }

  function on_anim_end(): void {
    if (leaving) { set_replying(false); set_leaving(false) }
  }

  return (
    <div className="card">
      {notice.kind === 'reply_request' && <div className="kind-badge kind-reply">💬 답글을 남겨주세요</div>}
      {notice.kind === 'vote'          && <div className="kind-badge kind-vote">🗳️ Yes / No 투표</div>}

      <div className="card-row">
        <Avatar profile={author_profile} size={42} />
        <div className="card-body">
          <div className="card-header">
            <span className="card-author">{display_name_of(author_profile)}</span>
            <span className="card-time">{format_relative_time(notice.createdAt)}</span>
            {is_mine && !editing && (
              <button className="card-edit-btn" onClick={() => { set_edit_text(notice.text); set_editing(true) }}>
                <Pencil size={15} />
              </button>
            )}
          </div>

          {editing ? (
            <div className="card-edit-area">
              <textarea className="card-edit-textarea" value={edit_text} onChange={(e) => set_edit_text(e.target.value)} autoFocus />
              <div className="card-edit-actions">
                <button className="edit-cancel-btn" onClick={() => set_editing(false)}>취소</button>
                <button className="edit-save-btn" onClick={handle_edit_save}><Check size={14} /> 저장</button>
              </div>
            </div>
          ) : (
            <div className="card-text">{notice.text}</div>
          )}

          {/* 투표 */}
          {notice.kind === 'vote' && (
            <div className="vote-area">
              <button className={`vote-btn vote-yes ${my_vote === 'yes' ? 'selected' : ''}`} onClick={() => on_vote(notice.id, 'yes')}>
                👍 Yes {yes_count > 0 && <span className="vote-count">{yes_count}</span>}
              </button>
              <button className={`vote-btn vote-no ${my_vote === 'no' ? 'selected' : ''}`} onClick={() => on_vote(notice.id, 'no')}>
                👎 No {no_count > 0 && <span className="vote-count">{no_count}</span>}
              </button>
            </div>
          )}

          {/* 답글 목록 */}
          {notice.replies.length > 0 && (
            <div className="replies-list">
              {notice.replies.map((r) => {
                const rp = get_profile(r.userId)
                return (
                  <div key={r.id} className="reply-item">
                    <Avatar profile={rp} size={26} />
                    <span className="reply-author">{display_name_of(rp)}</span>
                    <span className="reply-text">{r.text}</span>
                  </div>
                )
              })}
            </div>
          )}

          {/* 답글 입력 */}
          {replying && (
            <div
              className={`reply-input-row ${leaving ? 'reply-slide-out' : 'reply-slide-in'}`}
              onAnimationEnd={on_anim_end}
            >
              <Avatar profile={my_profile} size={26} />
              <input
                className="reply-input"
                placeholder="답글을 입력하세요..."
                value={reply_text}
                onChange={(e) => set_reply_text(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') submit_reply() }}
                autoFocus
              />
            </div>
          )}

          <div className="card-foot">
            <button
              className={`reply-btn ${replying && !leaving ? 'reply-btn-active' : ''}`}
              onClick={replying ? submit_reply : open_reply}
            >
              {replying && !leaving ? '등록' : '답글'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
