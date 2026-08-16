import { useCallback, useEffect, useRef, useState } from 'react'
import { getNotifications, markNotificationRead, subscribeMock } from '@/lib/api'
import { USE_MOCK } from '@/lib/supabase'
import type { Notification } from '@/types/database'

const AUDIO_URL = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBSuBzvLZiTYIG2m98OScTgwOUKzn8LZjHAY4kdfyzHksBSR3x/DdkEAKFF606euoVRQKRp/g8r5sIQUrgc7y2Yk2CBtpvfDknE4MDlCs5/C2YxwGOJHX8sx5LAUkd8fw3ZBAC'

export function useNotifications(userId: string | undefined) {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const prevCount = useRef(0)
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
      // Supabase realtime subscription would go here
      const interval = setInterval(refresh, 3000)
      unsub = () => clearInterval(interval)
    }
    return () => unsub?.()
  }, [userId, refresh])

  useEffect(() => {
    if (!userId) return
    const unread = notifications.filter((n) => !n.is_read)
    if (unread.length > prevCount.current && prevCount.current > 0) {
      playAlert(unread[0])
    }
    prevCount.current = unread.length
  }, [notifications, userId])

  const playAlert = async (notification: Notification) => {
    if ('vibrate' in navigator) navigator.vibrate([200, 100, 200])

    try {
      if (!audioRef.current) audioRef.current = new Audio(AUDIO_URL)
      await audioRef.current.play()
    } catch { /* autoplay blocked */ }

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
