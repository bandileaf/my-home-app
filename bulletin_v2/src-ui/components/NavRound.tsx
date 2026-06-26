import { ChevronLeft, ChevronRight } from 'lucide-react'

interface NavRoundProps {
  direction: 'left' | 'right'
  disabled?: boolean
  on_click?: () => void
}

export function NavRound({ direction, disabled = false, on_click }: NavRoundProps){
  const Icon = direction === 'left' ? ChevronLeft : ChevronRight
  return (
    <button className="nav-round" disabled={disabled} onClick={on_click}>
      <Icon size={34} strokeWidth={1.5} />
    </button>
  )
}
