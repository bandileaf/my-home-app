import { useState } from 'react'
import { RefreshCw, RotateCcw, Download, Upload, FolderInput, PauseCircle, PlayCircle, FileText } from 'lucide-react'
import type { ClientInfo, CommandResult } from '../bridge'
import { get_bridge } from '../bridge'

export function AdminPage(): JSX.Element {
  const [clients, set_clients] = useState<ClientInfo[]>([])
  const [scanning, set_scanning] = useState(false)
  const [status, set_status] = useState<Record<string, string>>({})
  const [settings_text, set_settings_text] = useState('')
  const [settings_from, set_settings_from] = useState<string | null>(null)
  const [settings_loaded, set_settings_loaded] = useState(false)
  const [log_text, set_log_text] = useState<string | null>(null)
  const [log_from, set_log_from] = useState<string | null>(null)

  async function scan(): Promise<void> {
    set_scanning(true)
    set_clients([])
    set_status({})
    set_settings_loaded(false)
    set_settings_text('')
    set_settings_from(null)
    set_log_text(null)
    set_log_from(null)
    const found = await get_bridge()?.admin_scan?.() ?? []
    set_clients(found)
    set_scanning(false)
  }

  async function cmd(ip: string, path: string, body?: unknown): Promise<void> {
    const key = ip + path
    set_status(s => ({ ...s, [key]: '...' }))
    const result: CommandResult = await get_bridge()?.admin_command?.(ip, path, body) ?? { ok: false, error: '연결 없음' }
    set_status(s => ({ ...s, [key]: result.ok ? '✓' : `✗ ${result.error ?? ''}` }))
  }

  async function fetch_log(ip: string, hostname: string): Promise<void> {
    const key = ip + '/log'
    set_status(s => ({ ...s, [key]: '...' }))
    const text = await get_bridge()?.admin_fetch_log?.(ip) ?? null
    if (text === null) {
      set_status(s => ({ ...s, [key]: '✗ 실패' }))
      return
    }
    set_log_text(text)
    set_log_from(hostname)
    set_status(s => ({ ...s, [key]: '✓' }))
  }

  async function import_settings(ip: string, hostname: string): Promise<void> {
    const key = ip + '/import'
    set_status(s => ({ ...s, [key]: '...' }))
    const text = await get_bridge()?.admin_fetch_settings?.(ip) ?? null
    if (text === null) {
      set_status(s => ({ ...s, [key]: '✗ 실패' }))
      return
    }
    try {
      const pretty = JSON.stringify(JSON.parse(text), null, 2)
      set_settings_text(pretty)
    } catch {
      set_settings_text(text)
    }
    set_settings_from(hostname)
    set_settings_loaded(true)
    set_status(s => ({ ...s, [key]: '✓' }))
  }

  function export_settings(ip: string): void {
    try {
      const parsed = JSON.parse(settings_text)
      void cmd(ip, '/settings', parsed)
    } catch {
      set_status(s => ({ ...s, [ip + '/settings']: '✗ JSON 오류' }))
    }
  }

  function cmd_all(path: string, body?: unknown): void {
    void Promise.all(clients.map(c => cmd(c.ip, path, body)))
  }

  const has_settings = settings_text.trim().length > 0

  function handle_tab(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key !== 'Tab') return
    e.preventDefault()
    const el = e.currentTarget
    const start = el.selectionStart
    const end = el.selectionEnd
    const next = settings_text.substring(0, start) + '    ' + settings_text.substring(end)
    set_settings_text(next)
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
            <button className="admin-btn" onClick={() => cmd_all('/restart', {})}>
              <RotateCcw size={14} /> 전체 재시작
            </button>
            <button className="admin-btn" onClick={() => cmd_all('/update', {})}>
              <Download size={14} /> 전체 업데이트
            </button>
          </div>

          <div className="admin-list">
            {clients.map(c => (
              <div key={c.ip} className="admin-client">
                <div className="admin-client-info">
                  <span className="admin-hostname">{c.hostname}</span>
                  <span className="admin-meta">{c.ip} · v{c.version}</span>
                  {!c.has_settings && <span className="admin-state admin-state-warn">초기설정필요</span>}
                  {c.has_settings && c.disabled && <span className="admin-state admin-state-stop">강제 정지</span>}
                  {c.has_settings && !c.disabled && <span className="admin-state admin-state-ok">정상 동작</span>}
                </div>
                <div className="admin-client-actions">
                  <button className="admin-btn" onClick={() => void cmd(c.ip, '/restart', {})}>
                    <RotateCcw size={13} /> 재시작
                  </button>
                  {status[c.ip + '/restart'] && <span className="admin-result">{status[c.ip + '/restart']}</span>}
                  <button className="admin-btn" onClick={() => void cmd(c.ip, '/update', {})}>
                    <Download size={13} /> 업데이트
                  </button>
                  {status[c.ip + '/update'] && <span className="admin-result">{status[c.ip + '/update']}</span>}
                  {!c.disabled
                    ? <button className="admin-btn admin-btn-stop" onClick={async () => {
                        const r = await get_bridge()?.admin_command?.(c.ip, '/disable', {}) ?? { ok: false }
                        set_status(s => ({ ...s, [c.ip + '/disable']: r.ok ? '✓' : `✗ ${'error' in r ? r.error : ''}` }))
                        if (r.ok) void cmd(c.ip, '/restart', {})
                      }}>
                        <PauseCircle size={13} /> 정지
                      </button>
                    : <button className="admin-btn admin-btn-ok" onClick={async () => {
                        const r = await get_bridge()?.admin_command?.(c.ip, '/enable', {}) ?? { ok: false }
                        set_status(s => ({ ...s, [c.ip + '/enable']: r.ok ? '✓' : `✗ ${'error' in r ? r.error : ''}` }))
                        if (r.ok) void cmd(c.ip, '/restart', {})
                      }}>
                        <PlayCircle size={13} /> 해제
                      </button>
                  }
                  {status[c.ip + '/disable'] && <span className="admin-result">{status[c.ip + '/disable']}</span>}
                  {status[c.ip + '/enable']  && <span className="admin-result">{status[c.ip + '/enable']}</span>}
                  <button className="admin-btn" onClick={() => void fetch_log(c.ip, c.hostname)}>
                    <FileText size={13} /> 로그
                  </button>
                  {status[c.ip + '/log'] && <span className="admin-result">{status[c.ip + '/log']}</span>}
                  <button className="admin-btn" onClick={() => void import_settings(c.ip, c.hostname)}>
                    <FolderInput size={13} /> 가져오기
                  </button>
                  {status[c.ip + '/import'] && <span className="admin-result">{status[c.ip + '/import']}</span>}
                  <button
                    className="admin-btn admin-btn-export"
                    onClick={() => export_settings(c.ip)}
                    disabled={!has_settings}
                    title={has_settings ? '' : '먼저 가져오기로 설정을 불러오세요'}
                  >
                    <Upload size={13} /> 내보내기
                  </button>
                  {status[c.ip + '/settings'] && <span className="admin-result">{status[c.ip + '/settings']}</span>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {settings_loaded && (
        <div className="admin-settings-panel">
          <div className="admin-settings-label">
            {settings_from ? `${settings_from} 에서 가져온 설정` : '로컬 설정'}
          </div>
          <textarea
            className="admin-settings-editor"
            value={settings_text}
            onChange={e => set_settings_text(e.target.value)}
            onKeyDown={handle_tab}
            spellCheck={false}
          />
        </div>
      )}

      {log_text !== null && (
        <div className="admin-settings-panel">
          <div className="admin-settings-label">
            {log_from ? `${log_from} 로그` : '로그'}
          </div>
          <textarea
            className="admin-settings-editor admin-log-editor"
            value={log_text}
            readOnly
            spellCheck={false}
          />
        </div>
      )}
    </div>
  )
}
