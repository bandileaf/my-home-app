import { PauseCircle } from 'lucide-react'

export function DisabledPage(): JSX.Element {
  return (
    <div className="no-settings-page">
      <PauseCircle size={64} strokeWidth={1.2} className="no-settings-icon" />
      <p className="no-settings-title">기능 정지</p>
      <p className="no-settings-desc">관리자가 점검 중입니다. 잠시 후 다시 시도해 주세요.</p>
    </div>
  )
}
