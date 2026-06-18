import { Check } from 'lucide-react'
import type { Identity, Notice } from '../bridge'

interface NoticeCardProps {
  notice: Notice
  myIdentity: Identity | null
  totalMembers: number
  on_confirm: (noticeId: string) => void
}

function format_relative_time(timestampMs: number): string {
  const diffMs = Date.now() - timestampMs
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return '방금'
  if (minutes < 60) return `${minutes}분 전`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}시간 전`
  return `${Math.floor(hours / 24)}일 전`
}

export function NoticeCard({ notice, myIdentity, totalMembers, on_confirm }: NoticeCardProps): JSX.Element {
  const already_confirmed = Boolean(myIdentity) && notice.acks.some((a) => a.deviceId === myIdentity!.deviceId)

  return (
    <div className="card">
      <div className="head">
        <span className="name">{notice.authorHostname}</span>
        <span className="time">{format_relative_time(notice.createdAt)}</span>
      </div>
      <div className="text">{notice.text}</div>
      <div className="foot">
        <span className="ack-count"><b>{notice.acks.length}</b>/{totalMembers} 확인됨</span>
        <button
          className={`confirm-btn ${already_confirmed ? 'done' : ''}`}
          disabled={already_confirmed}
          onClick={() => on_confirm(notice.id)}
        >
          {already_confirmed ? (<><Check size={12} strokeWidth={1.5} /> 확인됨</>) : '확인'}
        </button>
      </div>
    </div>
  )
}
