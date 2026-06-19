import { useEffect, useState } from 'react'
import { FolderOpen, X } from 'lucide-react'
import { get_bridge } from '../bridge'
import { useTabCtx } from '../App'

const FORMATS = ['mp3', 'flac', 'mp4'] as const
type Fmt = typeof FORMATS[number]

type ItemState =
  | { status: 'idle' }
  | { status: 'converting'; percent: number }
  | { status: 'done' }
  | { status: 'error'; message: string }

interface ConvertItem {
  srcPath: string
  fileName: string
  targetFmt: Fmt
  state: ItemState
}

function ConvertRow({ item, disabled, onRemove, onFmt }: {
  item: ConvertItem
  disabled: boolean
  onRemove: () => void
  onFmt: (f: Fmt) => void
}): JSX.Element {
  const { state } = item
  return (
    <div className={`cv-row${disabled ? ' cv-row-disabled' : ''}`}>
      <span className="cv-name" title={item.srcPath}>{item.fileName}</span>

      {state.status === 'converting' && (
        <div className="cv-progress">
          <div className="yt-progress-bar">
            <div className="yt-progress-fill" style={{ width: `${state.percent}%` }} />
          </div>
          <span className="cv-pct">{state.percent}%</span>
        </div>
      )}

      {state.status === 'done' && (
        <span className="cv-done">완료</span>
      )}

      {state.status === 'error' && (
        <span className="cv-error" title={state.message}>오류</span>
      )}

      {state.status === 'idle' && (
        <div className="cv-fmt-group">
          {FORMATS.map(f => (
            <button
              key={f}
              className={`cv-fmt-btn${item.targetFmt === f ? ' active' : ''}`}
              onClick={() => onFmt(f)}
              disabled={disabled}
            >.{f}</button>
          ))}
        </div>
      )}

      {!disabled && state.status !== 'done' && (
        <button className="cv-remove-btn" title="목록에서 제거" onClick={onRemove}>
          <X size={12} strokeWidth={1.5} />
        </button>
      )}
    </div>
  )
}

export function ConvertPanel(): JSX.Element {
  const { setTitle } = useTabCtx()
  const [folder, set_folder] = useState('')
  const [targetFmt, set_target_fmt] = useState<Fmt | null>(null)
  const [items, set_items] = useState<ConvertItem[]>([])
  const [busy, set_busy] = useState(false)
  const bridge = get_bridge()

  useEffect(() => { setTitle('변환') }, [])

  useEffect(() => {
    const off1 = bridge?.on_convert_progress?.((d) => {
      set_items(prev => prev.map(i =>
        i.srcPath === d.srcPath ? { ...i, state: { status: 'converting', percent: d.percent } } : i
      ))
    })
    const off2 = bridge?.on_convert_done?.((d) => {
      set_items(prev => {
        const next: ConvertItem[] = prev.map(i =>
          i.srcPath === d.srcPath ? { ...i, state: { status: 'done' } as ItemState } : i
        )
        if (next.every(i => i.state.status === 'done' || i.state.status === 'error')) set_busy(false)
        return next
      })
    })
    const off3 = bridge?.on_convert_error?.((d) => {
      set_items(prev => {
        const next: ConvertItem[] = prev.map(i =>
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

  useEffect(() => {
    if (!folder || !targetFmt) { set_items([]); return }
    bridge?.convert_scan_folder?.(folder, targetFmt).then((files) => {
      set_items(files.map(f => ({
        srcPath: f,
        fileName: f.split(/[\\/]/).pop() ?? f,
        targetFmt: targetFmt!,
        state: { status: 'idle' },
      })))
    }).catch(() => {})
  }, [folder, targetFmt])

  function remove_item(srcPath: string): void {
    set_items(prev => prev.filter(i => i.srcPath !== srcPath))
  }

  function set_item_fmt(srcPath: string, fmt: Fmt): void {
    set_items(prev => prev.map(i => i.srcPath === srcPath ? { ...i, targetFmt: fmt } : i))
  }

  function bulk_convert(): void {
    set_busy(true)
    for (const item of items) {
      set_items(prev => prev.map(i =>
        i.srcPath === item.srcPath ? { ...i, state: { status: 'converting', percent: 0 } } : i
      ))
      bridge?.convert_start?.(item.srcPath, item.targetFmt)
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
        <div className="cv-fmt-tabs">
          {FORMATS.map(f => (
            <button
              key={f}
              className={`cv-fmt-btn${targetFmt === f ? ' active' : ''}`}
              onClick={() => { if (!busy) set_target_fmt(f) }}
              disabled={busy}
            >.{f}</button>
          ))}
        </div>
        {hasItems && (
          <button className="cv-bulk-btn" onClick={bulk_convert} disabled={busy}>
            일괄 변환
          </button>
        )}
      </div>

      <div className="cv-list">
        {!folder && <div className="empty-hint">폴더를 선택하세요.</div>}
        {folder && !targetFmt && <div className="empty-hint">변환할 형식을 선택하세요.</div>}
        {folder && targetFmt && !hasItems && (
          <div className="empty-hint">변환할 파일이 없습니다.</div>
        )}
        {items.map(item => (
          <ConvertRow
            key={item.srcPath}
            item={item}
            disabled={busy}
            onRemove={() => remove_item(item.srcPath)}
            onFmt={(f) => set_item_fmt(item.srcPath, f)}
          />
        ))}
      </div>
    </div>
  )
}
