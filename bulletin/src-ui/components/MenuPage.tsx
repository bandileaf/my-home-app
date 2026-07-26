import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Plus, Trash2, UtensilsCrossed } from 'lucide-react'
import type { UserSession, UserProfile } from '../types'
import type { useMenu } from '../hooks/useMenu'

type MenuHook = ReturnType<typeof useMenu>

interface MenuPageProps {
  session: UserSession | null
  get_profile: (id: string) => UserProfile | null
  hook: MenuHook
}

function name_of(get_profile: (id: string) => UserProfile | null, id: string): string {
  const p = get_profile(id)
  return p?.alias || p?.hostname || '?'
}

function format_remaining(ms: number): string {
  if (ms <= 0) return '마감'
  const totalMin = Math.floor(ms / 60000)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  if (h > 0) return `${h}시간 ${m}분 남음`
  if (m > 0) return `${m}분 남음`
  return '곧 마감'
}

const DEFAULT_TITLE   = '식사 메뉴 선택'
const QUICK_MINUTES   = [5, 10, 30]

export function MenuPage({ session, get_profile, hook }: MenuPageProps) {
  const [composing, set_composing] = useState(false)
  const [option_drafts, set_option_drafts] = useState<Record<string, string>>({})
  const [, force_tick] = useState(0)

  useEffect(() => {
    invoke('menu_enter').catch(() => {})
  }, [])

  useEffect(() => {
    const t = setInterval(() => force_tick(n => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  function handle_quick_create(minutes: number): void {
    hook.create(DEFAULT_TITLE, Date.now() + minutes * 60_000)
    set_composing(false)
  }

  function handle_add_option(poll_id: string): void {
    const text = (option_drafts[poll_id] || '').trim()
    if (!text) return
    hook.addOption(poll_id, text)
    set_option_drafts(d => ({ ...d, [poll_id]: '' }))
  }

  const open_polls   = hook.polls.filter(p => !p.closed)
  const closed_polls = hook.polls.filter(p => p.closed)

  return (
    <div className="page">
      <div className="page-head">
        <h2>식사 메뉴 투표</h2>
        <button className="menu-new-btn" onClick={() => set_composing(v => !v)}>
          <Plus size={16} /> 새 투표
        </button>
      </div>

      {composing && (
        <div className="menu-compose">
          <span className="menu-compose-label">{DEFAULT_TITLE} · 마감까지</span>
          {QUICK_MINUTES.map(m => (
            <button key={m} className="menu-quick-btn" onClick={() => handle_quick_create(m)}>+{m}분</button>
          ))}
        </div>
      )}

      {hook.polls.length === 0 && !composing && (
        <div className="menu-empty">
          <UtensilsCrossed size={40} strokeWidth={1.2} />
          <div>진행 중인 메뉴 투표가 없어요</div>
        </div>
      )}

      {[...open_polls, ...closed_polls].map(poll => {
        const total_votes = poll.votes.length
        const my_vote = session ? poll.votes.find(v => v.userId === session.userId)?.optionId : undefined
        const can_delete = session?.userId === poll.createdBy

        return (
          <div key={poll.id} className={`menu-poll-card ${poll.closed ? 'closed' : ''}`}>
            <div className="menu-poll-head">
              <div>
                <div className="menu-poll-title">{poll.title}</div>
                <div className="menu-poll-meta">
                  {name_of(get_profile, poll.createdBy)} · {poll.closed ? '마감됨' : format_remaining(poll.deadline - Date.now())}
                </div>
              </div>
              {can_delete && (
                <button className="menu-delete-btn" onClick={() => hook.remove(poll.id)}><Trash2 size={16} /></button>
              )}
            </div>

            {poll.options.length === 0 && (
              <div className="menu-no-options">아직 등록된 메뉴가 없어요. 메뉴를 추가해보세요!</div>
            )}

            {poll.options.map(opt => {
              const count = poll.votes.filter(v => v.optionId === opt.id).length
              const pct = total_votes > 0 ? Math.round((count / total_votes) * 100) : 0
              const selected = my_vote === opt.id
              return (
                <div
                  key={opt.id}
                  className={`menu-option-row ${selected ? 'selected' : ''} ${poll.closed ? 'disabled' : ''}`}
                  onClick={() => { if (!poll.closed) hook.vote(poll.id, opt.id) }}
                >
                  <div className="menu-option-bar" style={{ width: `${pct}%` }} />
                  <div className="menu-option-label">
                    <span>{opt.text}</span>
                    <span className="menu-option-count">{count}표 ({pct}%)</span>
                  </div>
                </div>
              )
            })}

            {!poll.closed && (
              <div className="menu-add-row">
                <input
                  className="menu-add-input"
                  placeholder="메뉴 추가하기..."
                  value={option_drafts[poll.id] || ''}
                  onChange={e => set_option_drafts(d => ({ ...d, [poll.id]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') handle_add_option(poll.id) }}
                />
                <button className="menu-add-btn" onClick={() => handle_add_option(poll.id)}><Plus size={16} /></button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
