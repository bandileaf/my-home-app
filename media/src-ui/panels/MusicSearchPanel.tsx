import { useEffect, useRef, useState } from 'react'
import { FolderOpen, Copy, Play, Pause } from 'lucide-react'
import { get_bridge, type SearchHit } from '../bridge'
import { useTabCtx } from '../App'
import { usePlayer } from '../shell/PlayerBar'

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
  const { tabId, setTitle } = useTabCtx()
  const { file: activeFile, playing, play, pause } = usePlayer()
  const [query, set_query] = useState('')
  const [hits, set_hits] = useState<SearchHit[]>([])
  const [total, set_total] = useState(0)
  const [truncated, set_truncated] = useState(false)
  const [available, set_available] = useState(true)
  const searchSeq = useRef(0)

  // 복원: 저장된 검색어 로드
  useEffect(() => {
    if (!tabId) return
    get_bridge()?.app_state_get?.(`tab:query:${tabId}`).then((saved) => {
      if (saved) set_query(saved)
    }).catch(() => {})
  }, [tabId])

  // 저장: 검색어 변경 시 DB 에 기록
  useEffect(() => {
    if (!tabId || !query) return
    get_bridge()?.app_state_set?.(`tab:query:${tabId}`, query)
  }, [tabId, query])

  useEffect(() => {
    const bridge = get_bridge()
    const search_fn = bridge?.search_files
    if (!bridge || !search_fn) {
      set_available(false)
      return
    }
    set_available(true)

    const needle = query.trim()
    setTitle(tab_title(needle))
    if (needle === '') {
      set_hits([])
      set_total(0)
      set_truncated(false)
      return
    }

    let cancelled = false
    function run_search(): void {
      const seq = ++searchSeq.current
      search_fn!(needle, { limit: 500 })
        .then((result) => {
          // 응답이 도착 순서가 뒤바뀔 수 있으므로, 가장 마지막에 보낸 요청의 결과만 반영한다
          // (인덱싱 중 index:progress 마다 재검색이 쏟아지는데, DB 락 경합으로 먼저 보낸
          // 요청이 나중에 응답할 수 있음 — 그러면 완료 후에도 화면이 옛 결과로 굳어버린다)
          if (cancelled || seq !== searchSeq.current) {
            return
          }
          set_hits(result.hits)
          set_total(result.total)
          set_truncated(result.truncated)
        })
        .catch(() => {
          if (!cancelled && seq === searchSeq.current) {
            set_hits([])
            set_total(0)
          }
        })
    }

    const timer = setTimeout(run_search, 200)
    // 인덱싱이 진행 중이면 새로 추가되는 파일도 검색 결과에 반영되도록 재검색
    const unsub_progress = bridge.on_index_progress?.(run_search)
    const unsub_done = bridge.on_index_done?.(run_search)

    return () => {
      cancelled = true
      clearTimeout(timer)
      unsub_progress?.()
      unsub_done?.()
    }
  }, [query])

  function reveal_hit(fullPath: string): void {
    get_bridge()?.reveal_file?.(fullPath)
  }

  function copy_hit(fullPath: string): void {
    get_bridge()?.copy_file?.(fullPath)
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
                  <span className="result-player">
                    {activeFile?.fullPath === hit.fullPath && playing
                      ? <button title="Pause" onClick={pause}><Pause size={14} strokeWidth={1.5} /></button>
                      : <button title="Play"  onClick={() => play(hit)}><Play  size={14} strokeWidth={1.5} /></button>
                    }
                  </span>
                  <button title="Open folder" onClick={() => reveal_hit(hit.fullPath)}><FolderOpen size={14} strokeWidth={1.5} /></button>
                  <button title="클립보드에 복사" onClick={() => copy_hit(hit.fullPath)}><Copy size={14} strokeWidth={1.5} /></button>
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
