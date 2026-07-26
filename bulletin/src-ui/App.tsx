import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
const hide = () => invoke('hide_window')
import { listen } from '@tauri-apps/api/event'
import { useNotices } from './hooks/useNotices'
import { useChat } from './hooks/useChat'
import { useSchedules } from './hooks/useSchedules'
import { useMenu } from './hooks/useMenu'
import { useLiarGame } from './games/liar/useLiarGame'
import { useUsers } from './hooks/useUsers'
import { Sidebar } from './components/Sidebar'
import { NoticePage } from './components/NoticePage'
import { ChatPage } from './components/ChatPage'
import { CalendarPage } from './components/CalendarPage'
import { MenuPage } from './components/MenuPage'
import { GamesPage } from './components/GamesPage'
import { AdminPage } from './components/AdminPage'
import { NoSettingsPage } from './components/NoSettingsPage'
import { DisabledPage } from './components/DisabledPage'
import { DbErrorPage } from './components/DbErrorPage'
import { NavRound } from './components/NavRound'
import { Dots } from './components/Dots'
import type { DbStatus } from './types'
import './dashboard.css'

const DB_POLL_INTERVAL_MS = 500
const DB_POLL_MAX_ATTEMPTS = 30 // 500ms * 30 = 15s

const PAGES = ['notices', 'messenger', 'calendar', 'menu', 'games'] as const
type Page = typeof PAGES[number] | 'admin'

export function App() {
  const [ready, set_ready] = useState(false)
  const [has_settings, set_has_settings] = useState(false)
  const [is_disabled, set_is_disabled] = useState(false)
  const [is_admin, set_is_admin] = useState(false)
  const [hostname, set_hostname] = useState('')
  const [db_ready, set_db_ready] = useState(false)
  const [db_error, set_db_error] = useState<string | null>(null)
  const [page, set_page_state] = useState<Page>('notices')
  function set_page(p: Page) {
    set_page_state(p)
    invoke('set_active_page', { page: p }).catch(() => {})
  }

  const notice_hook    = useNotices()
  const chat_hook      = useChat()
  const schedule_hook  = useSchedules()
  const menu_hook      = useMenu()
  const liar_hook      = useLiarGame()
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

  useEffect(() => {
    const unsub = listen<Page>('navigate', (e) => { set_page_state(e.payload) })
    return () => { unsub.then(f => f()) }
  }, [])

  // 화면을 그리기 전에 DB 연결이 실제로 준비됐는지 확정 확인 — 안 되면 계속 폴링하고,
  // 진짜 문제(에러) 또는 시간 초과면 전체 화면을 막고 상태를 표시한다.
  useEffect(() => {
    if (!has_settings || is_disabled) return
    let cancelled = false
    let attempts = 0

    async function poll() {
      if (cancelled) return
      try {
        const status = await invoke<DbStatus>('get_db_status')
        if (status.ready) { set_db_ready(true); return }
        if (status.error) { set_db_error(status.error); return }
      } catch { /* 커맨드 자체가 아직 안 뜬 경우 등 — 계속 재시도 */ }
      attempts++
      if (attempts >= DB_POLL_MAX_ATTEMPTS) {
        set_db_error('DB 연결이 원활하지 않습니다 (시간 초과)')
        return
      }
      setTimeout(poll, DB_POLL_INTERVAL_MS)
    }
    poll()
    return () => { cancelled = true }
  }, [has_settings, is_disabled])

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

  const waiting_screen = !has_settings ? <NoSettingsPage /> : is_disabled ? <DisabledPage /> : db_error ? <DbErrorPage /> : null
  if (waiting_screen) return (
    <div className="app-shell">
      <div className="titlebar">
        <span className="titlebar-name">Family Bulletin</span>
        <div className="window-controls"><button className="wc-btn" onClick={hide}>─</button></div>
      </div>
      {waiting_screen}
    </div>
  )

  // DB 연결이 확정되기 전까지는(에러도 아직 아님) 화면을 그리지 않는다 — "?" 같은 반쪽 데이터 노출 방지
  if (!db_ready) return null

  return (
    <div className="app-shell">
      <div className="titlebar">
        <span className="titlebar-name">Family Bulletin</span>
        <div className="window-controls"><button className="wc-btn" onClick={hide}>─</button></div>
      </div>
      <div className="body-row">
        <Sidebar
          active={page === 'messenger' ? 'messenger' : page === 'admin' ? 'admin' : page === 'calendar' ? 'calendar' : page === 'menu' ? 'menu' : page === 'games' ? 'games' : 'notices'}
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
            {page === 'menu' && (
              <MenuPage session={session} get_profile={get_profile} hook={menu_hook} />
            )}
            {page === 'games' && (
              <GamesPage session={session} get_profile={get_profile} liar_hook={liar_hook} />
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
