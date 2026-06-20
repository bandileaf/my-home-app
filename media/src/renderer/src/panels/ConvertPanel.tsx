import { useEffect, useState } from 'react'
import { AlertTriangle, ArrowRightLeft, FolderOpen, Wrench, X } from 'lucide-react'

import { get_bridge } from '../bridge'
import { useTabCtx } from '../App'

const FORMATS = ['mp3', 'mp4', 'flac'] as const
type Fmt = typeof FORMATS[number]

type ItemState =
  | { status: 'idle' }
  | { status: 'converting'; percent: number }
  | { status: 'done' }
  | { status: 'error'; message: string }

interface ConvertItem {
  srcPath: string
  fileName: string
  srcExt: string
  needsFix?: boolean
  fixMessage?: string
  state: ItemState
}

function ConvertRow({ item, disabled, onRemove, onConvert, onReveal }: {
  item: ConvertItem
  disabled: boolean
  onRemove: () => void
  onConvert: () => void
  onReveal: () => void
}): JSX.Element {
  const { state } = item
  return (
    <div className={`cv-row${disabled ? ' cv-row-disabled' : ''}`}>
      <span className="cv-name">{item.fileName}</span>
      <div className="cv-bottom">
        <span className="cv-path" title={item.srcPath}>{item.srcPath}</span>
        <div className="cv-actions">
          {state.status === 'converting' && (
            <div className="cv-progress">
              <div className="yt-progress-bar">
                <div className="yt-progress-fill" style={{ width: `${state.percent}%` }} />
              </div>
              <span className="cv-pct">{state.percent}%</span>
            </div>
          )}
          {state.status === 'done' && <span className="cv-done">완료</span>}
          {state.status === 'error' && <span className="cv-error" title={state.message}>오류</span>}
          {state.status === 'idle' && (
            <div className="cv-fmt-group">
              {item.needsFix && (
                <span className="cv-warn-icon" title={item.fixMessage}>
                  <AlertTriangle size={13} strokeWidth={1.5} />
                </span>
              )}
              <button
                className="cv-convert-btn"
                title={item.needsFix ? 'MP3 헤더 수정' : '변환'}
                onClick={onConvert}
                disabled={disabled}
              >
                {item.needsFix
                  ? <Wrench size={12} strokeWidth={1.5} />
                  : <ArrowRightLeft size={12} strokeWidth={1.5} />}
              </button>
              <button
                className="cv-convert-btn"
                title="폴더 열기"
                onClick={onReveal}
              >
                <FolderOpen size={12} strokeWidth={1.5} />
              </button>
            </div>
          )}
          {!disabled && state.status !== 'done' && (
            <button className="cv-remove-btn" title="목록에서 제거" onClick={onRemove}>
              <X size={12} strokeWidth={1.5} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function ConvertPanel(): JSX.Element {
  const { setTitle } = useTabCtx()
  const [folder, set_folder] = useState('')
  const [targetFmt, set_target_fmt] = useState<Fmt>('mp3')
  const [deleteOriginal, set_delete_original] = useState(false)
  const [items, set_items] = useState<ConvertItem[]>([])
  const [busy, set_busy] = useState(false)
  const bridge = get_bridge()

  useEffect(() => {
    const name = folder ? folder.split(/[\\/]/).pop() : null
    setTitle(name ? `변환 - ${name}` : '변환')
  }, [folder])

  useEffect(() => {
    const key = 'convert.state'
    if (bridge?.app_state_get) {
      bridge.app_state_get(key).then(raw => {
        if (!raw) return
        try {
          const s = JSON.parse(raw) as { folder?: string; targetFmt?: Fmt; deleteOriginal?: boolean }
          if (s.folder) set_folder(s.folder)
          if (s.targetFmt) set_target_fmt(s.targetFmt)
          if (s.deleteOriginal !== undefined) set_delete_original(s.deleteOriginal)
        } catch { /* ignore */ }
      }).catch(() => {})
    } else {
      try {
        const s = JSON.parse(localStorage.getItem(key) ?? '{}') as { folder?: string; targetFmt?: Fmt; deleteOriginal?: boolean }
        if (s.folder) set_folder(s.folder)
        if (s.targetFmt) set_target_fmt(s.targetFmt)
        if (s.deleteOriginal !== undefined) set_delete_original(s.deleteOriginal)
      } catch { /* ignore */ }
    }
  }, [])

  useEffect(() => {
    if (!folder) return
    const key = 'convert.state'
    const payload = JSON.stringify({ folder, targetFmt, deleteOriginal })
    if (bridge?.app_state_set) {
      bridge.app_state_set(key, payload)
    } else {
      localStorage.setItem(key, payload)
    }
  }, [folder, targetFmt, deleteOriginal])

  useEffect(() => {
    const off1 = bridge?.on_convert_progress?.((d) => {
      set_items(prev => prev.map(i =>
        i.srcPath === d.srcPath ? { ...i, state: { status: 'converting', percent: d.percent } } : i
      ))
    })
    const off2 = bridge?.on_convert_done?.((d) => {
      set_items(prev => {
        const next = prev.map(i =>
          i.srcPath === d.srcPath ? { ...i, state: { status: 'done' } as ItemState } : i
        )
        if (next.every(i => i.state.status === 'done' || i.state.status === 'error')) set_busy(false)
        return next
      })
    })
    const off3 = bridge?.on_convert_error?.((d) => {
      set_items(prev => {
        const next = prev.map(i =>
          i.srcPath === d.srcPath ? { ...i, state: { status: 'error', message: d.message } as ItemState } : i
        )
        if (next.every(i => i.state.status === 'done' || i.state.status === 'error')) set_busy(false)
        return next
      })
    })
    return () => { off1?.(); off2?.(); off3?.() }
  }, [])

  async function pick_folder(): Promise<void> {
    const path = await bridge?.convert_pick_folder?.()
    if (path) { set_folder(path); set_items([]) }
  }

  function scan(): void {
    if (!folder) { set_items([]); return }
    bridge?.convert_scan_folder?.(folder, targetFmt).then((results) => {
      set_items(prev => results.map(r => {
        const existing = prev.find(i => i.srcPath === r.path)
        if (existing && existing.needsFix === r.needsFix) return existing
        return {
          srcPath: r.path,
          fileName: r.path.split(/[\\/]/).pop() ?? r.path,
          srcExt: (r.path.split('.').pop() ?? '').toLowerCase(),
          needsFix: r.needsFix,
          fixMessage: r.fixMessage,
          state: { status: 'idle' },
        }
      }))
    }).catch(() => {})
  }

  useEffect(() => {
    scan()
    bridge?.convert_watch?.(folder)
    return () => { bridge?.convert_unwatch?.() }
  }, [folder, targetFmt])

  useEffect(() => {
    const off = bridge?.on_convert_folder_changed?.(() => { scan() })
    return () => { off?.() }
  }, [folder, targetFmt])

  function remove_item(srcPath: string): void {
    set_items(prev => prev.filter(i => i.srcPath !== srcPath))
  }

  function start_one(item: ConvertItem): void {
    set_items(prev => prev.map(i =>
      i.srcPath === item.srcPath ? { ...i, state: { status: 'converting', percent: 0 } } : i
    ))
    bridge?.convert_start?.(item.srcPath, targetFmt, deleteOriginal, item.needsFix)
  }

  function bulk_apply(): void {
    set_busy(true)
    for (const item of items) {
      if (item.state.status !== 'idle') continue
      set_items(prev => prev.map(i =>
        i.srcPath === item.srcPath ? { ...i, state: { status: 'converting', percent: 0 } } : i
      ))
      bridge?.convert_start?.(item.srcPath, targetFmt, deleteOriginal, item.needsFix)
    }
  }

  const hasItems = items.length > 0

  return (
    <div className="convert-panel">
      <div className="cv-toolbar">
        <button className="cv-folder-btn" onClick={pick_folder} title="폴더 선택" disabled={busy}>
          <FolderOpen size={14} strokeWidth={1.5} />
        </button>
        <span className="cv-folder-path" title={folder}>
          {folder || '폴더를 선택하세요'}
        </span>
        {folder && (
          <div className="cv-toolbar-right">
            <select
              className="cv-fmt-select"
              value={targetFmt}
              onChange={e => { if (!busy) set_target_fmt(e.target.value as Fmt) }}
              disabled={busy}
            >
              {FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            {hasItems && (
              <button className="cv-bulk-btn" onClick={bulk_apply} disabled={busy}>
                일괄 적용
              </button>
            )}
            <label className="cv-delete-label">
              <input
                type="checkbox"
                checked={deleteOriginal}
                onChange={e => set_delete_original(e.target.checked)}
                disabled={busy}
              />
              원본 삭제
            </label>
          </div>
        )}
      </div>

      <div className="cv-list">
        {!folder && <div className="empty-hint">폴더를 선택하세요.</div>}
        {folder && !hasItems && (
          <div className="empty-hint">변환할 파일이 없습니다.</div>
        )}
        {items.map(item => (
          <ConvertRow
            key={item.srcPath}
            item={item}
            disabled={busy}
            onRemove={() => remove_item(item.srcPath)}
            onConvert={() => start_one(item)}
            onReveal={() => bridge?.reveal_file?.(item.srcPath)}
          />
        ))}
      </div>
    </div>
  )
}
