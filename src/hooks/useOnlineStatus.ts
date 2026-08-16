import { useCallback, useEffect, useState } from 'react'
import { flushQueue, getQueueCount, isOnline } from '@/lib/offline/queue'
import { sendToKitchen } from '@/lib/api'

export function useOnlineStatus() {
  const [online, setOnline] = useState(isOnline())
  const [pendingCount, setPendingCount] = useState(getQueueCount())
  const [syncing, setSyncing] = useState(false)

  const refreshPending = useCallback(() => {
    setPendingCount(getQueueCount())
  }, [])

  const syncQueue = useCallback(async () => {
    if (!isOnline() || syncing) return
    setSyncing(true)
    try {
      await flushQueue(async (action) => {
        if (action.type === 'send_to_kitchen') {
          await sendToKitchen(
            action.payload.order_id,
            action.payload.items,
            action.idempotency_key,
          )
        }
      })
    } finally {
      setSyncing(false)
      refreshPending()
    }
  }, [syncing, refreshPending])

  useEffect(() => {
    const goOnline = () => {
      setOnline(true)
      syncQueue()
    }
    const goOffline = () => setOnline(false)

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    refreshPending()

    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [syncQueue, refreshPending])

  return { online, pendingCount, syncing, syncQueue, refreshPending }
}
