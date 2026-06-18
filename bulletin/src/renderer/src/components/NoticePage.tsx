import type { Identity, Notice } from '../bridge'
import { Composer } from './Composer'
import { NoticeCard } from './NoticeCard'

interface NoticePageProps {
  identity: Identity | null
  notices: Notice[]
  on_post: (text: string) => void
  on_confirm: (noticeId: string) => void
}

// 실제 peer 등록 체계가 생기기 전까지, 지금까지 관찰된 작성자/확인자 deviceId 수를
// "전체 인원" 의 근사값으로 쓴다.
function compute_total_members(notices: Notice[], myDeviceId: string | undefined): number {
  const ids = new Set<string>()
  if (myDeviceId) ids.add(myDeviceId)
  for (const notice of notices) {
    ids.add(notice.authorDeviceId)
    for (const ack of notice.acks) ids.add(ack.deviceId)
  }
  return Math.max(ids.size, 1)
}

export function NoticePage({ identity, notices, on_post, on_confirm }: NoticePageProps): JSX.Element {
  const totalMembers = compute_total_members(notices, identity?.deviceId)

  return (
    <div className="page">
      <div className="page-head">
        <h2>알림장</h2>
        <div className="me-chip">
          <span className="avatar">{identity ? identity.hostname.slice(0, 2).toUpperCase() : '?'}</span>
          <span>{identity?.hostname ?? '...'}</span>
        </div>
      </div>

      <Composer on_submit={on_post} />

      {notices.map((notice) => (
        <NoticeCard
          key={notice.id}
          notice={notice}
          myIdentity={identity}
          totalMembers={totalMembers}
          on_confirm={on_confirm}
        />
      ))}
    </div>
  )
}
