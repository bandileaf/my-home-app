export type IndexStatus =
  | { phase: 'disabled' }
  | { phase: 'unavailable' }
  | { phase: 'nosettings' }
  | { phase: 'pending' }
  | { phase: 'scanning'; indexed: number }
  | { phase: 'done'; indexed: number; hasTarget: boolean }
  | { phase: 'error'; message: string }

export interface ConvertScan {
  current: number
  total: number
}

function describe_status(status: IndexStatus): string {
  switch (status.phase) {
    case 'disabled':   return 'Music Search disabled — not indexing'
    case 'unavailable':return 'Indexing runs in the app (Electron)'
    case 'nosettings': return 'No settings.json — create it from the notification'
    case 'pending':    return 'Preparing to index…'
    case 'scanning':   return `Indexing… ${status.indexed} files`
    case 'done':
      return status.hasTarget
        ? `Indexed ${status.indexed} files`
        : 'No folders to index (check settings.json)'
    case 'error':      return `Index error: ${status.message}`
  }
}

export function StatusBar({ status, convertScan }: { status: IndexStatus; convertScan?: ConvertScan | null }): JSX.Element {
  const busy = status.phase === 'scanning' || status.phase === 'pending'

  const convertText = convertScan && convertScan.total > 0
    ? `Scanning for convertible/damaged files: ${convertScan.current} / ${convertScan.total} (${Math.round(convertScan.current / convertScan.total * 100)}%)`
    : null

  return (
    <div className={`status-bar${status.phase === 'error' ? ' error' : ''}`}>
      <span className={`status-dot${busy || convertText ? ' busy' : ''}`} aria-hidden="true" />
      <span className="status-text">
        {convertText ?? describe_status(status)}
      </span>
    </div>
  )
}
