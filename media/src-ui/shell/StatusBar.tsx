export type IndexStatus =
  | { phase: 'disabled' } // 기능이 enable 되어 있지 않음 → 인덱싱 안 함
  | { phase: 'unavailable' } // 브라우저 미리보기 등 Electron API 없음
  | { phase: 'nosettings' } // settings.json 이 아직 없음 (알림으로 생성 유도)
  | { phase: 'pending' } // 시작 대기
  | { phase: 'scanning'; indexed: number }
  | { phase: 'done'; indexed: number; hasTarget: boolean }
  | { phase: 'error'; message: string }

function describe_status(status: IndexStatus): string {
  switch (status.phase) {
    case 'disabled':
      return 'Music Search disabled — not indexing'
    case 'unavailable':
      return 'Indexing runs in the app (Electron)'
    case 'nosettings':
      return 'No settings.json — create it from the notification'
    case 'pending':
      return 'Preparing to index…'
    case 'scanning':
      return `Indexing… ${status.indexed} files`
    case 'done':
      return status.hasTarget
        ? `Indexed ${status.indexed} files`
        : 'No folders to index (check settings.json)'
    case 'error':
      return `Index error: ${status.message}`
  }
}

export function StatusBar({ status }: { status: IndexStatus }): JSX.Element {
  const busy = status.phase === 'scanning' || status.phase === 'pending'
  return (
    <div className={`status-bar${status.phase === 'error' ? ' error' : ''}`}>
      <span className={`status-dot${busy ? ' busy' : ''}`} aria-hidden="true" />
      <span className="status-text">{describe_status(status)}</span>
    </div>
  )
}
