import { useEffect, useRef, useState } from 'react'
import { get_bridge, type YoutubeResult, type YoutubeProgress } from '../bridge'

function format_duration(seconds: number): string {
  if (seconds <= 0) return 'LIVE'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function format_views(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K views`
  return `${n} views`
}

type DownloadState =
  | { status: 'idle' }
  | { status: 'downloading'; percent: number; speed: string; eta: string }
  | { status: 'done'; filePath: string }
  | { status: 'error'; message: string }

export function YoutubeSearchPanel(): JSX.Element {
  const [query, set_query] = useState('')
  const [results, set_results] = useState<YoutubeResult[]>([])
  const [searching, set_searching] = useState(false)
  const [searchError, set_searchError] = useState('')
  const [downloads, set_downloads] = useState<Record<string, DownloadState>>({})
  const inputRef = useRef<HTMLInputElement>(null)

  // 메인 → 렌더러 이벤트 구독
  useEffect(() => {
    const bridge = get_bridge()

    const unsubProgress = bridge?.on_youtube_progress?.((p: YoutubeProgress) => {
      set_downloads((prev) => ({
        ...prev,
        [p.url]: {
          status: 'downloading',
          percent: p.percent,
          speed: p.speed,
          eta: p.eta
        }
      }))
    })

    const unsubDone = bridge?.on_youtube_done?.((data) => {
      set_downloads((prev) => ({
        ...prev,
        [data.url]: { status: 'done', filePath: data.filePath }
      }))
    })

    const unsubError = bridge?.on_youtube_error?.((data) => {
      set_downloads((prev) => ({
        ...prev,
        [data.url]: { status: 'error', message: data.message }
      }))
    })

    return () => {
      unsubProgress?.()
      unsubDone?.()
      unsubError?.()
    }
  }, [])

  async function do_search(): Promise<void> {
    const q = query.trim()
    if (!q || searching) return
    const search = get_bridge()?.youtube_search
    if (!search) return
    set_searching(true)
    set_searchError('')
    set_results([])
    try {
      const res = await search(q)
      set_results(res)
    } catch (err) {
      set_searchError(err instanceof Error ? err.message : String(err))
    } finally {
      set_searching(false)
    }
  }

  function on_key_down(e: React.KeyboardEvent): void {
    if (e.key === 'Enter') void do_search()
  }

  function do_download(url: string): void {
    get_bridge()?.youtube_download?.(url)
    set_downloads((prev) => ({
      ...prev,
      [url]: { status: 'downloading', percent: 0, speed: '', eta: '' }
    }))
  }

  function do_cancel(url: string): void {
    get_bridge()?.youtube_cancel?.(url)
    set_downloads((prev) => {
      const next = { ...prev }
      delete next[url]
      return next
    })
  }

  function open_folder(filePath: string): void {
    get_bridge()?.youtube_open_folder?.(filePath)
  }

  function open_url(url: string): void {
    get_bridge()?.youtube_open_url?.(url)
  }

  const available = Boolean(get_bridge()?.youtube_search)

  return (
    <div className="search-panel">
      {/* 검색 입력 */}
      <div className="yt-search-row">
        <input
          ref={inputRef}
          className="search-box yt-search-input"
          placeholder="Search YouTube…"
          value={query}
          onChange={(e) => set_query(e.target.value)}
          onKeyDown={on_key_down}
          disabled={!available}
        />
        <button
          className="yt-search-btn"
          onClick={() => void do_search()}
          disabled={!available || searching || !query.trim()}
        >
          {searching ? '…' : 'Search'}
        </button>
      </div>

      {/* 상태 메시지 */}
      {!available && (
        <div className="empty-hint">YouTube search runs in the app (Electron).</div>
      )}
      {searchError && (
        <div className="yt-error">{searchError}</div>
      )}
      {searching && (
        <div className="empty-hint">Searching YouTube…</div>
      )}

      {/* 결과 목록 */}
      <div className="result-list">
        {!searching && results.length === 0 && !searchError && available && (
          <div className="empty-hint">
            {query.trim() === '' ? 'Type to search YouTube.' : 'No results.'}
          </div>
        )}

        {results.map((item) => {
          const dl = downloads[item.url] ?? { status: 'idle' }
          return (
            <div className="yt-result-row" key={item.id}>
              {/* 썸네일 — 클릭 시 브라우저로 열기 */}
              <div className="yt-thumb-wrap" onClick={() => open_url(item.url)} title="Open on YouTube">
                {item.thumbnail ? (
                  <img
                    className="yt-thumb"
                    src={item.thumbnail}
                    alt=""
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                ) : (
                  <div className="yt-thumb-placeholder" />
                )}
                {item.duration > 0 && (
                  <span className="yt-duration">{format_duration(item.duration)}</span>
                )}
              </div>

              {/* 정보 */}
              <div className="yt-info">
                <div
                  className="yt-title yt-title-link"
                  title={item.title}
                  onClick={() => open_url(item.url)}
                >{item.title}</div>
                <div className="yt-meta">
                  <span className="yt-channel">{item.channel}</span>
                  {item.viewCount !== undefined && (
                    <span className="yt-views">{format_views(item.viewCount)}</span>
                  )}
                </div>

                {/* 다운로드 상태 */}
                {dl.status === 'idle' && (
                  <button className="yt-dl-btn" onClick={() => do_download(item.url)}>
                    ↓ Download Audio
                  </button>
                )}

                {dl.status === 'downloading' && (
                  <div className="yt-progress-wrap">
                    <div className="yt-progress-bar">
                      <div className="yt-progress-fill" style={{ width: `${dl.percent}%` }} />
                    </div>
                    <div className="yt-progress-meta">
                      <span>{Math.round(dl.percent)}%</span>
                      {dl.speed && <span>{dl.speed}</span>}
                      {dl.eta && <span>ETA {dl.eta}</span>}
                      <button className="yt-cancel-btn" onClick={() => do_cancel(item.url)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {dl.status === 'done' && (
                  <div className="yt-done">
                    <span className="yt-done-icon">✓</span>
                    <span
                      className="yt-done-path"
                      title={dl.filePath}
                      onClick={() => open_folder(dl.filePath)}
                    >
                      {dl.filePath.split(/[\\/]/).pop()}
                    </span>
                    <button className="yt-folder-btn" onClick={() => open_folder(dl.filePath)}>
                      Open folder
                    </button>
                  </div>
                )}

                {dl.status === 'error' && (
                  <div className="yt-dl-error" title={dl.message}>
                    <span>✗ Failed</span>
                    <button className="yt-retry-btn" onClick={() => do_download(item.url)}>
                      Retry
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
