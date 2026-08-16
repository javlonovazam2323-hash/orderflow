import { useEffect } from 'react'
import { subscribeMock } from '@/lib/api'
import { REALTIME_TABLES } from '@/lib/api/tables'
import { getSupabase, USE_MOCK } from '@/lib/supabase'

export function useRealtimeRefresh(onRefresh: () => void, deps: unknown[] = []) {
  useEffect(() => {
    if (USE_MOCK) {
      return subscribeMock(onRefresh)
    }

    const sb = getSupabase()
    let timer: ReturnType<typeof setTimeout> | null = null

    const scheduleRefresh = () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        onRefresh()
      }, 150)
    }

    const channel = sb
      .channel('orderflow-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'restaurant_tables' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'table_reservations' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'kitchen_tickets' }, scheduleRefresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, scheduleRefresh)
      .subscribe()

    onRefresh()

    return () => {
      if (timer) clearTimeout(timer)
      sb.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

export { REALTIME_TABLES }
