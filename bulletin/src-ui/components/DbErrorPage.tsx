import { CloudOff } from 'lucide-react'

export function DbErrorPage(){
  return (
    <div className="no-settings-page">
      <CloudOff size={64} strokeWidth={1.2} className="no-settings-icon" />
      <p className="no-settings-title">DB 연결이 원활하지 않습니다</p>
      <p className="no-settings-desc">잠시 후 다시 시도해 주세요. 계속되면 관리자에게 문의하세요.</p>
    </div>
  )
}
