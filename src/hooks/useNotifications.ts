import { useCallback, useEffect, useRef, useState } from 'react'
import { getNotifications, markNotificationRead, subscribeMock } from '@/lib/api'
import { getSupabase, USE_MOCK } from '@/lib/supabase'
import type { Notification } from '@/types/database'

const AUDIO_URL = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwOUKzn8LZjHAY4kdfyzHksBSR3x/DdkEAKFF606euoVRQKRp/g8r5sIQUrgc7y2Yk2CBtpvfDknE4MDlCs5/C2YxwGOJHX8sx5LAUkd8fw3ZBAC'

export function useNotifications(userId: string | undefined) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const prevUnread = useRef(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const refresh = useCallback(async () => {
    if (!userId) return
    const data = await getNotifications(userId)
    setNotifications(data)
  }, [userId])

  useEffect(() => {
    if (!userId) return
    refresh()

    let unsub: (() => void) | undefined
    if (USE_MOCK) {
      unsub = subscribeMock(refresh)
    } else {
      const sb = getSupabase()
      const channel = sb
        .channel(`notifications-${userId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
          () => refresh(),
        )
        .subscribe()
      unsub = () => { sb.removeChannel(channel) }
    }
    return () => unsub?.()
  }, [userId, refresh])

  useEffect(() => {
    if (!userId) return
    const unread = notifications.filter((n) => !n.is_read)
    if (unread.length > prevUnread.current && prevUnread.current >= 0) {
      const latest = unread[0]
      if (latest && ['pickup_ready', 'delivery_ready', 'order_ready'].includes(latest.type)) {
        playAlert(latest)
      }
    }
    prevUnread.current = unread.length
  }, [notifications, userId])

  const playAlert = async (notification: Notification) => {
    if ('vibrate' in navigator) navigator.vibrate([150, 80, 150])

    try {
      if (!audioRef.current) {
        audioRef.current = new Audio(AUDIO_URL)
        audioRef.current.volume = 0.4
      }
      audioRef.current.currentTime = 0
      await audioRef.current.play()
    } catch { /* autoplay blocked until user gesture */ }

    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(notification.title, { body: notification.body, tag: notification.id })
    }
  }

  const requestPermission = async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission()
    }
  }

  const dismiss = async (id: string) => {
    await markNotificationRead(id)
    refresh()
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length

  return { notifications, unreadCount, refresh, dismiss, requestPermission }
}
