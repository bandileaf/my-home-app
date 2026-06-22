import { useState, useEffect, useRef } from 'react'

declare global {
  interface Window {
    toast: {
      onStatus:   (cb: (msg: string) => void) => void
      onProgress: (cb: (pct: number) => void) => void
      onError:    (cb: (msg: string) => void) => void
      onChat:     (cb: (sender: string, text: string) => void) => void
      get_name:   () => Promise<string>
      openLog:    () => void
      openMain:   () => void
      close:      () => void
    }
  }
}

const ACCENT  = '#CBA6F7'  // purple
const BG      = 'rgba(28, 18, 42, 0.93)'
const FRAMES  = ['◐', '◓', '◑', '◒']

export default function Toast() {
  const [message,  setMessage]  = useState('업데이트 확인 중...')
  const [progress, setProgress] = useState<number | null>(null)
  const [error,    setError]    = useState('')
  const [frameIdx, setFrameIdx] = useState(0)
  const [appName,  setAppName]  = useState('')
  type ChatItem = { id: number; sender: string; text: string; fading: boolean }
  const [chats,   setChats]  = useState<ChatItem[]>([])
  const nextId = useRef(0)

  useEffect(() => {
    if (chats.length === 0) window.toast.close()
  }, [chats])

  useEffect(() => {
    window.toast.onStatus(setMessage)
    window.toast.onProgress(setProgress)
    window.toast.onError(setError)
    window.toast.onChat((sender, text) => {
      const id = nextId.current++
      setChats(prev => [...prev.slice(-7), { id, sender, text, fading: false }])
      setTimeout(() => setChats(prev => prev.map(c => c.id === id ? { ...c, fading: true } : c)), 5000)
      setTimeout(() => setChats(prev => prev.filter(c => c.id !== id)), 5700)
    })
    window.toast.get_name().then(setAppName).catch(() => {})
    const id = setInterval(() => setFrameIdx(i => (i + 1) % 4), 350)
    return () => clearInterval(id)
  }, [])

  if (chats.length > 0) return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', gap: 6, padding: '0 0 6px 0' }}>
      {chats.map(chat => (
        <div
          key={chat.id}
          onClick={() => { window.toast.openMain(); window.toast.close() }}
          style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 16px', background: BG, borderRadius: 10,
            cursor: 'pointer', position: 'relative', flexShrink: 0,
            opacity: chat.fading ? 0 : 1, transition: 'opacity 0.7s ease',
          }}
        >
          <button
            onClick={e => { e.stopPropagation(); setChats(prev => prev.filter(c => c.id !== chat.id)) }}
            style={{ position: 'absolute', top: 6, right: 8, background: 'none', border: 'none', cursor: 'pointer', color: '#585b70', fontSize: 12, padding: '2px 4px' }}
          >✕</button>
          <span style={{ color: ACCENT, fontSize: 20, lineHeight: 1, flexShrink: 0 }}>💬</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: ACCENT, fontSize: 11, fontWeight: 'bold', marginBottom: 2 }}>{chat.sender}</div>
            <div style={{ color: '#CDD6F4', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{chat.text}</div>
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      padding: '12px 20px',
      background: BG,
      borderRadius: 10,
      width: '100%', height: '100%',
      position: 'relative',
    }}>
      <button
        onClick={() => window.toast.close()}
        style={{
          position: 'absolute', top: 8, right: 10,
          background: 'none', border: 'none', cursor: 'pointer',
          color: '#585b70', fontSize: 14, lineHeight: 1, padding: '2px 4px',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = '#CDD6F4')}
        onMouseLeave={e => (e.currentTarget.style.color = '#CDD6F4')}
      >✕</button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ color: error ? '#F38BA8' : ACCENT, fontSize: 26, lineHeight: 1, flexShrink: 0 }}>
          {error ? '✕' : FRAMES[frameIdx]}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#A6ADC8', fontSize: 11, fontWeight: 'bold', marginBottom: 3 }}>
            {appName || '...'}
          </div>
          <div style={{ color: error ? '#F38BA8' : '#CDD6F4', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {error || message}
          </div>
        </div>
      </div>

      {error && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#A6ADC8' }}>
          <span onClick={() => window.toast.openLog()} style={{ cursor: 'pointer', textDecoration: 'underline', color: ACCENT }}>
            로그 열기
          </span>
        </div>
      )}

      {!error && progress !== null && (
        <div style={{ marginTop: 8, height: 4, background: '#1e2d4a', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: ACCENT, borderRadius: 2, width: `${progress}%`, transition: 'width 0.15s ease' }} />
        </div>
      )}
    </div>
  )
}
