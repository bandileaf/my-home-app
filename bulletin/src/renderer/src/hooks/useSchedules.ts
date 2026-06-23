import { useCallback, useEffect, useState } from 'react'
import { get_bridge, type Schedule } from '../bridge'

export function useSchedules(): {
  schedules: Schedule[]
  reload: () => void
  create: (userId: string, title: string, date: string, endDate: string | null, allDay: boolean, startTime: string | null, endTime: string | null, repeatWeekly: boolean, memo: string | null, color: string) => Promise<void>
  remove: (id: string) => Promise<void>
} {
  const [schedules, set_schedules] = useState<Schedule[]>([])

  const reload = useCallback(() => {
    get_bridge()?.list_schedules?.().then(set_schedules).catch(() => {})
  }, [])

  useEffect(() => { reload() }, [reload])

  const create = useCallback(async (userId: string, title: string, date: string, endDate: string | null, allDay: boolean, startTime: string | null, endTime: string | null, repeatWeekly: boolean, memo: string | null, color: string) => {
    await get_bridge()?.create_schedule?.(userId, title, date, endDate, allDay, startTime, endTime, repeatWeekly, memo, color)
    reload()
  }, [reload])

  const remove = useCallback(async (id: string) => {
    await get_bridge()?.delete_schedule?.(id)
    reload()
  }, [reload])

  return { schedules, reload, create, remove }
}
