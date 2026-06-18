import { useEffect, useRef, useState } from 'react'
import { AudioLines, FileVideo2 } from 'lucide-react'
import { get_bridge, type YoutubeResult } from '../bridge'
import { useTabCtx } from '../App'

const MAX_TITLE = 20
function tab_title(q: string): string {
  return q ? `YouTube — ${q.length > MAX_TITLE ? q.slice(0, MAX_TITLE) + '…' : q}` : 'YouTube Search'
}

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

function ProgressBar({ label, percent, speed, eta, onCancel }: {
  label: string; percent: number; speed: string; eta: string; onCancel: () => void
}): JSX.Element {
  return (
    <div className="yt-progress-wrap">
      <div className="yt-progress-bar">
        <div className="yt-progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="yt-progress-meta">
        <span>{label} {Math.round(percent)}%</span>
        {speed && <span>{speed}</span>}
        {eta && <span>ETA {eta}</span>}
        <button className="yt-cancel-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

function DoneRow({ label, filePath, onOpen }: {
  label: string; filePath: string; onOpen: () => void
}): JSX.Element {
  return (
    <div className="yt-done">
      <span className="yt-done-icon">✓</span>
      <span className="yt-done-label">{label}</span>
      <span className="yt-done-path" title={filePath} onClick={onOpen}>
        {filePath.split(/[\\/]/).pop()}
      </span>
      <button className="yt-folder-btn" onClick={onOpen}>Open folder</button>
    </div>
  )
}

function ErrorRow({ message, onRetry }: { message: string; onRetry: () => void }): JSX.Element {
  return (
    <div className="yt-dl-error" title={message}>
      <span>✗ Failed</span>
      <button className="yt-retry-btn" onClick={onRetry}>Retry</button>
    </div>
  )
}

export function YoutubeSearchPanel(): JSX.Element {
  const { tabId, setTitle } = useTabCtx()
  const [query, set_query] = useState('')
  const [results, set_results] = useState<YoutubeResult[]>([])
  const [searching, set_searching] = useState(false)
  const [searchError, set_searchError] = useState('')
  const [downloads, set_downloads] = useState<Record<string, DownloadState>>({})
  const [videoDownloads, set_video_downloads] = useState<Record<string, DownloadState>>({})
  const [ytdlpReady, set_ytdlpReady] = useState(false)
  const pendingSearch = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // 복원: 저장된 검색어 로드
  useEffect(() => {
    if (!tabId) return
    get_bridge()?.app_state_get?.(`tab:query:${tabId}`).then((saved) => {
      if (saved) { set_query(saved); pendingSearch.current = true }
    }).catch(() => {})
  }, [tabId])

  // ytdlpReady 되면 pending 검색 실행
  useEffect(() => {
    if (ytdlpReady && pendingSearch.current) {
      pendingSearch.current = false
      void do_search()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytdlpReady])

  useEffect(() => {
    const bridge = get_bridge()
    void bridge?.get_bins?.().then((bins) => { set_ytdlpReady('yt-dlp.exe' in bins) })
    const u1 = bridge?.on_youtube_progress?.((p) => {
      set_downloads((prev) => ({ ...prev, [p.url]: { status: 'downloading', percent: p.percent, speed: p.speed, eta: p.eta } }))
    })
    const u2 = bridge?.on_youtube_done?.((data) => {
      set_downloads((prev) => ({ ...prev, [data.url]: { status: 'done', filePath: data.filePath } }))
    })
    const u3 = bridge?.on_youtube_error?.((data) => {
      set_downloads((prev) => ({ ...prev, [data.url]: { status: 'error', message: data.message } }))
    })
    const u4 = bridge?.on_youtube_progress_video?.((p) => {
      set_video_downloads((prev) => ({ ...prev, [p.url]: { status: 'downloading', percent: p.percent, speed: p.speed, eta: p.eta } }))
    })
    const u5 = bridge?.on_youtube_done_video?.((data) => {
      set_video_downloads((prev) => ({ ...prev, [data.url]: { status: 'done', filePath: data.filePath } }))
    })
    const u6 = bridge?.on_youtube_error_video?.((data) => {
      set_video_downloads((prev) => ({ ...prev, [data.url]: { status: 'error', message: data.message } }))
    })
    return () => { u1?.(); u2?.(); u3?.(); u4?.(); u5?.(); u6?.() }
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
      setTitle(tab_title(q))
      if (tabId) get_bridge()?.app_state_set?.(`tab:query:${tabId}`, q)
    } catch (err) {
      set_searchError(err instanceof Error ? err.message : String(err))
    } finally {
      set_searching(false)
    }
  }

  function on_key_down(e: React.KeyboardEvent): void {
    if (e.key === 'Enter') void do_search()
  }

  function do_download(url: string, audioFormat: string): void {
    get_bridge()?.youtube_download?.(url, audioFormat)
    set_downloads((prev) => ({
      ...prev,
      [url]: { status: 'downloading', percent: 0, speed: '', eta: '' }
    }))
  }

  function do_download_video(url: string): void {
    get_bridge()?.youtube_download_video?.(url)
    set_video_downloads((prev) => ({ ...prev, [url]: { status: 'downloading', percent: 0, speed: '', eta: '' } }))
  }

  function do_cancel(url: string): void {
    get_bridge()?.youtube_cancel?.(url)
    set_downloads((prev) => { const next = { ...prev }; delete next[url]; return next })
  }

  function do_cancel_video(url: string): void {
    get_bridge()?.youtube_cancel_video?.(url)
    set_video_downloads((prev) => { const next = { ...prev }; delete next[url]; return next })
  }

  function open_folder(filePath: string): void {
    get_bridge()?.youtube_open_folder?.(filePath)
  }

  function open_url(url: string): void {
    get_bridge()?.youtube_open_url?.(url)
  }

  const bridgeAvailable = Boolean(get_bridge()?.youtube_search)
  const ready = bridgeAvailable && ytdlpReady

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
          disabled={!ready}
        />
        <button
          className="yt-search-btn"
          onClick={() => void do_search()}
          disabled={!ready || searching || !query.trim()}
        >
          {searching ? '…' : 'Search'}
        </button>
      </div>

      {/* 상태 메시지 */}
      {!bridgeAvailable && (
        <div className="empty-hint">YouTube search runs in the app (Electron).</div>
      )}
      {bridgeAvailable && !ytdlpReady && (
        <div className="empty-hint">yt-dlp 준비 중...</div>
      )}
      {searchError && (
        <div className="yt-error">{searchError}</div>
      )}
      {searching && (
        <div className="empty-hint">Searching YouTube…</div>
      )}

      {/* 결과 목록 */}
      <div className="result-list">
        {!searching && results.length === 0 && !searchError && ready && (
          <div className="empty-hint">
            {query.trim() === '' ? 'Type to search YouTube.' : 'No results.'}
          </div>
        )}

        {results.map((item) => {
          const dl = downloads[item.url] ?? { status: 'idle' }
          const vdl = videoDownloads[item.url] ?? { status: 'idle' }
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

                {/* 다운로드 버튼 */}
                <div className="yt-dl-row">
                  {dl.status === 'idle' && (
                    <button className="yt-dl-btn" disabled={!ytdlpReady} onClick={() => do_download(item.url, 'mp3')} title="Download Audio"><AudioLines size={14} strokeWidth={1.5} /></button>
                  )}
                  {vdl.status === 'idle' && (
                    <button className="yt-dl-btn" disabled={!ytdlpReady} onClick={() => do_download_video(item.url)} title="Download Video"><FileVideo2 size={14} strokeWidth={1.5} /></button>
                  )}
                </div>

                {dl.status === 'downloading' && (
                  <ProgressBar label="Audio" percent={dl.percent} speed={dl.speed} eta={dl.eta}
                    onCancel={() => do_cancel(item.url)} />
                )}
                {dl.status === 'done' && (
                  <DoneRow label="Audio" filePath={dl.filePath} onOpen={() => open_folder(dl.filePath)} />
                )}
                {dl.status === 'error' && (
                  <ErrorRow message={dl.message} onRetry={() => do_download(item.url, 'mp3')} />
                )}

                {vdl.status === 'downloading' && (
                  <ProgressBar label="Video" percent={vdl.percent} speed={vdl.speed} eta={vdl.eta}
                    onCancel={() => do_cancel_video(item.url)} />
                )}
                {vdl.status === 'done' && (
                  <DoneRow label="Video" filePath={vdl.filePath} onOpen={() => open_folder(vdl.filePath)} />
                )}
                {vdl.status === 'error' && (
                  <ErrorRow message={vdl.message} onRetry={() => do_download_video(item.url)} />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
