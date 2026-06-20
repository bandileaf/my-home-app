import { ChevronLeft, ChevronRight } from 'lucide-react'

interface NavRoundProps {
  direction: 'left' | 'right'
}

// 페이지(알림장/메신저/캘린더) 간 이동 버튼. 지금은 알림장 하나뿐이라 비활성 —
// 메신저/캘린더가 실제로 생기면 on_click 을 받아 페이지를 넘기도록 연결한다.
export function NavRound({ direction }: NavRoundProps): JSX.Element {
  const Icon = direction === 'left' ? ChevronLeft : ChevronRight
  return (
    <button className="nav-round" disabled title="곧 추가될 다른 섹션으로 이동">
      <Icon size={34} strokeWidth={1.5} />
    </button>
  )
}
