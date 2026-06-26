import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useState, useEffect, useCallback } from 'react'
import type { Schedule } from '../types'

export function useSchedules() {
  const [schedules, setSchedules] = useState<Schedule[]>([])

  const refresh = useCallback(async () => {
    try { setSchedules(await invoke<Schedule[]>('list_schedules')) } catch { /* db not ready */ }
  }, [])

  useEffect(() => {
    refresh()
    const unsub = listen('refresh', refresh)
    return () => { unsub.then(f => f()) }
  }, [refresh])

  const create = async (params: {
    title: string; date: string; endDate: string | null
    allDay: boolean; startTime: string | null; endTime: string | null
    repeatWeekly: boolean; repeatMonthly: boolean
    memo: string | null; color: string
  }) => {
    await invoke('create_schedule', {
      title: params.title, date: params.date, endDate: params.endDate,
      allDay: params.allDay, startTime: params.startTime, endTime: params.endTime,
      repeatWeekly: params.repeatWeekly, repeatMonthly: params.repeatMonthly,
      memo: params.memo, color: params.color,
    })
    await refresh()
  }

  const remove = async (id: string) => {
    await invoke('delete_schedule', { id })
    await refresh()
  }

  return { schedules, refresh, create, remove }
}
