import { useState, useEffect } from 'react'

declare global {
  interface Window {
    hub: {
      onInit: (cb: (data: { version: string; logPath: string }) => void) => void
      onStatus: (cb: (data: { message?: string; done: boolean }) => void) => void
      onProgress: (cb: (pct: number) => void) => void
      onError: (cb: (logPath: string) => void) => void
      openLog: () => void
      close: () => void
    }
  }
}

const FRAMES = ['◐', '◓', '◑', '◒']

export default function App() {
  const [message, setMessage]       = useState('시작 중...')
  const [frameIdx, setFrameIdx]     = useState(0)
  const [progress, setProgress]     = useState<number | null>(null)
  const [version, setVersion]       = useState('')
  const [errorLogPath, setErrorLogPath] = useState('')

  useEffect(() => {
    window.hub.onInit(({ version: v }) => setVersion(v))
    window.hub.onStatus(({ message: msg, done }) => {
      if (done) return
      if (msg) setMessage(msg)
    })
    window.hub.onProgress((pct: number) => setProgress(pct))
    window.hub.onError((lp) => setErrorLogPath(lp))
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
      position: 'relative',
    }}>
      <button
        onClick={() => window.hub.close()}
        style={{
          position: 'absolute', top: 8, right: 10,
          background: 'none', border: 'none', cursor: 'pointer',
          color: '#585b70', fontSize: 14, lineHeight: 1, padding: '2px 4px',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = '#CDD6F4')}
        onMouseLeave={e => (e.currentTarget.style.color = '#585b70')}
      >✕</button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ color: errorLogPath ? '#F38BA8' : '#CBA6F7', fontSize: 26, lineHeight: 1, flexShrink: 0 }}>
          {errorLogPath ? '✕' : FRAMES[frameIdx]}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: '#A6ADC8', fontSize: 11, fontWeight: 'bold', marginBottom: 3 }}>
            FamilyHub {version && <span style={{ fontWeight: 'normal', opacity: 0.7 }}>{version}</span>}
          </div>
          <div style={{ color: errorLogPath ? '#F38BA8' : '#CDD6F4', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {errorLogPath ? '실패했습니다' : message}
          </div>
        </div>
      </div>

      {errorLogPath && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#A6ADC8' }}>
          로그:{' '}
          <span
            onClick={() => window.hub.openLog()}
            style={{ cursor: 'pointer', textDecoration: 'underline', color: '#89B4FA' }}
          >
            {errorLogPath}
          </span>
        </div>
      )}

      {!errorLogPath && progress !== null && (
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
