import { useEffect } from 'react'
import { subscribeMock } from '@/lib/api'
import { REALTIME_TABLES } from '@/lib/api/tables'
import { getSupabase, USE_MOCK } from '@/lib/supabase'
import { useTenantStore } from '@/stores/tenantStore'

export function useRealtimeRefresh(onRefresh: () => void, deps: unknown[] = []) {
  const restaurantId = useTenantStore((s) => s.active?.restaurantId)

  useEffect(() => {
    if (USE_MOCK) {
      return subscribeMock(onRefresh)
    }

    if (!restaurantId) return

    const sb = getSupabase()
    let timer: ReturnType<typeof setTimeout> | null = null

    const scheduleRefresh = () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        onRefresh()
      }, 150)
    }

    const filter = `restaurant_id=eq.${restaurantId}`
    let channel = sb.channel(`orderflow-live-${restaurantId}`)
    for (const table of REALTIME_TABLES) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter },
        scheduleRefresh,
      )
    }
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'notifications', filter },
      scheduleRefresh,
    )
    channel.subscribe()

    onRefresh()

    return () => {
      if (timer) clearTimeout(timer)
      sb.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, ...deps])
}

export { REALTIME_TABLES }
