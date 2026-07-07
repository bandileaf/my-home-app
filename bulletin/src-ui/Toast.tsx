import { useState, useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'

const ACCENT  = '#CBA6F7'
const BG      = 'rgba(28, 18, 42, 0.92)'
const FRAMES  = ['◐', '◓', '◑', '◒']
const FADE_MS = 5000
const GONE_MS = 5700

type ToastEvent =
  | { kind: 'chat';             id: number; sender: string; text: string }
  | { kind: 'notice';           id: number; noticeId: string; title: string }
  | { kind: 'update';           msg: string; pct: number | null; done: boolean }
  | { kind: 'updateCancelled' }

type UpdateState = { msg: string; pct: number | null; done: boolean }

const win = getCurrentWebviewWindow()

function log(msg: string) {
  invoke('log_msg', { msg: `[${win.label}] ${msg}` }).catch(() => {})
}

function close_self(reason: string) {
  log(`close_self called: reason=${reason}`)
  win.hide()
  invoke('toast_closed').catch(e => { log(`toast_closed error: ${e}`) })
}

function open_main(page: string) {
  invoke('show_window')
  invoke('set_active_page', { page })
  close_self('clicked → open_main ' + page)
}

export function ToastApp() {
  const [event,  set_event]  = useState<ToastEvent | null>(null)
  const [update, set_update] = useState<UpdateState | null>(null)
  const [fading, set_fading] = useState(false)
  const [frame,  set_frame]  = useState(0)

  useEffect(() => {
    log(`ToastApp mounted, label=${win.label}`)

    invoke<ToastEvent | null>('get_toast_event')
      .then(ev => {
        log(`get_toast_event result: ${ev ? ev.kind : 'null'}`)
        if (!ev) {
          log('no event → win.destroy immediately')
          win.destroy()
          return
        }
        set_event(ev)
        if (ev.kind === 'update') set_update({ msg: ev.msg, pct: ev.pct ?? null, done: ev.done })
      })
      .catch(e => {
        log(`get_toast_event error: ${e} → win.destroy`)
        win.destroy()
      })

    const unsub = listen<ToastEvent>('toast', e => {
      const ev = e.payload
      log(`listen toast received: ${ev.kind}`)
      if (ev.kind === 'update')          set_update({ msg: ev.msg, pct: ev.pct ?? null, done: ev.done })
      if (ev.kind === 'updateCancelled') close_self('updateCancelled event')
    })
    return () => { unsub.then(f => f()) }
  }, [])

  useEffect(() => {
    if (event?.kind !== 'chat') return
    log(`chat timer started FADE_MS=${FADE_MS} GONE_MS=${GONE_MS}`)
    const t1 = setTimeout(() => { log('fade start'); set_fading(true) }, FADE_MS)
    const t2 = setTimeout(() => close_self('chat timer expired'), GONE_MS)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [event])

  useEffect(() => {
    if (!update?.done) return
    log('update done → 2s timer started')
    const t = setTimeout(() => close_self('update done 2s'), 2000)
    return () => clearTimeout(t)
  }, [update?.done])

  useEffect(() => {
    if (event?.kind !== 'update') return
    const t = setInterval(() => set_frame(i => (i + 1) % 4), 350)
    return () => clearInterval(t)
  }, [event])

  if (!event) return null

  if (event.kind === 'chat') {
    return (
      <div style={card_style(fading)} onClick={() => open_main('chat')}>
        <span style={{ color: ACCENT, fontSize: 20, flexShrink: 0 }}>💬</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: ACCENT, fontSize: 11, fontWeight: 'bold', marginBottom: 2 }}>{event.sender}</div>
          <div style={text_style}>{event.text}</div>
        </div>
      </div>
    )
  }

  if (event.kind === 'notice') {
    return (
      <div style={card_style(false)} onClick={() => open_main('notices')}>
        <button
          onClick={e => { e.stopPropagation(); close_self('notice X button') }}
          style={{ position: 'absolute', top: 6, right: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#585b70', fontSize: 12, padding: '2px 4px' }}
        >✕</button>
        <span style={{ color: '#F9E2AF', fontSize: 20, flexShrink: 0 }}>📌</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#F9E2AF', fontSize: 11, fontWeight: 'bold', marginBottom: 2 }}>공지</div>
          <div style={text_style}>{event.title}</div>
        </div>
      </div>
    )
  }

  if (event.kind === 'update' && update) {
    return (
      <div style={{ ...card_style(false), flexDirection: 'column', cursor: 'default', paddingBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
          <span style={{ color: update.done ? '#A6E3A1' : ACCENT, fontSize: 22, flexShrink: 0 }}>
            {update.done ? '✓' : FRAMES[frame]}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: '#A6ADC8', fontSize: 11, fontWeight: 'bold', marginBottom: 3 }}>업데이트</div>
            <div style={{ color: update.done ? '#A6E3A1' : '#CDD6F4', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {update.msg}
            </div>
          </div>
        </div>
        {update.pct !== null && (
          <div style={{ marginTop: 8, height: 4, background: '#1e2d4a', borderRadius: 2, overflow: 'hidden', width: '100%' }}>
            <div style={{ height: '100%', background: update.done ? '#A6E3A1' : ACCENT, borderRadius: 2, width: `${update.pct}%`, transition: 'width 0.2s ease' }} />
          </div>
        )}
      </div>
    )
  }

  return null
}

const card_style = (fading: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '10px 16px', background: BG, borderRadius: 10,
  cursor: 'pointer', position: 'relative', width: '100%', height: '100%',
  opacity: fading ? 0 : 1, transition: 'opacity 0.7s ease',
  boxSizing: 'border-box',
})

const text_style: React.CSSProperties = {
  color: '#CDD6F4', fontSize: 13,
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
}
