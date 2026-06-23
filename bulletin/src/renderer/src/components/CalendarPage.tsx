import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, X, Trash2, Check } from 'lucide-react'
import type { Identity, Schedule, UserProfile } from '../bridge'
import { display_name_of, initials_of } from '../hooks/useUsers'

const DAYS_KO  = ['일', '월', '화', '수', '목', '금', '토']
const MONTHS_KO = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']
const COLORS = ['#a78bfa','#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#ec4899']

function pad(n: number): string { return String(n).padStart(2, '0') }
function to_ymd(y: number, m: number, d: number): string { return `${y}-${pad(m+1)}-${pad(d)}` }
function today_str(): string { const d = new Date(); return to_ymd(d.getFullYear(), d.getMonth(), d.getDate()) }

function is_active(s: Schedule, dateStr: string): boolean {
  if (s.repeatWeekly) {
    const dow = new Date(dateStr + 'T00:00:00').getDay()
    return new Date(s.date + 'T00:00:00').getDay() === dow && dateStr >= s.date
  }
  return dateStr >= s.date && dateStr <= (s.endDate ?? s.date)
}

type BarKind = 'single' | 'start' | 'mid' | 'end'

function bar_kind(s: Schedule, dateStr: string): BarKind {
  if (s.repeatWeekly || !s.endDate || s.date === s.endDate) return 'single'
  const dow = new Date(dateStr + 'T00:00:00').getDay()
  const vStart = s.date === dateStr || dow === 0
  const vEnd   = s.endDate === dateStr || dow === 6
  if (vStart && vEnd) return 'single'
  if (vStart) return 'start'
  if (vEnd)   return 'end'
  return 'mid'
}

const MAX_BARS = 2

interface CalendarPageProps {
  identity: Identity | null
  schedules: Schedule[]
  get_profile: (id: string) => UserProfile | null
  on_create: (userId: string, title: string, date: string, endDate: string | null, allDay: boolean, startTime: string | null, endTime: string | null, repeatWeekly: boolean, memo: string | null, color: string) => Promise<void>
  on_delete: (id: string) => Promise<void>
}

function EvtAvatar({ profile }: { profile: UserProfile | null }): JSX.Element {
  const sz = 18
  const style = { width: sz, height: sz, borderRadius: '50%', flexShrink: 0 as const }
  if (profile?.avatar) return <img src={profile.avatar} style={{ ...style, objectFit: 'cover' }} alt="" />
  return <span className="card-avatar-circle" style={{ ...style, fontSize: sz * 0.4 }}>{initials_of(profile)}</span>
}

export function CalendarPage({ identity, schedules, get_profile, on_create, on_delete }: CalendarPageProps): JSX.Element {
  const today = today_str()
  const [year,  set_year]  = useState(() => new Date().getFullYear())
  const [month, set_month] = useState(() => new Date().getMonth())
  const [selected, set_selected] = useState<string>(today)
  const [composing, set_composing] = useState(false)

  const [f_title,  set_f_title]  = useState('')
  const [f_date,   set_f_date]   = useState(today)
  const [f_edate,  set_f_edate]  = useState('')
  const [f_allday, set_f_allday] = useState(true)
  const [f_start,  set_f_start]  = useState('09:00')
  const [f_end,    set_f_end]    = useState('10:00')
  const [f_repeat, set_f_repeat] = useState(false)
  const [f_memo,   set_f_memo]   = useState('')
  const [f_color,  set_f_color]  = useState(COLORS[0])

  function prev_month(): void {
    if (month === 0) { set_year(y => y - 1); set_month(11) } else set_month(m => m - 1)
  }
  function next_month(): void {
    if (month === 11) { set_year(y => y + 1); set_month(0) } else set_month(m => m + 1)
  }

  // calendar grid
  const first_dow = new Date(year, month, 1).getDay()
  const days_in_month = new Date(year, month + 1, 0).getDate()
  const cells: (string | null)[] = [
    ...Array(first_dow).fill(null),
    ...Array.from({ length: days_in_month }, (_, i) => to_ymd(year, month, i + 1)),
  ]
  while (cells.length % 7 !== 0) cells.push(null)

  const weeks = useMemo(() => {
    const ws: (string | null)[][] = []
    for (let i = 0; i < cells.length; i += 7) ws.push(cells.slice(i, i + 7))
    return ws
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month])

  // per-week sorted event list for track-based bar rendering
  const week_events = useMemo(() => {
    return weeks.map(week => {
      const days = week.filter((d): d is string => d !== null)
      if (!days.length) return []
      const ws = days[0], we = days[days.length - 1]
      return schedules
        .filter(s => {
          if (s.repeatWeekly) return days.some(d => is_active(s, d))
          return s.date <= we && (s.endDate ?? s.date) >= ws
        })
        .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt)
    })
  }, [weeks, schedules])

  function open_compose(d: string): void {
    set_f_title(''); set_f_date(d); set_f_edate(''); set_f_allday(true)
    set_f_start('09:00'); set_f_end('10:00'); set_f_repeat(false)
    set_f_memo(''); set_f_color(COLORS[0])
    set_composing(true)
  }

  async function handle_submit(): Promise<void> {
    if (!f_title.trim() || !identity?.userId) return
    await on_create(
      identity.userId, f_title.trim(), f_date,
      f_edate && f_edate > f_date ? f_edate : null,
      f_allday, f_allday ? null : f_start, f_allday ? null : f_end,
      f_repeat, f_memo.trim() || null, f_color,
    )
    set_composing(false)
  }

  const sel_events = useMemo(() =>
    schedules.filter(s => is_active(s, selected)).sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
      return (a.startTime ?? '') < (b.startTime ?? '') ? -1 : 1
    }), [schedules, selected])

  const sel_d = new Date(selected + 'T00:00:00')
  const sel_label = `${sel_d.getMonth()+1}월 ${sel_d.getDate()}일 (${DAYS_KO[sel_d.getDay()]})`

  return (
    <div className="page calendar-page">

      {/* ── 상단 2/3: 달력 ── */}
      <div className="cal-top">
        <div className="cal-header">
          <button className="cal-nav-btn" onClick={prev_month}><ChevronLeft size={17} /></button>
          <span className="cal-month-label">{year}년 {MONTHS_KO[month]}</span>
          <button className="cal-nav-btn" onClick={next_month}><ChevronRight size={17} /></button>
          <div style={{ flex: 1 }} />
        </div>

        <div className="cal-dow-row">
          {DAYS_KO.map(d => <span key={d} className="cal-dow">{d}</span>)}
        </div>

        <div className="cal-grid">
          {weeks.flatMap((week, wi) =>
            week.map((dateStr, di) => {
              const row_evts = week_events[wi] ?? []
              const vis = row_evts.slice(0, MAX_BARS)
              const overflow = dateStr ? row_evts.slice(MAX_BARS).filter(s => is_active(s, dateStr)).length : 0
              return (
                <div
                  key={wi * 7 + di}
                  className={[
                    'cal-cell',
                    !dateStr           ? 'cal-cell-empty'    : '',
                    dateStr === today    ? 'cal-cell-today'    : '',
                    dateStr === selected ? 'cal-cell-selected' : '',
                    di === 0 ? 'cal-cell-sun' : di === 6 ? 'cal-cell-sat' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => dateStr && set_selected(dateStr)}
                  onDoubleClick={() => dateStr && open_compose(dateStr)}
                >
                  {dateStr && (
                    <>
                      <span className="cal-day-num">{parseInt(dateStr.split('-')[2])}</span>
                      <div className="cal-bars">
                        {vis.map(s => {
                          if (!is_active(s, dateStr)) return <div key={s.id} className="cal-bar-gap" />
                          const kind = bar_kind(s, dateStr)
                          return (
                            <div key={s.id} className={`cal-bar cal-bar-${kind}`}
                              style={{ background: s.color }} title={s.title}>
                              {(kind === 'single' || kind === 'start') ? s.title : ' '}
                            </div>
                          )
                        })}
                        {overflow > 0 && <div className="cal-bar-more">+{overflow}</div>}
                      </div>
                    </>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* ── 하단 1/3: 일정 목록 or 입력폼 ── */}
      <div className="cal-bottom">
        {composing ? (
          <div className="cal-compose">
            <div className="cal-compose-head">
              <span>일정 추가</span>
              <button className="cal-compose-close" onClick={() => set_composing(false)}><X size={17} /></button>
            </div>
            <div className="cal-compose-body">
              <input className="cal-field" placeholder="제목" value={f_title}
                onChange={e => set_f_title(e.target.value)} autoFocus
                onKeyDown={e => { if (e.key === 'Enter') void handle_submit() }} />
              <div className="cal-date-row">
                <input className="cal-field" type="date" value={f_date} onChange={e => set_f_date(e.target.value)} />
                <span className="cal-sep">~</span>
                <input className="cal-field" type="date" value={f_edate} onChange={e => set_f_edate(e.target.value)} />
              </div>
              <label className="cal-toggle-row">
                <span>하루 종일</span>
                <input type="checkbox" checked={f_allday} onChange={e => set_f_allday(e.target.checked)} />
              </label>
              {!f_allday && (
                <div className="cal-time-row">
                  <input className="cal-field cal-time" type="time" value={f_start} onChange={e => set_f_start(e.target.value)} />
                  <span className="cal-sep">~</span>
                  <input className="cal-field cal-time" type="time" value={f_end} onChange={e => set_f_end(e.target.value)} />
                </div>
              )}
              <label className="cal-toggle-row">
                <span>매주 반복</span>
                <input type="checkbox" checked={f_repeat} onChange={e => set_f_repeat(e.target.checked)} />
              </label>
              <div className="cal-color-row">
                {COLORS.map(c => (
                  <button key={c} className={`cal-color-dot ${f_color === c ? 'cal-color-dot-sel' : ''}`}
                    style={{ background: c }} onClick={() => set_f_color(c)}>
                    {f_color === c && <Check size={11} color="#fff" strokeWidth={3} />}
                  </button>
                ))}
              </div>
              <textarea className="cal-field cal-memo" placeholder="메모 (선택)"
                value={f_memo} onChange={e => set_f_memo(e.target.value)} />
            </div>
            <button className="cal-submit-btn" onClick={() => void handle_submit()}>저장</button>
          </div>
        ) : (
          <>
            <div className="cal-events-head">
              <span className="cal-events-label">{sel_label}</span>
            </div>
            {sel_events.length === 0
              ? <div className="cal-events-empty">일정 없음 — 더블클릭으로 추가</div>
              : (
                <div className="cal-events-list">
                  {sel_events.map(ev => {
                    const profile = get_profile(ev.userId)
                    const is_mine = ev.userId === identity?.userId
                    return (
                      <div key={ev.id} className="cal-event-item">
                        <div className="cal-event-accent" style={{ background: ev.color }} />
                        <div className="cal-event-body">
                          <span className="cal-event-title">{ev.title}</span>
                          <span className="cal-event-meta">
                            {ev.allDay ? '하루 종일' : `${ev.startTime}~${ev.endTime}`}
                            {ev.repeatWeekly && ' · 매주'}
                            {ev.endDate && ` · ~${ev.endDate.slice(5)}`}
                          </span>
                          {ev.memo && <span className="cal-event-memo">{ev.memo}</span>}
                          <div className="cal-event-author">
                            <EvtAvatar profile={profile} />
                            <span>{display_name_of(profile)}</span>
                          </div>
                        </div>
                        {is_mine && (
                          <button className="cal-event-del" onClick={() => void on_delete(ev.id)}>
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            }
          </>
        )}
      </div>
    </div>
  )
}
