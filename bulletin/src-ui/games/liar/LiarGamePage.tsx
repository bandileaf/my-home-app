import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Send, VenetianMask } from 'lucide-react'
import type { UserSession, UserProfile } from '../../types'
import type { useLiarGame } from './useLiarGame'

type LiarHook = ReturnType<typeof useLiarGame>

interface LiarGamePageProps {
  session: UserSession | null
  get_profile: (id: string) => UserProfile | null
  hook: LiarHook
  on_back: () => void
}

function name_of(get_profile: (id: string) => UserProfile | null, id: string): string {
  const p = get_profile(id)
  // users 목록에서 프로필을 못 찾은 경우 원인 파악이 가능하도록 순수 '?' 대신 id 일부를 남긴다
  return p?.alias || p?.hostname || `?(${id.slice(0, 6)})`
}

export function LiarGamePage({ session, get_profile, hook, on_back }: LiarGamePageProps) {
  const { room, error } = hook
  const [text, set_text] = useState('')
  const [selected_vote, set_selected_vote] = useState<string | null>(null)
  const [finding, set_finding] = useState(false)
  const bottom_ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    hook.join()
    return () => { hook.leave() }
  }, [])

  useEffect(() => {
    bottom_ref.current?.scrollIntoView({ behavior: 'instant' })
  }, [hook.messages])

  const my_id = session?.userId

  // 투표 단계에 들어올 때 이미 낸 표가 있으면 그걸 선택 상태로 복원, 아니면 초기화
  useEffect(() => {
    if (room?.phase === 'voting') {
      set_selected_vote(room.votes.find(v => v.userId === my_id)?.targetUserId ?? null)
    } else {
      set_selected_vote(null)
    }
  }, [room?.phase, room?.id])

  function send(): void {
    const trimmed = text.trim()
    if (!trimmed || !room) return
    set_text('')
    hook.sendMessage(room.id, trimmed)
  }

  async function handle_find(): Promise<void> {
    if (!room || finding) return
    set_finding(true)
    await hook.openVoting(room.id)
    set_finding(false)
  }

  return (
    <div className="page">
      <div className="page-head">
        <button className="liar-back-btn" onClick={on_back}><ArrowLeft size={18} /> 게임 목록</button>
        <h2><VenetianMask size={22} style={{ verticalAlign: 'middle', marginRight: 8 }} />라이어 게임</h2>
      </div>

      {error && <div className="chat-error-banner">{error}</div>}

      {!room && !error && <div className="menu-empty">참가 중...</div>}

      {room && (
        <div className="liar-panel">
          <div className={`liar-reveal-card ${room.yourRole === 'liar' ? 'is-liar' : ''}`}>
            <div className="liar-reveal-text">
              {room.phase === 'waiting' ? '' :
                room.phase === 'ended'
                  ? (room.result === 'citizens_win' ? '라이어를 찾았습니다! 라이어: ' : '라이어를 찾지 못했습니다. 라이어: ') +
                    (room.liarUserId ? name_of(get_profile, room.liarUserId) : '?') + ` · 제시어: ${room.word}`
                  : room.yourRole === 'liar' ? '당신은 "라이어" 입니다.' : `제시어는 "${room.word}" 입니다.`}
            </div>
          </div>

          <div className="liar-room-row-layout">
            <div className="liar-chat-col">
              <div className="chat-messages">
                {hook.messages.length === 0 && (
                  <div className="liar-chat-empty">참가자끼리만 보이는 대화방이에요. 대화를 나눠보세요.</div>
                )}
                {hook.messages.map(m => {
                  const is_mine = m.userId === my_id
                  return (
                    <div key={m.id} className={`chat-row ${is_mine ? 'chat-row-mine' : 'chat-row-other'}`}>
                      <div className="liar-chat-msg-col">
                        {!is_mine && <span className="liar-chat-sender">{name_of(get_profile, m.userId)}</span>}
                        <div className={`chat-bubble ${is_mine ? 'chat-bubble-mine' : 'chat-bubble-other'}`}>{m.text}</div>
                      </div>
                    </div>
                  )
                })}
                <div ref={bottom_ref} />
              </div>
              <div className="chat-input-row">
                <input
                  className="chat-input"
                  placeholder="참가자끼리만 보이는 대화..."
                  value={text}
                  onChange={(e) => set_text(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') send() }}
                />
                <button className="chat-send-btn" onClick={send}><Send size={20} /></button>
              </div>
            </div>

            <div className="liar-participant-col">
              <div className="liar-room-list-title">참가자</div>
              {room.participants.map(p => {
                const is_me = p.userId === my_id
                const count = room.votes.filter(v => v.targetUserId === p.userId).length
                const selectable = room.phase === 'voting'
                const selected = selectable && selected_vote === p.userId
                return (
                  <div
                    key={p.userId}
                    className={`liar-room-row ${selectable ? 'selectable' : ''} ${selected ? 'selected' : ''}`}
                    onClick={() => { if (selectable) set_selected_vote(p.userId) }}
                  >
                    <span>{name_of(get_profile, p.userId)}</span>
                    {room.phase === 'waiting' && (
                      is_me ? (
                        <button
                          className={`liar-ready-btn ${p.ready ? 'ready' : ''}`}
                          onClick={(e) => { e.stopPropagation(); hook.toggleReady(room.id) }}
                        >{p.ready ? 'OK' : 'READY'}</button>
                      ) : (
                        <span className={`liar-ready-badge ${p.ready ? 'ready' : ''}`}>{p.ready ? 'OK' : '대기 중'}</span>
                      )
                    )}
                    {room.phase === 'voting' && <span className="liar-vote-counter">{count}표</span>}
                  </div>
                )
              })}

              {(room.phase === 'waiting' || room.phase === 'playing') && (
                <button
                  className="liar-primary-btn liar-vote-submit-btn"
                  disabled={room.phase === 'waiting' || finding}
                  onClick={handle_find}
                >
                  {finding ? '찾기 완료' : '찾기'}
                </button>
              )}
              {room.phase === 'voting' && (
                <button
                  className="liar-primary-btn liar-vote-submit-btn"
                  disabled={!selected_vote}
                  onClick={() => { if (selected_vote) hook.castVote(room.id, selected_vote) }}
                >투표 완료</button>
              )}
              {room.phase === 'ended' && (
                <button className="liar-primary-btn liar-vote-submit-btn" onClick={() => hook.join()}>새 게임 참가</button>
              )}
            </div>
          </div>

          {room.phase === 'ended' && room.mutedUserIds.length > 0 && (
            <div className="liar-hint">채팅 제한: {room.mutedUserIds.map(id => name_of(get_profile, id)).join(', ')}</div>
          )}
        </div>
      )}
    </div>
  )
}
