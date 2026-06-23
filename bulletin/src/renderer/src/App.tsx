import { useEffect, useState } from 'react'
import { useIdentity } from './hooks/useIdentity'
import { useNotices } from './hooks/useNotices'
import { useUsers } from './hooks/useUsers'
import { Sidebar } from './components/Sidebar'
import { NoticePage } from './components/NoticePage'
import { ChatPage } from './components/ChatPage'
import { AdminPage } from './components/AdminPage'
import { NoSettingsPage } from './components/NoSettingsPage'
import { DisabledPage } from './components/DisabledPage'
import { NavRound } from './components/NavRound'
import { Dots } from './components/Dots'
import { get_bridge } from './bridge'


function to_witty_message(error: string): string {
  if (error.toLowerCase().includes('not initialized') || error.toLowerCase().includes('supabase'))
    return 'DB 연결에 실패했습니다 😅 — dday를 호출하세요!'
  if (error.toLowerCase().includes('network') || error.toLowerCase().includes('fetch'))
    return '인터넷이 삐졌나봐요 🌐 — 잠시 후 다시 시도해주세요!'
  if (error.toLowerCase().includes('timeout'))
    return '응답이 너무 느려요 ⏳ — 커피 한 잔 하고 오세요!'
  return '뭔가 잘못됐어요 😅 — 관리자를 호출하세요!'
}

const PAGES = ['notices', 'messenger'] as const
type Page = typeof PAGES[number] | 'admin'

export function App(): JSX.Element {
  const identity = useIdentity()
  const { notices, error, reload: reload_notices, post_notice, reply_notice, edit_notice, vote_notice } = useNotices()
  const { get_profile, refresh_users, online_users } = useUsers()
  const [has_settings, set_has_settings] = useState(true)
  const [is_disabled,  set_is_disabled]  = useState(false)
  const [appName,      set_appName]      = useState('')
  const [alias,        set_alias]        = useState<string | null>(null)
  const [avatar,       set_avatar]       = useState<string | null>(null)
  const [page,         set_page]         = useState<Page>('notices')
  const [is_admin,     set_is_admin]     = useState(false)

  const page_idx = page === 'admin' ? -1 : PAGES.indexOf(page as typeof PAGES[number])

  useEffect(() => {
    get_bridge()?.app_has_settings?.().then(set_has_settings).catch(() => {})
    get_bridge()?.app_disabled?.().then(set_is_disabled).catch(() => {})
    get_bridge()?.app_name?.().then(set_appName).catch(() => {})
    get_bridge()?.get_alias?.().then(set_alias).catch(() => {})
    get_bridge()?.get_avatar?.().then(set_avatar).catch(() => {})
    get_bridge()?.admin_is_enabled?.().then(set_is_admin).catch(() => {})
    get_bridge()?.onOpenChat?.(() => set_page('messenger'))
    get_bridge()?.onNoticeRefresh?.(() => reload_notices())
  }, [])

  async function handle_profile_save(new_alias: string | null, new_avatar: string | null): Promise<void> {
    set_alias(new_alias)
    set_avatar(new_avatar)
    await get_bridge()?.save_profile?.(new_alias, new_avatar)
    refresh_users()
  }

  const minimize_window = (): void => get_bridge()?.window_minimize?.()

  const waiting_screen = !has_settings ? <NoSettingsPage /> : is_disabled ? <DisabledPage /> : null
  if (waiting_screen) return (
    <div className="app-shell">
      <div className="titlebar">
        <span className="titlebar-name">{appName || 'Family Bulletin'}</span>
        <div className="window-controls">
          <button className="wc-btn" onClick={minimize_window}>─</button>
        </div>
      </div>
      {waiting_screen}
    </div>
  )

  return (
    <div className="app-shell">
      <div className="titlebar">
        <span className="titlebar-name">{appName || 'Family Bulletin'}</span>
        <div className="window-controls">
          <button className="wc-btn" onClick={minimize_window}>─</button>
        </div>
      </div>

      <div className="body-row">
        <Sidebar
          active={page === 'messenger' ? 'messenger' : page === 'admin' ? 'admin' : 'notices'}
          identity={identity}
          appName={appName}
          alias={alias}
          avatar={avatar}
          is_admin={is_admin}
          on_profile_save={handle_profile_save}
          on_section_change={(section) => {
            if (section === 'admin') set_page('admin')
            else if (section === 'messenger') set_page('messenger')
            else set_page('notices')
          }}
        />

        <div className="stage">
          <div className="page-row">
            {page !== 'admin' && (
              <NavRound
                direction="left"
                on_click={() => set_page(PAGES[(page_idx - 1 + PAGES.length) % PAGES.length])}
              />
            )}

            {page === 'notices' && (
              <NoticePage
                identity={identity}
                notices={notices}
                on_post={post_notice}
                on_reply={reply_notice}
                on_edit={edit_notice}
                on_vote={vote_notice}
                get_profile={get_profile}
              />
            )}

            {page === 'messenger' && (
              <ChatPage
                identity={identity}
                get_profile={get_profile}
                refresh_users={refresh_users}
                online_users={online_users}
              />
            )}

            {page === 'admin' && <AdminPage />}

            {page !== 'admin' && (
              <NavRound
                direction="right"
                on_click={() => set_page(PAGES[(page_idx + 1) % PAGES.length])}
              />
            )}
          </div>

          {page !== 'admin' && <Dots total={PAGES.length} activeIndex={page_idx} />}

          {error && (
            <div className="notif-bar">
              {to_witty_message(error)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
