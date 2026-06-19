import { useEffect, useState } from 'react'
import { useIdentity } from './hooks/useIdentity'
import { useNotices } from './hooks/useNotices'
import { Sidebar } from './components/Sidebar'
import { NoticePage } from './components/NoticePage'
import { NavRound } from './components/NavRound'
import { Dots } from './components/Dots'
import { get_bridge } from './bridge'

export function App(): JSX.Element {
  const identity = useIdentity()
  const { notices, post_notice, confirm_notice } = useNotices()
  const [appName, set_appName] = useState('')

  useEffect(() => {
    get_bridge()?.app_name?.().then(set_appName).catch(() => {})
  }, [])

  return (
    <div className="app-shell">
      <Sidebar active="notices" identity={identity} appName={appName} />

      <div className="stage">
        <div className="page-row">
          <NavRound direction="left" />
          <NoticePage
            identity={identity}
            notices={notices}
            on_post={post_notice}
            on_confirm={confirm_notice}
          />
          <NavRound direction="right" />
        </div>

        <Dots total={3} activeIndex={0} />
      </div>
    </div>
  )
}
