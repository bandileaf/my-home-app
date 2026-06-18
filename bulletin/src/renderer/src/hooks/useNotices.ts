import { useCallback, useEffect, useState } from 'react'
import { get_bridge, type Notice } from '../bridge'

interface UseNoticesResult {
  notices: Notice[]
  post_notice: (text: string) => Promise<void>
  confirm_notice: (noticeId: string) => Promise<void>
}

// 알림장의 데이터/IPC 로직을 한곳에 모아둔다 — NoticePage/NoticeCard 같은 표현
// 컴포넌트는 이 훅이 반환하는 값과 콜백만 props 로 받고, bridge 를 직접 호출하지 않는다.
export function useNotices(): UseNoticesResult {
  const [notices, set_notices] = useState<Notice[]>([])

  const reload = useCallback(() => {
    get_bridge()?.list_notices?.().then(set_notices).catch(() => {})
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const post_notice = useCallback(
    async (text: string): Promise<void> => {
      const trimmed = text.trim()
      if (!trimmed) return
      await get_bridge()?.create_notice?.(trimmed)
      reload()
    },
    [reload]
  )

  const confirm_notice = useCallback(
    async (noticeId: string): Promise<void> => {
      await get_bridge()?.confirm_notice?.(noticeId)
      reload()
    },
    [reload]
  )

  return { notices, post_notice, confirm_notice }
}
