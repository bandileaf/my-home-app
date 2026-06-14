import { useState, useEffect } from 'react'

declare global {
  interface Window {
    hub: {
      onStatus: (cb: (data: { message?: string; done: boolean }) => void) => void
    }
  }
}

const FRAMES = ['◐', '◓', '◑', '◒']

export default function App() {
  const [message, setMessage] = useState('시작 중...')
  const [frameIdx, setFrameIdx] = useState(0)

  useEffect(() => {
    window.hub.onStatus(({ message: msg, done }) => {
      if (done) return
      if (msg) setMessage(msg)
    })
    const id = setInterval(() => setFrameIdx(i => (i + 1) % 4), 350)
    return () => clearInterval(id)
  }, [])

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '12px 16px',
      background: 'rgba(20, 20, 32, 0.92)',
      borderRadius: 10,
      width: '100%',
      height: '100%',
    }}>
      <span style={{ color: '#CBA6F7', fontSize: 22, lineHeight: 1, flexShrink: 0 }}>
        {FRAMES[frameIdx]}
      </span>
      <div>
        <div style={{ color: '#A6ADC8', fontSize: 10, fontWeight: 'bold', marginBottom: 2 }}>
          FamilyHub
        </div>
        <div style={{ color: '#CDD6F4', fontSize: 13, minWidth: 220 }}>
          {message}
        </div>
      </div>
    </div>
  )
}
