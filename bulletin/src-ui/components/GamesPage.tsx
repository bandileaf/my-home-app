import { useRef, useState } from 'react'
import { VenetianMask } from 'lucide-react'
import type { UserSession, UserProfile } from '../types'
import type { useLiarGame } from '../games/liar/useLiarGame'
import { LiarGamePage } from '../games/liar/LiarGamePage'

type LiarHook = ReturnType<typeof useLiarGame>

interface GamesPageProps {
  session: UserSession | null
  get_profile: (id: string) => UserProfile | null
  liar_hook: LiarHook
}

type GameKey = 'liar'

const LONG_PRESS_MS = 600

export function GamesPage({ session, get_profile, liar_hook }: GamesPageProps) {
  const [selected, set_selected] = useState<GameKey | null>(null)
  const [reset_menu_open, set_reset_menu_open] = useState(false)
  const press_timer = useRef<number | null>(null)
  const long_pressed = useRef(false)

  function start_press(): void {
    long_pressed.current = false
    press_timer.current = window.setTimeout(() => {
      long_pressed.current = true
      set_reset_menu_open(true)
    }, LONG_PRESS_MS)
  }

  function cancel_press(): void {
    if (press_timer.current !== null) {
      clearTimeout(press_timer.current)
      press_timer.current = null
    }
  }

  function handle_card_click(): void {
    if (long_pressed.current) { long_pressed.current = false; return }
    set_selected('liar')
  }

  async function handle_reset(): Promise<void> {
    await liar_hook.reset()
    set_reset_menu_open(false)
    set_selected('liar')
  }

  if (selected === 'liar') {
    return <LiarGamePage session={session} get_profile={get_profile} hook={liar_hook} on_back={() => set_selected(null)} />
  }

  return (
    <div className="page">
      <div className="page-head">
        <h2>게임</h2>
      </div>
      <div className="games-grid">
        <div
          className="games-card"
          onClick={handle_card_click}
          onMouseDown={start_press}
          onMouseUp={cancel_press}
          onMouseLeave={cancel_press}
          onTouchStart={start_press}
          onTouchEnd={cancel_press}
        >
          <VenetianMask size={32} strokeWidth={1.3} />
          <div className="games-card-title">라이어 게임</div>
          <div className="games-card-desc">제시어를 모르는 라이어를 찾아내는 파티 게임</div>
        </div>
      </div>

      {reset_menu_open && (
        <div className="profile-overlay" onClick={() => set_reset_menu_open(false)}>
          <div className="games-reset-menu" onClick={(e) => e.stopPropagation()}>
            <div className="games-reset-title">새 게임</div>
            <div className="games-reset-desc">라이어 게임 기록을 전부 초기화하고 새로 시작합니다. 진행 중인 라운드가 있다면 모두 사라집니다.</div>
            <div className="games-reset-actions">
              <button className="liar-ghost-btn" onClick={() => set_reset_menu_open(false)}>취소</button>
              <button className="liar-primary-btn" onClick={handle_reset}>초기화하고 시작</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
