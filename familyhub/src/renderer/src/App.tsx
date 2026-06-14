import { useState, useEffect } from 'react'

declare global {
  interface Window {
    hub: {
      onStatus: (cb: (data: { message?: string; done: boolean }) => void) => void
      onProgress: (cb: (pct: number) => void) => void
    }
  }
}

const FRAMES = ['◐', '◓', '◑', '◒']

export default function App() {
  const [message, setMessage]   = useState('시작 중...')
  const [frameIdx, setFrameIdx] = useState(0)
  const [progress, setProgress] = useState<number | null>(null)

  useEffect(() => {
    window.hub.onStatus(({ message: msg, done }) => {
      if (done) return
      if (msg) setMessage(msg)
    })
    window.hub.onProgress((pct: number) => {
      setProgress(pct)
    })
    const id = setInterval(() => setFrameIdx(i => (i + 1) % 4), 350)
    return () => clearInterval(id)
  }, [])

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      padding: '12px 20px',
      background: 'rgba(20, 20, 32, 0.92)',
      borderRadius: 10,
      width: '100%',
      height: '100%',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ color: '#CBA6F7', fontSize: 26, lineHeight: 1, flexShrink: 0 }}>
          {FRAMES[frameIdx]}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#A6ADC8', fontSize: 11, fontWeight: 'bold', marginBottom: 3 }}>
            FamilyHub
          </div>
          <div style={{ color: '#CDD6F4', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {message}
          </div>
        </div>
      </div>

      {progress !== null && (
        <div style={{
          marginTop: 8,
          height: 4,
          background: '#313244',
          borderRadius: 2,
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            background: '#CBA6F7',
            borderRadius: 2,
            width: `${progress}%`,
            transition: 'width 0.15s ease',
          }} />
        </div>
      )}
    </div>
  )
}
