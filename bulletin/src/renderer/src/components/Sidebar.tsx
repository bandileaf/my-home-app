import { Calendar, MessageCircle, StickyNote } from 'lucide-react'
import type { Identity } from '../bridge'

export type Section = 'notices' | 'messenger' | 'calendar'

interface SidebarProps {
  active: Section
  identity: Identity | null
  appName: string
}

const ICON_PROPS = { size: 16, strokeWidth: 1.5 }

export function Sidebar({ active, identity, appName }: SidebarProps): JSX.Element {
  return (
    <div className="sidebar">
      <div className="brand">🏠 {appName || '...'}</div>
      <hr />
      <div className={`nav-item ${active === 'notices' ? 'active' : ''}`}>
        <span className="ic"><StickyNote {...ICON_PROPS} /></span>
        알림장
      </div>
      <div className="nav-item disabled">
        <span className="ic"><MessageCircle {...ICON_PROPS} /></span>
        메신저
        <span className="badge">곧 추가</span>
      </div>
      <div className="nav-item disabled">
        <span className="ic"><Calendar {...ICON_PROPS} /></span>
        캘린더
        <span className="badge">곧 추가</span>
      </div>
      <div className="spacer" />
      <div className="me">
        <span className="avatar">{initials_of(identity?.hostname)}</span>
        <span>{identity ? `${identity.hostname} (나)` : '...'}</span>
      </div>
    </div>
  )
}

function initials_of(hostname: string | undefined): string {
  if (!hostname) return '?'
  return hostname.slice(0, 2).toUpperCase()
}
