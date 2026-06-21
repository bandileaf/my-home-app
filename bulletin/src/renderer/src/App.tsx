import { useEffect, useState } from 'react'
import { useIdentity } from './hooks/useIdentity'
import { useNotices } from './hooks/useNotices'
import { useUsers } from './hooks/useUsers'
import { Sidebar } from './components/Sidebar'
import { NoticePage } from './components/NoticePage'
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

export function App(): JSX.Element {
  const identity = useIdentity()
  const { notices, error, post_notice, reply_notice, edit_notice, vote_notice } = useNotices()
  const { get_profile, refresh_users } = useUsers()
  const [appName, set_appName] = useState('')
  const [alias,  set_alias]  = useState<string | null>(null)
  const [avatar, set_avatar] = useState<string | null>(null)

  useEffect(() => {
    get_bridge()?.app_name?.().then(set_appName).catch(() => {})
    get_bridge()?.get_alias?.().then(set_alias).catch(() => {})
    get_bridge()?.get_avatar?.().then(set_avatar).catch(() => {})
  }, [])

  async function handle_profile_save(new_alias: string | null, new_avatar: string | null): Promise<void> {
    set_alias(new_alias)
    set_avatar(new_avatar)
    await get_bridge()?.save_profile?.(new_alias, new_avatar)
    refresh_users()
  }

  const close_window = (): void => get_bridge()?.window_close?.()

  return (
    <div className="app-shell">
      <div className="titlebar">
        <span className="titlebar-name">{appName || 'Family Bulletin'}</span>
        <div className="window-controls">
          <button className="wc-btn" onClick={close_window}>─</button>
        </div>
      </div>

      <div className="body-row">
        <Sidebar active="notices" identity={identity} appName={appName}
          alias={alias} avatar={avatar} on_profile_save={handle_profile_save} />

        <div className="stage">
          <div className="page-row">
            <NavRound direction="left" />
            <NoticePage
              identity={identity}
              notices={notices}
              on_post={post_notice}
              on_reply={reply_notice}
              on_edit={edit_notice}
              on_vote={vote_notice}
              get_profile={get_profile}
            />
            <NavRound direction="right" />
          </div>

          <Dots total={3} activeIndex={0} />

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
