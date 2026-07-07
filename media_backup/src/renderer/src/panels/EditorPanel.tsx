interface EditorPanelProps {
  value: string
  available: boolean
  error: string
  on_change: (text: string) => void
}

// 내용은 App 이 소유한다(드래프트). 저장은 탭의 × 를 누를 때 App 이 수행.
export function EditorPanel({ value, available, error, on_change }: EditorPanelProps): JSX.Element {
  if (!available) {
    return (
      <div className="search-panel">
        <div className="empty-hint">Editing runs in the app (Electron).</div>
      </div>
    )
  }

  return (
    <div className="editor-panel">
      {error !== '' && <div className="editor-error">{error}</div>}
      <textarea
        className="editor-area"
        value={value}
        spellCheck={false}
        onChange={(event) => on_change(event.target.value)}
      />
    </div>
  )
}
