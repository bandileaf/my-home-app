import { useCallback, useEffect, useState } from 'react'
import { get_bridge, type Notice, type NoticeKind } from '../bridge'

interface UseNoticesResult {
  notices: Notice[]
  error: string | null
  post_notice: (text: string, kind: NoticeKind) => Promise<void>
  reply_notice: (noticeId: string, text: string) => Promise<void>
  edit_notice: (noticeId: string, text: string) => Promise<void>
  vote_notice: (noticeId: string, vote: 'yes' | 'no') => Promise<void>
}

export function useNotices(): UseNoticesResult {
  const [notices, set_notices] = useState<Notice[]>([])
  const [error, set_error] = useState<string | null>(null)

  const reload = useCallback(() => {
    get_bridge()?.list_notices?.()
      .then((data) => { set_notices(data); set_error(null) })
      .catch((e: unknown) => set_error(String(e)))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  const post_notice = useCallback(
    async (text: string, kind: NoticeKind): Promise<void> => {
      const trimmed = text.trim()
      if (!trimmed) return
      try {
        await get_bridge()?.create_notice?.(trimmed, kind)
        reload()
      } catch (e: unknown) {
        set_error(String(e))
      }
    },
    [reload]
  )

  const reply_notice = useCallback(
    async (noticeId: string, text: string): Promise<void> => {
      try {
        await get_bridge()?.create_reply?.(noticeId, text)
        reload()
      } catch (e: unknown) {
        set_error(String(e))
      }
    },
    [reload]
  )

  const edit_notice = useCallback(
    async (noticeId: string, text: string): Promise<void> => {
      try { await get_bridge()?.update_notice?.(noticeId, text); reload() }
      catch (e: unknown) { set_error(String(e)) }
    },
    [reload]
  )

  const vote_notice = useCallback(
    async (noticeId: string, vote: 'yes' | 'no'): Promise<void> => {
      try { await get_bridge()?.cast_vote?.(noticeId, vote); reload() }
      catch (e: unknown) { set_error(String(e)) }
    },
    [reload]
  )

  return { notices, error, post_notice, reply_notice, edit_notice, vote_notice }
}
