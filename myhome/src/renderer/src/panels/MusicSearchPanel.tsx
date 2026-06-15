import { useEffect, useState } from 'react'
import { get_bridge, type SearchHit } from '../bridge'
import { useTabTitle } from '../App'

const MAX_TITLE = 20
function tab_title(q: string): string {
  return q ? `Search — ${q.length > MAX_TITLE ? q.slice(0, MAX_TITLE) + '…' : q}` : 'Search'
}

function format_size(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const kb = bytes / 1024
  if (kb < 1024) {
    return `${Math.round(kb)} KB`
  }
  return `${(kb / 1024).toFixed(1)} MB`
}

export function MusicSearchPanel(): JSX.Element {
  const set_tab_title = useTabTitle()
  const [query, set_query] = useState('')
  const [hits, set_hits] = useState<SearchHit[]>([])
  const [total, set_total] = useState(0)
  const [truncated, set_truncated] = useState(false)
  const [available, set_available] = useState(true)

  useEffect(() => {
    const bridge = get_bridge()
    const search = bridge?.search_files
    if (!search) {
      set_available(false)
      return
    }
    set_available(true)

    const needle = query.trim()
    set_tab_title(tab_title(needle))
    if (needle === '') {
      set_hits([])
      set_total(0)
      set_truncated(false)
      return
    }

    let cancelled = false
    const timer = setTimeout(() => {
      search(needle, { limit: 500 })
        .then((result) => {
          if (cancelled) {
            return
          }
          set_hits(result.hits)
          set_total(result.total)
          set_truncated(result.truncated)
        })
        .catch(() => {
          if (!cancelled) {
            set_hits([])
            set_total(0)
          }
        })
    }, 200)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  function reveal_hit(fullPath: string): void {
    get_bridge()?.reveal_file?.(fullPath)
  }

  function copy_hit(fullPath: string): void {
    get_bridge()?.copy_path?.(fullPath)
  }

  const trimmed = query.trim()

  return (
    <div className="search-panel">
      <input
        className="search-box"
        placeholder="Search music files…"
        value={query}
        onChange={(event) => set_query(event.target.value)}
      />

      {!available ? (
        <div className="result-list">
          <div className="empty-hint">Search runs in the app (Electron).</div>
        </div>
      ) : (
        <>
          <div className="result-meta">
            {trimmed === ''
              ? 'Type to search.'
              : `${total} results${truncated ? ` (showing top ${hits.length})` : ''}`}
          </div>
          <div className="result-list">
            {hits.map((hit) => (
              <div className="result-row" key={hit.fullPath}>
                <div className="result-main">
                  <span className="result-name">{hit.fileName}</span>
                  <span className="result-path">{hit.dirPath}</span>
                </div>
                <span className="result-size">{format_size(hit.sizeBytes)}</span>
                <div className="result-actions">
                  <button title="Open folder" onClick={() => reveal_hit(hit.fullPath)}>📂</button>
                  <button title="Copy path" onClick={() => copy_hit(hit.fullPath)}>📋</button>
                </div>
              </div>
            ))}
            {trimmed !== '' && hits.length === 0 && (
              <div className="empty-hint">No results</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
