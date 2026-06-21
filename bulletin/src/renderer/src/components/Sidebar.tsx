import { useState } from 'react'
import { StickyNote, MessageCircle, Calendar } from 'lucide-react'
import type { Identity } from '../bridge'
import { ProfilePanel } from './ProfilePanel'

export type Section = 'notices' | 'messenger' | 'calendar'

interface SidebarProps {
  active: Section
  identity: Identity | null
  appName: string
  alias: string | null
  avatar: string | null
  on_profile_save: (alias: string | null, avatar: string | null) => void
  on_section_change: (section: Section) => void
}

const TAB_ICON_SIZE = 30

export function Sidebar({ active, identity, alias, avatar, on_profile_save, on_section_change }: SidebarProps): JSX.Element {
  const [open, set_open] = useState(false)

  const name = alias?.trim() || identity?.hostname || '?'
  const initials = name.slice(0, 2).toUpperCase()

  return (
    <>
      <div className="tabs">
        <div
          className={`tab tab-notices ${active === 'notices' ? 'active' : ''}`}
          onClick={() => on_section_change('notices')}
          style={{ cursor: 'pointer' }}
        >
          <StickyNote size={TAB_ICON_SIZE} strokeWidth={1.5} />
        </div>
        <div
          className={`tab tab-messenger ${active === 'messenger' ? 'active' : ''}`}
          onClick={() => on_section_change('messenger')}
          style={{ cursor: 'pointer' }}
        >
          <MessageCircle size={TAB_ICON_SIZE} strokeWidth={1.5} />
        </div>
        <div className="tab tab-calendar disabled">
          <Calendar size={TAB_ICON_SIZE} strokeWidth={1.5} />
        </div>
        <div className="tab-spacer" />
        <div className="tab tab-me" onClick={() => set_open(true)} style={{ cursor: 'pointer' }}>
          {avatar
            ? <img src={avatar} className="tab-avatar" style={{ objectFit: 'cover' }} alt="me" />
            : <span className="tab-avatar">{initials}</span>
          }
        </div>
      </div>

      {open && (
        <ProfilePanel
          alias={alias}
          avatar={avatar}
          hostname={identity?.hostname ?? '?'}
          on_close={() => set_open(false)}
          on_save={on_profile_save}
        />
      )}
    </>
  )
}
