import { useEffect, useRef, useState } from 'react'
import { Folder, File, ChevronLeft, RefreshCw, FolderOpen, X, HardDrive, FolderSearch, AlertTriangle, Loader2, Trash2, Copy, Recycle, ChevronUp, ChevronDown, Sparkles } from 'lucide-react'
import { get_bridge, type FolderChild, type ScanProgress } from './bridge'

function format_size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(1)} MB`
  const gb = mb / 1024
  if (gb < 1024) return `${gb.toFixed(2)} GB`
  return `${(gb / 1024).toFixed(2)} TB`
}

function is_drive_root(path: string): boolean {
  return /^[A-Za-z]:\\?$/.test(path)
}

function parent_path(path: string): string | null {
  if (is_drive_root(path)) return null
  const trimmed = path.replace(/\\+$/, '')
  const idx = trimmed.lastIndexOf('\\')
  if (idx <= 2) return trimmed.slice(0, 3) // "C:\"
  return trimmed.slice(0, idx)
}

function is_recycle_bin(c: FolderChild): boolean {
  return c.isDir && c.name.toUpperCase() === '$RECYCLE.BIN'
}

type SortKey = 'name' | 'size' | 'count'
type SortDir = 'asc' | 'desc'

function path_segments(path: string): { label: string; path: string }[] {
  const trimmed = path.replace(/\\+$/, '')
  const parts = trimmed.split('\\')
  const segments: { label: string; path: string }[] = []
  let acc = ''
  parts.forEach((part, i) => {
    if (i === 0) {
      acc = `${part}\\`
      segments.push({ label: acc, path: acc })
    } else {
      acc = acc.endsWith('\\') ? acc + part : `${acc}\\${part}`
      segments.push({ label: part, path: acc })
    }
  })
  return segments
}

export function App(): JSX.Element {
  const [drives, set_drives] = useState<string[]>([])
  const [currentPath, set_currentPath] = useState<string | null>(null)
  const [children, set_children] = useState<FolderChild[]>([])
  const [loading, set_loading] = useState(false)
  const [error, set_error] = useState<string | null>(null)
  const [progress, set_progress] = useState<ScanProgress | null>(null)
  const [filter100m, set_filter100m] = useState(false)
  const [filter1g, set_filter1g] = useState(false)
  const [hideZero, set_hideZero] = useState(false)
  const [sortKey, set_sortKey] = useState<SortKey>('size')
  const [sortDir, set_sortDir] = useState<SortDir>('desc')
  const requestId = useRef(0)

  useEffect(() => {
    get_bridge().list_drives().then(set_drives).catch(() => set_drives([]))
  }, [])

  function run_scan(path: string, force = false): void {
    const id = ++requestId.current
    set_currentPath(path)
    set_loading(true)
    set_error(null)
    set_progress(null)

    const unsubscribe = get_bridge().on_scan_progress((p) => {
      if (id === requestId.current) set_progress(p)
    })

    get_bridge()
      .scan_folder(path, force)
      .then((result) => {
        if (id !== requestId.current) return
        set_children(result)
      })
      .catch((e: unknown) => {
        if (id !== requestId.current) return
        set_error(e instanceof Error ? e.message : String(e))
        set_children([])
      })
      .finally(() => {
        unsubscribe()
        if (id === requestId.current) {
          set_loading(false)
          set_progress(null)
        }
      })
  }

  function go_up(): void {
    if (!currentPath) return
    const parent = parent_path(currentPath)
    if (parent) run_scan(parent)
    else {
      requestId.current++
      set_currentPath(null)
      set_children([])
      set_error(null)
    }
  }

  function refresh(): void {
    if (currentPath) run_scan(currentPath, true)
  }

  // 마우스 뒤로가기(측면) 버튼 → 상위 폴더 이동
  useEffect(() => {
    function on_mouseup(e: MouseEvent): void {
      if (e.button === 3) {
        e.preventDefault()
        go_up()
      }
    }
    window.addEventListener('mouseup', on_mouseup)
    return () => window.removeEventListener('mouseup', on_mouseup)
  }, [currentPath])

  async function pick_folder(): Promise<void> {
    const path = await get_bridge().pick_folder()
    if (path) run_scan(path)
  }

  function cancel_scan(): void {
    get_bridge().scan_cancel()
  }

  async function copy_path(path: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(path)
    } catch (e: unknown) {
      set_error(e instanceof Error ? e.message : String(e))
    }
  }

  async function delete_item(c: FolderChild): Promise<void> {
    const confirmed = await get_bridge().confirm_delete(c.name)
    if (!confirmed) return
    try {
      await get_bridge().delete_path(c.path)
      set_children((prev) => prev.filter((x) => x.path !== c.path))
    } catch (e: unknown) {
      set_error(e instanceof Error ? e.message : String(e))
    }
  }

  function ask_ai(c: FolderChild): void {
    const query = `"${c.name}" 폴더는 무엇이고 삭제해도 되나요`
    get_bridge().open_url(`https://www.google.com/search?q=${encodeURIComponent(query)}`)
  }

  async function empty_recycle_bin(c: FolderChild): Promise<void> {
    const confirmed = await get_bridge().confirm_empty_recycle_bin()
    if (!confirmed) return
    try {
      await get_bridge().empty_recycle_bin(c.path)
      refresh()
    } catch (e: unknown) {
      set_error(e instanceof Error ? e.message : String(e))
    }
  }

  function toggle_sort(key: SortKey): void {
    if (sortKey === key) {
      set_sortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      set_sortKey(key)
      set_sortDir('asc')
    }
  }

  const minSizeBytes = filter1g ? 1024 ** 3 : filter100m ? 100 * 1024 ** 2 : 0
  const filteredChildren = children.filter(
    (c) => (!hideZero || c.sizeBytes > 0) && c.sizeBytes >= minSizeBytes
  )
  const maxSize = filteredChildren.reduce((m, c) => Math.max(m, c.sizeBytes), 0)
  const sign = sortDir === 'asc' ? 1 : -1
  const sortedChildren = [...filteredChildren].sort((a, b) => {
    if (sortKey === 'name') return sign * a.name.localeCompare(b.name)
    if (sortKey === 'count') return sign * (a.itemCount - b.itemCount)
    return sign * (a.sizeBytes - b.sizeBytes)
  })

  return (
    <div className="app">
      <div className="toolbar">
        <button className="tool-btn" onClick={go_up} disabled={!currentPath} title="상위 폴더">
          <ChevronLeft size={32} />
        </button>
        <button className="tool-btn" onClick={refresh} disabled={!currentPath || loading} title="새로고침">
          <RefreshCw size={32} />
        </button>
        <button className="tool-btn" onClick={() => currentPath && get_bridge().reveal_path(currentPath)} disabled={!currentPath} title="탐색기에서 열기">
          <FolderOpen size={32} />
        </button>
        <button className="tool-btn" onClick={() => void pick_folder()} title="폴더 선택">
          <FolderSearch size={32} />
        </button>
        {loading && (
          <button className="tool-btn cancel" onClick={cancel_scan} title="스캔 취소">
            <X size={32} />
          </button>
        )}
        <div className="breadcrumb">
          {currentPath
            ? path_segments(currentPath).map((seg, i) => (
                <span key={seg.path}>
                  {i > 0 && <span className="crumb-sep">›</span>}
                  <button className="crumb" onClick={() => run_scan(seg.path)}>{seg.label}</button>
                </span>
              ))
            : <span className="crumb-sep">드라이브 선택</span>}
        </div>
      </div>

      {currentPath && (
        <div className="filter-bar">
          <label className="filter-check">
            <input type="checkbox" checked={filter100m} onChange={(e) => set_filter100m(e.target.checked)} />
            100MB 이상
          </label>
          <label className="filter-check">
            <input type="checkbox" checked={filter1g} onChange={(e) => set_filter1g(e.target.checked)} />
            1GB 이상
          </label>
          <label className="filter-check">
            <input type="checkbox" checked={hideZero} onChange={(e) => set_hideZero(e.target.checked)} />
            0 크기 항목 숨기기
          </label>
        </div>
      )}

      {loading && (
        <div className="progress-bar">
          <Loader2 size={14} className="spin" />
          {progress ? `계산 중... (${progress.done}/${progress.total}) ${progress.name}` : '스캔 시작 중...'}
        </div>
      )}

      {error && (
        <div className="error-banner">
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      <div className="content">
        {!currentPath ? (
          <div className="drive-grid">
            {drives.map((d) => (
              <button key={d} className="drive-card" onClick={() => run_scan(d)}>
                <HardDrive size={28} />
                <span>{d}</span>
              </button>
            ))}
          </div>
        ) : (
          <table className="file-table">
            <thead>
              <tr>
                <th className="sortable" onClick={() => toggle_sort('name')}>
                  <span className="th-label">이름 {sortKey === 'name' && (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}</span>
                </th>
                <th className="col-size sortable" onClick={() => toggle_sort('size')}>
                  <span className="th-label">크기 {sortKey === 'size' && (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}</span>
                </th>
                <th className="col-count sortable" onClick={() => toggle_sort('count')}>
                  <span className="th-label">항목 수 {sortKey === 'count' && (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}</span>
                </th>
                <th className="col-bar"></th>
                <th className="col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {sortedChildren.map((c) => {
                const pct = maxSize > 0 ? (c.sizeBytes / maxSize) * 100 : 0
                const recycleBin = is_recycle_bin(c)
                return (
                  <tr
                    key={c.path}
                    className={c.isDir ? 'row-dir' : 'row-file'}
                    onClick={() => { if (recycleBin) void empty_recycle_bin(c); else if (c.isDir) run_scan(c.path) }}
                  >
                    <td className="col-name">
                      <div className="name-cell">
                        {recycleBin ? <Recycle size={15} /> : c.isDir ? <Folder size={15} /> : <File size={15} />}
                        <span>{recycleBin ? '휴지통' : c.name}</span>
                        {c.error && (
                          <span className="warn-icon" title={c.error}>
                            <AlertTriangle size={12} />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="col-size">{format_size(c.sizeBytes)}</td>
                    <td className="col-count">{c.isDir ? c.itemCount.toLocaleString() : '—'}</td>
                    <td className="col-bar">
                      <div className="bar-track">
                        <div className="bar-fill" style={{ width: `${pct}%` }} />
                      </div>
                    </td>
                    <td className="col-actions">
                      <div className="row-actions">
                        <button
                          className="row-action"
                          title="AI에게 물어보기"
                          onClick={(e) => { e.stopPropagation(); ask_ai(c) }}
                        >
                          <Sparkles size={15} />
                        </button>
                        <button
                          className="row-action"
                          title="전체 경로 복사"
                          onClick={(e) => { e.stopPropagation(); void copy_path(c.path) }}
                        >
                          <Copy size={15} />
                        </button>
                        <button
                          className="row-action"
                          title="탐색기에서 열기"
                          onClick={(e) => { e.stopPropagation(); get_bridge().reveal_path(c.path) }}
                        >
                          <FolderOpen size={15} />
                        </button>
                        <button
                          className="row-action danger"
                          title={recycleBin ? '휴지통 비우기' : '휴지통으로 삭제'}
                          onClick={(e) => { e.stopPropagation(); recycleBin ? void empty_recycle_bin(c) : void delete_item(c) }}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {!loading && sortedChildren.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-hint">
                    {children.length > 0 ? '조건에 맞는 항목이 없음' : '비어 있음'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
