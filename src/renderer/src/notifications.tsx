import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { get_bridge } from './bridge'

export type ToastType = 'info' | 'error'

export interface ToastAction {
  label: string
  run: () => void
}

interface Toast {
  id: number
  message: string
  type: ToastType
  action?: ToastAction
}

type NotifyFn = (message: string, type?: ToastType, action?: ToastAction) => void

const NotifyContext = createContext<NotifyFn>(() => {})

export function useNotify(): NotifyFn {
  return useContext(NotifyContext)
}

const TOAST_TTL_MS = 10000

// 우측 하단 토스트 알림. 새 메시지는 아래에 추가되고 스택은 위로 자란다. 10초 후 자동 소멸.
export function NotificationProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, set_toasts] = useState<Toast[]>([])
  const seq = useRef(0)

  const dismiss_toast = useCallback((id: number): void => {
    set_toasts((prev) => prev.filter((toast) => toast.id !== id))
  }, [])

  function copy_message(text: string): void {
    const bridge = get_bridge()
    if (bridge?.write_clipboard) {
      bridge.write_clipboard(text)
    } else if (navigator.clipboard) {
      void navigator.clipboard.writeText(text)
    }
  }

  const notify = useCallback(
    (message: string, type: ToastType = 'info', action?: ToastAction): void => {
      seq.current += 1
      const id = seq.current
      set_toasts((prev) => [...prev, { id, message, type, action }])
      // 액션(버튼)이 있는 알림은 사용자가 처리할 때까지 유지, 그 외엔 10초 후 자동 소멸.
      if (!action) {
        setTimeout(() => dismiss_toast(id), TOAST_TTL_MS)
      }
    },
    [dismiss_toast]
  )

  // 메인 프로세스가 IPC 로 보내는 알림을 큐에 넣는다 (독립 동작).
  useEffect(() => {
    const unsubscribe = get_bridge()?.on_notify?.((payload) =>
      notify(payload.message, payload.type ?? 'info')
    )
    return () => {
      if (unsubscribe) {
        unsubscribe()
      }
    }
  }, [notify])

  return (
    <NotifyContext.Provider value={notify}>
      {children}
      <div className="toast-host">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            <div className="toast-header">
              <span className="toast-title">
                {toast.type === 'error' ? 'Error' : 'Music Finder'}
              </span>
              <div className="toast-actions">
                <button
                  className="toast-icon-btn"
                  title="Copy message"
                  onClick={() => copy_message(toast.message)}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                </button>
                <button
                  className="toast-close"
                  title="Dismiss"
                  onClick={() => dismiss_toast(toast.id)}
                >
                  ×
                </button>
              </div>
            </div>
            <div className="toast-body">
              <span className="toast-message">{toast.message}</span>
              {toast.action && (
                <button
                  className="toast-action"
                  onClick={() => {
                    toast.action?.run()
                    dismiss_toast(toast.id)
                  }}
                >
                  {toast.action.label}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </NotifyContext.Provider>
  )
}
