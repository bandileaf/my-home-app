import { useEffect, useRef, useState } from 'react'

type OpenMenu = null | 'file' | 'edit'

interface MenuBarProps {
  on_close: () => void
  on_save: () => void
  on_open_settings: () => void
}

// 첫 글자에 니모닉 밑줄 (mnemonic 모드일 때)
function Label({ text, on }: { text: string; on: boolean }): JSX.Element {
  if (!on) {
    return <>{text}</>
  }
  return (
    <>
      <u>{text[0]}</u>
      {text.slice(1)}
    </>
  )
}

export function MenuBar({ on_close, on_save, on_open_settings }: MenuBarProps): JSX.Element {
  const [open, set_open] = useState<OpenMenu>(null)
  const [mnemonic, set_mnemonic] = useState(false)

  // 최신 콜백을 ref 로 유지 (키보드 핸들러가 항상 최신을 호출)
  const saveRef = useRef(on_save)
  const closeRef = useRef(on_close)
  const settingsRef = useRef(on_open_settings)
  saveRef.current = on_save
  closeRef.current = on_close
  settingsRef.current = on_open_settings

  function choose(action: () => void): void {
    set_open(null)
    set_mnemonic(false)
    action()
  }

  // Alt → 메뉴 모드, F/E → 메뉴 열기, S/C → 항목 실행 (Alt→F→S = Save)
  useEffect(() => {
    function handle(event: KeyboardEvent): void {
      if (event.key === 'Alt') {
        event.preventDefault()
        set_open(null)
        set_mnemonic((m) => !m)
        return
      }
      const k = event.key.toLowerCase()
      if (open === 'file') {
        if (k === 's') {
          event.preventDefault()
          choose(() => saveRef.current())
        } else if (k === 'c') {
          event.preventDefault()
          choose(() => closeRef.current())
        } else if (event.key === 'Escape') {
          set_open(null)
          set_mnemonic(false)
        }
        return
      }
      if (open === 'edit') {
        if (k === 's') {
          event.preventDefault()
          choose(() => settingsRef.current())
        } else if (event.key === 'Escape') {
          set_open(null)
          set_mnemonic(false)
        }
        return
      }
      if (mnemonic) {
        if (k === 'f') {
          event.preventDefault()
          set_open('file')
        } else if (k === 'e') {
          event.preventDefault()
          set_open('edit')
        } else if (event.key === 'Escape') {
          set_mnemonic(false)
        }
      }
    }
    function clear_on_click(): void {
      if (mnemonic && open === null) {
        set_mnemonic(false)
      }
    }
    window.addEventListener('keydown', handle)
    window.addEventListener('mousedown', clear_on_click)
    return () => {
      window.removeEventListener('keydown', handle)
      window.removeEventListener('mousedown', clear_on_click)
    }
  }, [open, mnemonic])

  return (
    <div className="menu-bar">
      {open && <div className="menu-backdrop" onClick={() => choose(() => {})} />}

      <div className="menu-root">
        <button
          className={`menu-title${open === 'file' ? ' active' : ''}`}
          onClick={() => set_open(open === 'file' ? null : 'file')}
        >
          <Label text="File" on={mnemonic} />
        </button>
        {open === 'file' && (
          <div className="menu-dropdown">
            <button className="menu-entry" onClick={() => choose(() => saveRef.current())}>
              <Label text="Save" on={true} />
            </button>
            <button className="menu-entry" onClick={() => choose(() => closeRef.current())}>
              <Label text="Close" on={true} />
            </button>
          </div>
        )}
      </div>

      <div className="menu-root">
        <button
          className={`menu-title${open === 'edit' ? ' active' : ''}`}
          onClick={() => set_open(open === 'edit' ? null : 'edit')}
        >
          <Label text="Edit" on={mnemonic} />
        </button>
        {open === 'edit' && (
          <div className="menu-dropdown">
            <button className="menu-entry" onClick={() => choose(() => settingsRef.current())}>
              <Label text="Settings" on={true} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
