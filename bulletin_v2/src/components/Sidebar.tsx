import { useState } from 'react'
import { StickyNote, MessageCircle, Calendar, ShieldCheck } from 'lucide-react'
import type { UserSession, UserProfile } from '../types'
import { ProfilePanel } from './ProfilePanel'

export type Section = 'notices' | 'messenger' | 'calendar' | 'admin'

interface SidebarProps {
  active: Section
  session: UserSession | null
  hostname: string
  is_admin: boolean
  on_profile_save: (alias: string | null, avatar: string | null) => void
  on_section_change: (section: Section) => void
  users: UserProfile[]
}

const TAB_ICON_SIZE = 30

export function Sidebar({ active, session, hostname, is_admin, on_profile_save, on_section_change }: SidebarProps){
  const [open, set_open] = useState(false)

  const name = session?.alias?.trim() || hostname || '?'
  const initials = name.slice(0, 2).toUpperCase()

  return (
    <>
      <div className="tabs">
        <div className={`tab tab-notices ${active === 'notices' ? 'active' : ''}`}
          onClick={() => on_section_change('notices')} style={{ cursor: 'pointer' }}>
          <StickyNote size={TAB_ICON_SIZE} strokeWidth={1.5} />
        </div>
        <div className={`tab tab-messenger ${active === 'messenger' ? 'active' : ''}`}
          onClick={() => on_section_change('messenger')} style={{ cursor: 'pointer' }}>
          <MessageCircle size={TAB_ICON_SIZE} strokeWidth={1.5} />
        </div>
        <div className={`tab tab-calendar ${active === 'calendar' ? 'active' : ''}`}
          onClick={() => on_section_change('calendar')} style={{ cursor: 'pointer' }}>
          <Calendar size={TAB_ICON_SIZE} strokeWidth={1.5} />
        </div>
        <div className="tab-spacer" />
        {is_admin && (
          <div className={`tab tab-admin ${active === 'admin' ? 'active' : ''}`}
            onClick={() => on_section_change('admin')} style={{ cursor: 'pointer' }}>
            <ShieldCheck size={TAB_ICON_SIZE} strokeWidth={1.5} />
          </div>
        )}
        <div className="tab tab-me" onClick={() => set_open(true)} style={{ cursor: 'pointer' }}>
          {session?.avatar
            ? <img src={session.avatar} className="tab-avatar" style={{ objectFit: 'cover' }} alt="me" />
            : <span className="tab-avatar">{initials}</span>
          }
        </div>
      </div>

      {open && (
        <ProfilePanel
          alias={session?.alias ?? null}
          avatar={session?.avatar ?? null}
          hostname={hostname}
          on_close={() => set_open(false)}
          on_save={on_profile_save}
        />
      )}
    </>
  )
}
