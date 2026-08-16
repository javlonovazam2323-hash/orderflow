import { useEffect } from 'react'
import { subscribeMock } from '@/lib/api'
import { USE_MOCK } from '@/lib/supabase'

export function useRealtimeRefresh(onRefresh: () => void, deps: unknown[] = []) {
  useEffect(() => {
    if (USE_MOCK) {
      return subscribeMock(onRefresh)
    }
    const interval = setInterval(onRefresh, 2000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
