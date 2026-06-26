import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { RefreshCw, RotateCcw, Download, Upload, FolderInput, PauseCircle, PlayCircle, FileText, Loader2, Check, X, Copy } from 'lucide-react'
import type { DeviceStatus } from '../types'

type BtnState = 'idle' | 'loading' | 'ok' | 'error'

function BtnIcon({ state, idle }: { state: BtnState; idle: React.ReactNode }) {
  if (state === 'loading') return <Loader2 size={13} className="spin" />
  if (state === 'ok')      return <Check size={13} />
  if (state === 'error')   return <X size={13} />
  return <>{idle}</>
}

export function AdminPage() {
  const [clients, set_clients] = useState<DeviceStatus[]>([])
  const [scanning, set_scanning] = useState(false)
  const [btn, set_btn] = useState<Record<string, BtnState>>({})
  const [local_disabled, set_local_disabled] = useState<Record<string, boolean>>({})
  const [settings_text, set_settings_text] = useState('')
  const [settings_from, set_settings_from] = useState<string | null>(null)
  const [settings_ip, set_settings_ip] = useState<string | null>(null)
  const [copied, set_copied] = useState(false)
  const [log_text, set_log_text] = useState<string | null>(null)
  const [log_from, set_log_from] = useState<string | null>(null)

  function set_b(key: string, state: BtnState): void {
    set_btn(b => ({ ...b, [key]: state }))
  }

  async function wait_for_status(ip: string, timeout_ms = 15000): Promise<boolean> {
    const deadline = Date.now() + timeout_ms
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 600))
      try {
        await invoke('admin_fetch_log', { ip }) // just ping
        return true
      } catch { /* still offline */ }
    }
    return false
  }

  async function restart_and_wait(key: string, ip: string, cmd: string): Promise<void> {
    set_settings_ip(null)
    set_b(key, 'loading')
    try {
      await invoke(cmd, { ip })
      const back = await wait_for_status(ip)
      set_b(key, back ? 'ok' : 'error')
    } catch { set_b(key, 'error') }
  }

  async function scan(): Promise<void> {
    set_scanning(true)
    set_clients([])
    set_btn({})
    set_local_disabled({})
    set_settings_text('')
    set_settings_from(null)
    set_settings_ip(null)
    set_log_text(null)
    set_log_from(null)
    try {
      const found = await invoke<DeviceStatus[]>('scan_subnet')
      set_clients(found)
    } finally {
      set_scanning(false)
    }
  }

  async function toggle_disable(ip: string, currently_disabled: boolean): Promise<void> {
    set_settings_ip(null)
    const key = ip + '/toggle'
    set_b(key, 'loading')
    try {
      const cmd = currently_disabled ? 'admin_enable' : 'admin_disable'
      await invoke(cmd, { ip })
      const now_disabled = !currently_disabled
      set_local_disabled(d => ({ ...d, [ip]: now_disabled }))
      set_b(key, 'ok')
      if (now_disabled) void restart_and_wait(ip + '/restart', ip, 'admin_restart')
    } catch { set_b(key, 'error') }
  }

  async function fetch_log(ip: string, hostname: string): Promise<void> {
    set_settings_ip(null)
    const key = ip + '/log'
    set_b(key, 'loading')
    try {
      const text = await invoke<string>('admin_fetch_log', { ip })
      set_log_text(text)
      set_log_from(hostname)
      set_b(key, 'ok')
    } catch { set_b(key, 'error') }
  }

  async function get_settings(ip: string, hostname: string): Promise<void> {
    const key = ip + '/settings-get'
    set_b(key, 'loading')
    try {
      const text = await invoke<string>('admin_fetch_settings', { ip })
      try { set_settings_text(JSON.stringify(JSON.parse(text), null, 2)) } catch { set_settings_text(text) }
      set_settings_from(hostname)
      set_settings_ip(ip)
      set_b(key, 'ok')
    } catch { set_b(key, 'error') }
  }

  async function save_settings(ip: string): Promise<void> {
    const key = ip + '/settings-get'
    try {
      const parsed = JSON.parse(settings_text)
      set_b(key, 'loading')
      await invoke('admin_send_settings', { ip, body: parsed })
      set_b(key, 'ok')
      set_settings_ip(null)
    } catch { set_b(key, 'error') }
  }

  function handle_tab(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== 'Tab') return
    e.preventDefault()
    const el = e.currentTarget
    const start = el.selectionStart
    const end = el.selectionEnd
    set_settings_text(settings_text.substring(0, start) + '    ' + settings_text.substring(end))
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 4 })
  }

  return (
    <div className="page admin-page">
      <div className="page-head">
        <h2>관리페이지</h2>
        <button className="admin-scan-btn" onClick={scan} disabled={scanning}>
          <RefreshCw size={16} className={scanning ? 'spin' : ''} />
          {scanning ? '스캔 중...' : '네트워크 스캔'}
        </button>
      </div>

      {clients.length === 0 && !scanning && (
        <div className="admin-empty">스캔 버튼을 눌러 클라이언트를 찾으세요</div>
      )}

      {clients.length > 0 && (
        <>
          <div className="admin-toolbar">
            <span className="admin-found">{clients.length}개 발견</span>
            <button className="admin-btn" disabled={btn['all/restart'] === 'loading'}
              onClick={() => void Promise.all(clients.map(c => restart_and_wait('all/restart', c.ip, 'admin_restart')))}>
              <BtnIcon state={btn['all/restart'] ?? 'idle'} idle={<RotateCcw size={14} />} /> 전체 재시작
            </button>
            <button className="admin-btn" disabled={btn['all/update'] === 'loading'}
              onClick={() => void Promise.all(clients.map(c => restart_and_wait('all/update', c.ip, 'admin_update')))}>
              <BtnIcon state={btn['all/update'] ?? 'idle'} idle={<Download size={14} />} /> 전체 업데이트
            </button>
          </div>
          <div className="admin-list">
            {clients.map(c => {
              const is_disabled = local_disabled[c.ip] ?? c.disabled
              const toggle_state = btn[c.ip + '/toggle'] ?? 'idle'
              const is_settings_loaded = settings_ip === c.ip
              const settings_key = c.ip + '/settings-get'
              const settings_state = btn[settings_key] ?? 'idle'

              return (
                <div key={c.ip} className="admin-client">
                  <div className="admin-client-info">
                    <span className="admin-hostname">{c.hostname}</span>
                    <span className="admin-meta">{c.ip} · v{c.version}</span>
                    {!c.hasSettings && <span className="admin-state admin-state-warn">초기설정필요</span>}
                    {c.hasSettings && is_disabled  && <span className="admin-state admin-state-stop">강제 정지</span>}
                    {c.hasSettings && !is_disabled && <span className="admin-state admin-state-ok">정상 동작</span>}
                  </div>
                  <div className="admin-client-actions">
                    <button className="admin-btn" disabled={btn[c.ip + '/restart'] === 'loading'}
                      onClick={() => void restart_and_wait(c.ip + '/restart', c.ip, 'admin_restart')}>
                      <BtnIcon state={btn[c.ip + '/restart'] ?? 'idle'} idle={<RotateCcw size={13} />} /> 재시작
                    </button>
                    <button className="admin-btn" disabled={btn[c.ip + '/update'] === 'loading'}
                      onClick={() => void restart_and_wait(c.ip + '/update', c.ip, 'admin_update')}>
                      <BtnIcon state={btn[c.ip + '/update'] ?? 'idle'} idle={<Download size={13} />} /> 업데이트
                    </button>
                    <button className={`admin-btn ${!is_disabled ? 'admin-btn-stop' : 'admin-btn-ok'}`}
                      disabled={toggle_state === 'loading'} onClick={() => void toggle_disable(c.ip, is_disabled)}>
                      <BtnIcon state={toggle_state} idle={!is_disabled ? <PauseCircle size={13} /> : <PlayCircle size={13} />} />
                      {toggle_state === 'error' ? '오류' : !is_disabled ? '정지' : '해제'}
                    </button>
                    <button className="admin-btn" disabled={btn[c.ip + '/log'] === 'loading'}
                      onClick={() => void fetch_log(c.ip, c.hostname)}>
                      <BtnIcon state={btn[c.ip + '/log'] ?? 'idle'} idle={<FileText size={13} />} /> 로그
                    </button>
                    {is_settings_loaded ? (
                      <button className="admin-btn admin-btn-export" disabled={settings_state === 'loading'}
                        onClick={() => void save_settings(c.ip)}>
                        <BtnIcon state={settings_state} idle={<Upload size={13} />} /> 설정저장
                      </button>
                    ) : (
                      <button className="admin-btn" disabled={settings_state === 'loading'}
                        onClick={() => void get_settings(c.ip, c.hostname)}>
                        <BtnIcon state={settings_state} idle={<FolderInput size={13} />} /> 설정얻기
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {settings_text.trim().length > 0 && (
        <div className="admin-settings-panel">
          <div className="admin-settings-label">
            {settings_from ? `${settings_from} 설정` : '설정'}
            <button className="admin-copy-btn" onClick={() => {
              void navigator.clipboard.writeText(settings_text)
              set_copied(true)
              setTimeout(() => set_copied(false), 1500)
            }}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
          <textarea className="admin-settings-editor" value={settings_text}
            onChange={e => set_settings_text(e.target.value)} onKeyDown={handle_tab} spellCheck={false} />
        </div>
      )}

      {log_text !== null && (
        <div className="admin-settings-panel">
          <div className="admin-settings-label">{log_from ? `${log_from} 로그` : '로그'}</div>
          <textarea className="admin-settings-editor admin-log-editor" value={log_text} readOnly spellCheck={false} />
        </div>
      )}
    </div>
  )
}
