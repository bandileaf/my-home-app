import { useState, useEffect } from 'react'

declare global {
  interface Window {
    toast: {
      onStatus:   (cb: (msg: string) => void) => void
      onProgress: (cb: (pct: number) => void) => void
      onError:    (cb: (msg: string) => void) => void
      get_name:   () => Promise<string>
      openLog:    () => void
      close:      () => void
    }
  }
}

const ACCENT  = '#60A5FA'  // blue
const BG      = 'rgba(15, 22, 42, 0.93)'
const FRAMES  = ['◐', '◓', '◑', '◒']

export default function Toast() {
  const [message,  setMessage]  = useState('업데이트 확인 중...')
  const [progress, setProgress] = useState<number | null>(null)
  const [error,    setError]    = useState('')
  const [frameIdx, setFrameIdx] = useState(0)
  const [appName,  setAppName]  = useState('')

  useEffect(() => {
    window.toast.onStatus(setMessage)
    window.toast.onProgress(setProgress)
    window.toast.onError(setError)
    window.toast.get_name().then(setAppName).catch(() => {})
    const id = setInterval(() => setFrameIdx(i => (i + 1) % 4), 350)
    return () => clearInterval(id)
  }, [])

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
        onMouseLeave={e => (e.currentTarget.style.color = '#585b70')}
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
          <span onClick={() => window.toast.openLog()} style={{ cursor: 'pointer', textDecoration: 'underline', color: '#89B4FA' }}>
            로그 열기
          </span>
        </div>
      )}

      {!error && progress !== null && (
        <div style={{ marginTop: 8, height: 4, background: '#313244', borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: ACCENT, borderRadius: 2, width: `${progress}%`, transition: 'width 0.15s ease' }} />
        </div>
      )}
    </div>
  )
}
