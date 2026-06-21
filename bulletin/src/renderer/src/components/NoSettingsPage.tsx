import { ShieldAlert } from 'lucide-react'

export function NoSettingsPage(): JSX.Element {
  return (
    <div className="no-settings-page">
      <ShieldAlert size={64} strokeWidth={1.2} className="no-settings-icon" />
      <p className="no-settings-title">설정 파일이 없습니다</p>
      <p className="no-settings-desc">관리자에게 문의하여 설정을 받으세요</p>
    </div>
  )
}
