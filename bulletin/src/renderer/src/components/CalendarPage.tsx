import { useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, X, Trash2 } from 'lucide-react'
import type { Identity, Schedule, UserProfile } from '../bridge'
import { display_name_of, initials_of } from '../hooks/useUsers'

const DAYS_KO = ['일', '월', '화', '수', '목', '금', '토']
const MONTHS_KO = ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월']

function pad(n: number): string { return String(n).padStart(2, '0') }

function date_str(y: number, m: number, d: number): string {
  return `${y}-${pad(m + 1)}-${pad(d)}`
}

function today_str(): string {
  const d = new Date()
  return date_str(d.getFullYear(), d.getMonth(), d.getDate())
}

interface CalendarPageProps {
  identity: Identity | null
  schedules: Schedule[]
  get_profile: (id: string) => UserProfile | null
  on_create: (userId: string, title: string, date: string, endDate: string | null, allDay: boolean, startTime: string | null, endTime: string | null, repeatWeekly: boolean, memo: string | null) => Promise<void>
  on_delete: (id: string) => Promise<void>
}

function EventAvatar({ profile }: { profile: UserProfile | null }): JSX.Element {
  const size = 20
  const style = { width: size, height: size, borderRadius: '50%', flexShrink: 0 as const }
  if (profile?.avatar) return <img src={profile.avatar} style={{ ...style, objectFit: 'cover' }} alt="" />
  return <span className="card-avatar-circle" style={{ ...style, fontSize: size * 0.38 }}>{initials_of(profile)}</span>
}

export function CalendarPage({ identity, schedules, get_profile, on_create, on_delete }: CalendarPageProps): JSX.Element {
  const today = today_str()
  const [year,  set_year]  = useState(() => new Date().getFullYear())
  const [month, set_month] = useState(() => new Date().getMonth())
  const [selected, set_selected] = useState<string>(today)
  const [composing, set_composing] = useState(false)

  const [form_title,  set_form_title]  = useState('')
  const [form_date,   set_form_date]   = useState(today)
  const [form_all_day, set_form_all_day] = useState(true)
  const [form_start,  set_form_start]  = useState('09:00')
  const [form_end,    set_form_end]    = useState('10:00')
  const [form_repeat, set_form_repeat] = useState(false)
  const [form_memo,   set_form_memo]   = useState('')

  function prev_month(): void {
    if (month === 0) { set_year(y => y - 1); set_month(11) }
    else set_month(m => m - 1)
  }
  function next_month(): void {
    if (month === 11) { set_year(y => y + 1); set_month(0) }
    else set_month(m => m + 1)
  }

  function events_for_day(d: string): Schedule[] {
    const dow = new Date(d + 'T00:00:00').getDay()
    return schedules.filter(s => {
      if (s.repeatWeekly) return new Date(s.date + 'T00:00:00').getDay() === dow && d >= s.date
      if (s.endDate) return d >= s.date && d <= s.endDate
      return s.date === d
    }).sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
      return (a.startTime ?? '') < (b.startTime ?? '') ? -1 : 1
    })
  }

  // Build month grid
  const first_dow = new Date(year, month, 1).getDay()
  const days_in_month = new Date(year, month + 1, 0).getDate()
  const cells: (string | null)[] = [
    ...Array(first_dow).fill(null),
    ...Array.from({ length: days_in_month }, (_, i) => date_str(year, month, i + 1)),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  function open_compose(d: string): void {
    set_form_title(''); set_form_date(d); set_form_all_day(true)
    set_form_start('09:00'); set_form_end('10:00')
    set_form_repeat(false); set_form_memo('')
    set_composing(true)
  }

  async function handle_submit(): Promise<void> {
    if (!form_title.trim() || !identity?.userId) return
    await on_create(
      identity.userId, form_title.trim(), form_date, null, form_all_day,
      form_all_day ? null : form_start, form_all_day ? null : form_end,
      form_repeat, form_memo.trim() || null,
    )
    set_composing(false)
  }

  const sel_events = events_for_day(selected)
  const sel_d = new Date(selected + 'T00:00:00')
  const sel_label = `${sel_d.getMonth() + 1}월 ${sel_d.getDate()}일 (${DAYS_KO[sel_d.getDay()]})`

  return (
    <div className="page calendar-page">
      {/* Header */}
      <div className="cal-header">
        <button className="cal-nav-btn" onClick={prev_month}><ChevronLeft size={18} /></button>
        <span className="cal-month-label">{year}년 {MONTHS_KO[month]}</span>
        <button className="cal-nav-btn" onClick={next_month}><ChevronRight size={18} /></button>
        <div className="cal-header-spacer" />
        <button className="cal-add-btn" onClick={() => open_compose(selected)}><Plus size={18} /> 추가</button>
      </div>

      {/* Day-of-week row */}
      <div className="cal-dow-row">
        {DAYS_KO.map(d => <span key={d} className="cal-dow">{d}</span>)}
      </div>

      {/* Grid */}
      <div className="cal-grid">
        {cells.map((d, i) => (
          <div
            key={i}
            className={['cal-cell', d ? '' : 'cal-cell-empty', d === today ? 'cal-cell-today' : '', d === selected ? 'cal-cell-selected' : ''].filter(Boolean).join(' ')}
            onClick={() => d && set_selected(d)}
          >
            {d && (
              <>
                <span className="cal-day-num">{parseInt(d.split('-')[2])}</span>
                {events_for_day(d).length > 0 && <span className="cal-dot" />}
              </>
            )}
          </div>
        ))}
      </div>

      {/* Selected day events */}
      <div className="cal-events-panel">
        <div className="cal-events-head">
          <span className="cal-events-label">{sel_label}</span>
        </div>
        {sel_events.length === 0
          ? <div className="cal-events-empty">일정이 없습니다</div>
          : (
            <div className="cal-events-list">
              {sel_events.map(ev => {
                const profile = get_profile(ev.userId)
                const is_mine = ev.userId === identity?.userId
                return (
                  <div key={ev.id} className="cal-event-item">
                    <div className="cal-event-accent" />
                    <div className="cal-event-body">
                      <div className="cal-event-title">{ev.title}</div>
                      <div className="cal-event-meta">
                        {ev.allDay ? '하루 종일' : `${ev.startTime} ~ ${ev.endTime}`}
                        {ev.repeatWeekly && ' · 매주'}
                      </div>
                      {ev.memo && <div className="cal-event-memo">{ev.memo}</div>}
                      <div className="cal-event-author">
                        <EventAvatar profile={profile} />
                        <span>{display_name_of(profile)}</span>
                      </div>
                    </div>
                    {is_mine && (
                      <button className="cal-event-del" onClick={() => void on_delete(ev.id)}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )
        }
      </div>

      {/* Compose overlay */}
      {composing && (
        <div className="cal-overlay" onClick={() => set_composing(false)}>
          <div className="cal-compose" onClick={e => e.stopPropagation()}>
            <div className="cal-compose-head">
              <span>일정 추가</span>
              <button className="cal-compose-close" onClick={() => set_composing(false)}><X size={18} /></button>
            </div>
            <div className="cal-compose-body">
              <input className="cal-field" placeholder="제목" value={form_title} onChange={e => set_form_title(e.target.value)} autoFocus onKeyDown={e => { if (e.key === 'Enter') void handle_submit() }} />
              <input className="cal-field" type="date" value={form_date} onChange={e => set_form_date(e.target.value)} />
              <label className="cal-toggle-row">
                <span>하루 종일</span>
                <input type="checkbox" checked={form_all_day} onChange={e => set_form_all_day(e.target.checked)} />
              </label>
              {!form_all_day && (
                <div className="cal-time-row">
                  <input className="cal-field cal-time" type="time" value={form_start} onChange={e => set_form_start(e.target.value)} />
                  <span className="cal-time-sep">~</span>
                  <input className="cal-field cal-time" type="time" value={form_end} onChange={e => set_form_end(e.target.value)} />
                </div>
              )}
              <label className="cal-toggle-row">
                <span>매주 반복</span>
                <input type="checkbox" checked={form_repeat} onChange={e => set_form_repeat(e.target.checked)} />
              </label>
              <textarea className="cal-field cal-memo" placeholder="메모 (선택)" value={form_memo} onChange={e => set_form_memo(e.target.value)} />
            </div>
            <button className="cal-submit-btn" onClick={() => void handle_submit()}>저장</button>
          </div>
        </div>
      )}
    </div>
  )
}
