import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useNotices } from './hooks/useNotices'
import { useChat } from './hooks/useChat'
import { useSchedules } from './hooks/useSchedules'
import { useUsers } from './hooks/useUsers'
import { Sidebar } from './components/Sidebar'
import { NoticePage } from './components/NoticePage'
import { ChatPage } from './components/ChatPage'
import { CalendarPage } from './components/CalendarPage'
import { AdminPage } from './components/AdminPage'
import { NoSettingsPage } from './components/NoSettingsPage'
import { DisabledPage } from './components/DisabledPage'
import { NavRound } from './components/NavRound'
import { Dots } from './components/Dots'
import './dashboard.css'

const PAGES = ['notices', 'messenger', 'calendar'] as const
type Page = typeof PAGES[number] | 'admin'

export function App() {
  const [ready, set_ready] = useState(false)
  const [has_settings, set_has_settings] = useState(false)
  const [is_disabled, set_is_disabled] = useState(false)
  const [is_admin, set_is_admin] = useState(false)
  const [hostname, set_hostname] = useState('')
  const [page, set_page] = useState<Page>('notices')

  const notice_hook    = useNotices()
  const chat_hook      = useChat()
  const schedule_hook  = useSchedules()
  const { session, users, set_alias, set_avatar, refresh_users } = useUsers()

  const check_state = useCallback(async () => {
    try {
      const has = await invoke<boolean>('has_settings')
      set_has_settings(has)
      if (has) {
        const settings = await invoke<Record<string, unknown> | null>('get_settings')
        set_is_disabled(!!(settings?.['hub.disabled']))
        set_is_admin(!!(settings?.['hub.app.bulletin.admin']))
        const hn = typeof settings?.['hub.device-id'] === 'string' ? settings['hub.device-id'] : ''
        set_hostname(hn)
      }
    } catch { /* ignore */ }
    set_ready(true)
  }, [])

  useEffect(() => {
    check_state()
    refresh_users()
    const unsub = listen('settings_changed', check_state)
    return () => { unsub.then(f => f()) }
  }, [check_state, refresh_users])

  const get_profile = useCallback((id: string) => {
    return users.find(u => u.id === id) ?? null
  }, [users])

  const online_users = users.filter(u => u.isOnline)
  const page_idx = page === 'admin' ? -1 : PAGES.indexOf(page as typeof PAGES[number])

  async function handle_profile_save(alias: string | null, avatar: string | null): Promise<void> {
    await set_alias(alias)
    await set_avatar(avatar)
    refresh_users()
  }

  if (!ready) return null

  const waiting_screen = !has_settings ? <NoSettingsPage /> : is_disabled ? <DisabledPage /> : null
  if (waiting_screen) return (
    <div className="app-shell">
      <div className="titlebar">
        <span className="titlebar-name">Family Bulletin</span>
      </div>
      {waiting_screen}
    </div>
  )

  return (
    <div className="app-shell">
      <div className="titlebar">
        <span className="titlebar-name">Family Bulletin</span>
      </div>
      <div className="body-row">
        <Sidebar
          active={page === 'messenger' ? 'messenger' : page === 'admin' ? 'admin' : page === 'calendar' ? 'calendar' : 'notices'}
          session={session}
          hostname={session?.alias ?? hostname ?? '?'}
          users={users}
          is_admin={is_admin}
          on_profile_save={handle_profile_save}
          on_section_change={(section) => set_page(section)}
        />
        <div className="stage">
          <div className="page-row">
            {page !== 'admin' && (
              <NavRound direction="left" on_click={() => set_page(PAGES[(page_idx - 1 + PAGES.length) % PAGES.length])} />
            )}

            {page === 'notices' && (
              <NoticePage session={session} get_profile={get_profile} hook={notice_hook} />
            )}
            {page === 'messenger' && (
              <ChatPage session={session} get_profile={get_profile} online_users={online_users} hook={chat_hook} />
            )}
            {page === 'calendar' && (
              <CalendarPage session={session} hook={schedule_hook} get_profile={get_profile} />
            )}
            {page === 'admin' && <AdminPage />}

            {page !== 'admin' && (
              <NavRound direction="right" on_click={() => set_page(PAGES[(page_idx + 1) % PAGES.length])} />
            )}
          </div>
          {page !== 'admin' && <Dots total={PAGES.length} activeIndex={page_idx} />}
        </div>
      </div>
    </div>
  )
}
