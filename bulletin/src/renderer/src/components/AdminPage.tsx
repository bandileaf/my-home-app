import { useState } from 'react'
import { RefreshCw, RotateCcw, Download, Upload, FolderInput } from 'lucide-react'
import type { ClientInfo, CommandResult } from '../bridge'
import { get_bridge } from '../bridge'

export function AdminPage(): JSX.Element {
  const [clients, set_clients] = useState<ClientInfo[]>([])
  const [scanning, set_scanning] = useState(false)
  const [status, set_status] = useState<Record<string, string>>({})
  const [settings_text, set_settings_text] = useState('')
  const [settings_from, set_settings_from] = useState<string | null>(null)

  async function scan(): Promise<void> {
    set_scanning(true)
    set_clients([])
    set_status({})
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
                </div>
                <div className="admin-client-actions">
                  <button className="admin-btn" onClick={() => void cmd(c.ip, '/restart', {})}>
                    <RotateCcw size={13} /> 재시작
                  </button>
                  <button className="admin-btn" onClick={() => void cmd(c.ip, '/update', {})}>
                    <Download size={13} /> 업데이트
                  </button>
                  <button className="admin-btn" onClick={() => void import_settings(c.ip, c.hostname)}>
                    <FolderInput size={13} /> 가져오기
                  </button>
                  <button
                    className="admin-btn admin-btn-export"
                    onClick={() => export_settings(c.ip)}
                    disabled={!has_settings}
                    title={has_settings ? '' : '먼저 가져오기로 설정을 불러오세요'}
                  >
                    <Upload size={13} /> 내보내기
                  </button>
                  {(status[c.ip + '/import'] || status[c.ip + '/restart'] || status[c.ip + '/update'] || status[c.ip + '/settings']) && (
                    <span className="admin-result">
                      {status[c.ip + '/import'] ?? status[c.ip + '/settings'] ?? status[c.ip + '/restart'] ?? status[c.ip + '/update']}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {has_settings && (
        <div className="admin-settings-panel">
          <div className="admin-settings-label">
            {settings_from ? `${settings_from} 에서 가져온 설정` : '로컬 설정'}
          </div>
          <textarea
            className="admin-settings-editor"
            value={settings_text}
            onChange={e => set_settings_text(e.target.value)}
            spellCheck={false}
          />
        </div>
      )}
    </div>
  )
}
