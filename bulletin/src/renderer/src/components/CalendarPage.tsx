import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X, Trash2, Check } from 'lucide-react'
import type { Identity, Schedule, UserProfile } from '../bridge'
import { display_name_of, initials_of } from '../hooks/useUsers'

const DAYS_KO   = ['일', '월', '화', '수', '목', '금', '토']
const MONTHS_KO = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']
const COLORS    = ['#a78bfa','#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#ec4899']

const PANEL_W = 560
const PANEL_H = 520

function pad2(n: number): string { return String(n).padStart(2, '0') }
function to_ymd(y: number, m: number, d: number): string { return `${y}-${pad2(m+1)}-${pad2(d)}` }
function today_str(): string { const d = new Date(); return to_ymd(d.getFullYear(), d.getMonth(), d.getDate()) }

function parse_hm(t: string): [number, number] {
  const parts = t.split(':')
  return [parseInt(parts[0] ?? '9') || 0, parseInt(parts[1] ?? '0') || 0]
}
function add_hour(t: string): string {
  const [h, m] = parse_hm(t)
  return `${pad2((h + 1) % 24)}:${pad2(m)}`
}
function hm_to_str(h24: number, m: number): string { return `${pad2(h24)}:${pad2(m)}` }

function TimeInput({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }): JSX.Element {
  const [h24, m] = parse_hm(value)
  const is_pm = h24 >= 12
  const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24

  function toggle_ampm(): void {
    if (disabled) return
    onChange(hm_to_str(is_pm ? h24 - 12 : h24 + 12, m))
  }
  function on_h(e: React.ChangeEvent<HTMLInputElement>): void {
    const v = parseInt(e.target.value) || 1
    const clamped = Math.max(1, Math.min(12, v))
    const h24new = is_pm ? (clamped === 12 ? 12 : clamped + 12) : (clamped === 12 ? 0 : clamped)
    onChange(hm_to_str(h24new, m))
  }
  function on_m(e: React.ChangeEvent<HTMLInputElement>): void {
    const v = parseInt(e.target.value) || 0
    onChange(hm_to_str(h24, Math.max(0, Math.min(59, v))))
  }

  return (
    <div className={`cal-tp${disabled ? ' cal-tp-off' : ''}`}>
      <button type="button" className="cal-tp-ampm" onClick={toggle_ampm} disabled={disabled}>
        {is_pm ? '오후' : '오전'}
      </button>
      <input className="cal-tp-h" type="number" min={1} max={12} value={h12} disabled={disabled} onChange={on_h} />
      <span className="cal-tp-colon">:</span>
      <input className="cal-tp-m" type="number" min={0} max={59} value={pad2(m)} disabled={disabled} onChange={on_m} />
    </div>
  )
}

function is_active(s: Schedule, dateStr: string): boolean {
  if (s.repeatWeekly) {
    const dow = new Date(dateStr + 'T00:00:00').getDay()
    return new Date(s.date + 'T00:00:00').getDay() === dow && dateStr >= s.date
  }
  if (s.repeatMonthly) {
    const day = new Date(s.date + 'T00:00:00').getDate()
    return new Date(dateStr + 'T00:00:00').getDate() === day && dateStr >= s.date
  }
  return dateStr >= s.date && dateStr <= (s.endDate ?? s.date)
}

type BarKind = 'single' | 'start' | 'mid' | 'end'
function bar_kind(s: Schedule, dateStr: string): BarKind {
  if (s.repeatWeekly || s.repeatMonthly || !s.endDate || s.date === s.endDate) return 'single'
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
  on_create: (userId: string, title: string, date: string, endDate: string | null, allDay: boolean, startTime: string | null, endTime: string | null, repeatWeekly: boolean, repeatMonthly: boolean, memo: string | null, color: string) => Promise<void>
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

  const [composing,  set_composing]  = useState(false)
  const [compose_pos, set_compose_pos] = useState({ x: 100, y: 100 })
  const drag_off = useRef<{ x: number; y: number } | null>(null)

  const [f_title,   set_f_title]   = useState('')
  const [f_date,    set_f_date]    = useState(today)
  const [f_time,    set_f_time]    = useState('09:00')
  const [f_edate,   set_f_edate]   = useState(today)
  const [f_etime,   set_f_etime]   = useState('10:00')
  const [f_allday,  set_f_allday]  = useState(false)
  const [f_weekly,  set_f_weekly]  = useState(false)
  const [f_monthly, set_f_monthly] = useState(false)
  const [f_memo,    set_f_memo]    = useState('')
  const [f_color,   set_f_color]   = useState(COLORS[0])

  useEffect(() => {
    function on_move(e: MouseEvent): void {
      if (!drag_off.current) return
      set_compose_pos({
        x: Math.max(0, Math.min(window.innerWidth  - PANEL_W - 8, e.clientX - drag_off.current.x)),
        y: Math.max(0, Math.min(window.innerHeight - PANEL_H - 8, e.clientY - drag_off.current.y)),
      })
    }
    function on_up(): void { drag_off.current = null }
    document.addEventListener('mousemove', on_move)
    document.addEventListener('mouseup', on_up)
    return () => { document.removeEventListener('mousemove', on_move); document.removeEventListener('mouseup', on_up) }
  }, [])

  function on_drag_start(e: React.MouseEvent): void {
    drag_off.current = { x: e.clientX - compose_pos.x, y: e.clientY - compose_pos.y }
    e.preventDefault()
  }

  function on_start_time_change(v: string): void {
    set_f_time(v)
    set_f_etime(add_hour(v))
  }

  function prev_month(): void {
    if (month === 0) { set_year(y => y - 1); set_month(11) } else set_month(m => m - 1)
  }
  function next_month(): void {
    if (month === 11) { set_year(y => y + 1); set_month(0) } else set_month(m => m + 1)
  }

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

  const week_events = useMemo(() => {
    return weeks.map(week => {
      const days = week.filter((d): d is string => d !== null)
      if (!days.length) return []
      const ws = days[0], we = days[days.length - 1]
      return schedules
        .filter(s => {
          if (s.repeatWeekly || s.repeatMonthly) return days.some(d => is_active(s, d))
          return s.date <= we && (s.endDate ?? s.date) >= ws
        })
        .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt)
    })
  }, [weeks, schedules])

  function open_compose(d: string, e: React.MouseEvent): void {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    let x = rect.right + 6
    let y = rect.top
    if (x + PANEL_W > window.innerWidth  - 8) x = rect.left - PANEL_W - 6
    if (y + PANEL_H > window.innerHeight - 8) y = window.innerHeight - PANEL_H - 8
    if (y < 8) y = 8
    set_compose_pos({ x, y })
    set_f_title(''); set_f_date(d); set_f_time('09:00')
    set_f_edate(d);  set_f_etime('10:00')
    set_f_allday(false); set_f_weekly(false); set_f_monthly(false)
    set_f_memo(''); set_f_color(COLORS[0])
    set_composing(true)
  }

  async function handle_submit(): Promise<void> {
    if (!f_title.trim() || !identity?.userId) return
    await on_create(
      identity.userId, f_title.trim(), f_date,
      f_edate >= f_date ? f_edate : null,
      f_allday, f_allday ? null : f_time, f_allday ? null : f_etime,
      f_weekly, f_monthly, f_memo.trim() || null, f_color,
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

      {/* ── 달력 ── */}
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
                <div key={wi * 7 + di}
                  className={['cal-cell', !dateStr ? 'cal-cell-empty' : '', dateStr === today ? 'cal-cell-today' : '', dateStr === selected ? 'cal-cell-selected' : '', di === 0 ? 'cal-cell-sun' : di === 6 ? 'cal-cell-sat' : ''].filter(Boolean).join(' ')}
                  onClick={() => dateStr && set_selected(dateStr)}
                  onDoubleClick={e => { if (dateStr) open_compose(dateStr, e) }}
                >
                  {dateStr && (
                    <>
                      <span className="cal-day-num">{parseInt(dateStr.split('-')[2])}</span>
                      <div className="cal-bars">
                        {vis.map(s => {
                          if (!is_active(s, dateStr)) return <div key={s.id} className="cal-bar-gap" />
                          const kind = bar_kind(s, dateStr)
                          return (
                            <div key={s.id} className={`cal-bar cal-bar-${kind}`} style={{ background: s.color }} title={s.title}>
                              {(kind === 'single' || kind === 'start') ? s.title : ' '}
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

      {/* ── 일정 목록 ── */}
      <div className="cal-bottom">
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
                        {ev.repeatMonthly && ' · 매달'}
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
      </div>

      {/* ── 플로팅 입력 패널 ── */}
      {composing && (
        <div className="cal-compose" style={{ left: compose_pos.x, top: compose_pos.y, width: PANEL_W }}>
          <div className="cal-compose-head" onMouseDown={on_drag_start}>
            <span>일정 추가</span>
            <button className="cal-compose-close" onMouseDown={e => e.stopPropagation()} onClick={() => set_composing(false)}><X size={17} /></button>
          </div>
          <div className="cal-compose-body">
            <input className="cal-field" placeholder="제목" value={f_title}
              onChange={e => set_f_title(e.target.value)} autoFocus
              onKeyDown={e => { if (e.key === 'Enter') void handle_submit() }} />
            <div className="cal-color-row">
              {COLORS.map(c => (
                <button key={c} className={`cal-color-dot ${f_color === c ? 'cal-color-dot-sel' : ''}`}
                  style={{ background: c }} onClick={() => set_f_color(c)}>
                  {f_color === c && <Check size={11} color="#fff" strokeWidth={3} />}
                </button>
              ))}
            </div>
            <div className="cal-dt-row">
              <input className="cal-field cal-dt-date" type="date" value={f_date}  onChange={e => set_f_date(e.target.value)} />
              <TimeInput value={f_time}  onChange={on_start_time_change} disabled={f_allday} />
              <span className="cal-sep">~</span>
              <input className="cal-field cal-dt-date" type="date" value={f_edate} onChange={e => set_f_edate(e.target.value)} />
              <TimeInput value={f_etime} onChange={set_f_etime} disabled={f_allday} />
            </div>
            <div className="cal-repeat-row">
              <label className="cal-toggle-inline">
                <input type="checkbox" checked={f_allday}  onChange={e => set_f_allday(e.target.checked)} />
                <span>하루종일</span>
              </label>
              <label className="cal-toggle-inline">
                <input type="checkbox" checked={f_weekly}  onChange={e => { set_f_weekly(e.target.checked);  if (e.target.checked) set_f_monthly(false) }} />
                <span>매주</span>
              </label>
              <label className="cal-toggle-inline">
                <input type="checkbox" checked={f_monthly} onChange={e => { set_f_monthly(e.target.checked); if (e.target.checked) set_f_weekly(false)  }} />
                <span>매달</span>
              </label>
            </div>
            <textarea className="cal-field cal-memo" placeholder="메모 (선택)"
              value={f_memo} onChange={e => set_f_memo(e.target.value)} />
          </div>
          <button className="cal-submit-btn" onClick={() => void handle_submit()}>저장</button>
        </div>
      )}
    </div>
  )
}
