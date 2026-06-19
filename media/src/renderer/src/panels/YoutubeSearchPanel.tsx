import { useEffect, useRef, useState } from 'react'
import { AudioLines, CheckCircle2, Clock, Download, FileVideo2, PackageOpen, XCircle } from 'lucide-react'
import { get_bridge, type BinState, type YoutubeResult } from '../bridge'
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

interface BinRow { name: string; state: BinState; percent: number }

function bin_state_label(state: BinState): string {
  switch (state) {
    case 'pending': return 'Pending'
    case 'downloading': return 'Downloading'
    case 'extracting': return 'Extracting'
    case 'installed': return 'Installed'
    case 'failed': return 'Failed'
  }
}

function bin_bar_percent(row: BinRow): number {
  if (row.state === 'pending') return 0
  if (row.state === 'downloading') return row.percent
  return 100 // extracting / installed / failed
}

function BinStateIcon({ state }: { state: BinState }): JSX.Element {
  const props = { size: 13, strokeWidth: 1.5 }
  switch (state) {
    case 'pending': return <Clock {...props} />
    case 'downloading': return <Download {...props} />
    case 'extracting': return <PackageOpen {...props} />
    case 'installed': return <CheckCircle2 {...props} />
    case 'failed': return <XCircle {...props} />
  }
}

function BinsStatusBox({ rows }: { rows: BinRow[] }): JSX.Element {
  return (
    <div className="bins-status-box">
      {rows.map((row) => (
        <div className={`bins-status-row bins-status-row-${row.state}`} key={row.name}>
          <div className="bins-status-name">{row.name}</div>
          <div className="bins-status-progress-line">
            <div className="bins-status-bar">
              <div className="bins-status-bar-fill" style={{ width: `${bin_bar_percent(row)}%` }} />
            </div>
            <div className="bins-status-state">
              <BinStateIcon state={row.state} />
              <span>{bin_state_label(row.state)}{row.state === 'downloading' ? ` ${row.percent}%` : ''}</span>
            </div>
          </div>
        </div>
      ))}
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
  const [binRows, set_binRows] = useState<BinRow[]>([])
  const pendingSearch = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const binRemovalScheduled = useRef<Set<string>>(new Set())

  // 복원: 저장된 검색어 로드
  useEffect(() => {
    if (!tabId) return
    get_bridge()?.app_state_get?.(`tab:query:${tabId}`).then((saved) => {
      if (saved) { set_query(saved); pendingSearch.current = true }
    }).catch(() => {})
  }, [tabId])

  // 모든 bin 설치 완료되면 pending 검색 실행
  useEffect(() => {
    if (binRows.length > 0 && binRows.every(r => r.state === 'installed') && pendingSearch.current) {
      pendingSearch.current = false
      void do_search()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binRows])

  useEffect(() => {
    const bridge = get_bridge()
    // 먼저 구독해야 snapshot 조회와 그 사이에 일어난 업데이트를 놓치지 않는다.
    const u0a = bridge?.on_bins_status?.(({ name, state }) => {
      set_binRows((prev) => prev.map((r) =>
        r.name === name ? { ...r, state, percent: state === 'installed' ? 100 : r.percent } : r
      ))
    })
    const u0b = bridge?.on_bins_progress?.(({ name, percent }) => {
      set_binRows((prev) => prev.map((r) => (r.name === name ? { ...r, percent } : r)))
    })
    void bridge?.get_bins_status?.().then((entries) => set_binRows(entries))
    void bridge?.ensure_bins?.()
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
    return () => { u0a?.(); u0b?.(); u1?.(); u2?.(); u3?.(); u4?.(); u5?.(); u6?.() }
  }, [])

  // 설치 완료된 항목은 잠시 후 목록에서 제거 → 남은 항목이 위로 올라온다.
  useEffect(() => {
    for (const row of binRows) {
      if (row.state === 'installed' && !binRemovalScheduled.current.has(row.name)) {
        binRemovalScheduled.current.add(row.name)
        setTimeout(() => {
          set_binRows((prev) => prev.filter((r) => r.name !== row.name))
        }, 1200)
      }
    }
  }, [binRows])

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
  const binsReady = binRows.length > 0 && binRows.every(r => r.state === 'installed')
  const ready = bridgeAvailable && binsReady

  return (
    <div className="search-panel">
      {/* 검색 입력 */}
      <div className={`yt-search-row ${!ready ? 'yt-search-row-disabled' : ''}`}>
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
      {bridgeAvailable && !binsReady && (
        binRows.length > 0
          ? <BinsStatusBox rows={binRows} />
          : <div className="empty-hint">실행 환경이 구성되지 않았습니다.</div>
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
                    <button className="yt-dl-btn" disabled={!binsReady} onClick={() => do_download(item.url, 'mp3')} title="Download Audio"><AudioLines size={14} strokeWidth={1.5} /></button>
                  )}
                  {vdl.status === 'idle' && (
                    <button className="yt-dl-btn" disabled={!binsReady} onClick={() => do_download_video(item.url)} title="Download Video"><FileVideo2 size={14} strokeWidth={1.5} /></button>
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
