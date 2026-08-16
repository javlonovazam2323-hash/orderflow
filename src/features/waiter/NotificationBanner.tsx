import { useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useNotifications } from '@/hooks/useNotifications'
import { Badge } from '@/components/ui/Badge'

export function NotificationBanner() {
  const { user } = useAuth()
  const { notifications, unreadCount, dismiss, requestPermission } = useNotifications(user?.id)

  useEffect(() => {
    requestPermission()
  }, [requestPermission])

  const latest = notifications.find((n) => !n.is_read)

  if (!latest) return null

  return (
    <div
      className="sticky top-0 z-30 mx-3 mt-3 rounded-2xl bg-green-600 text-white p-4 shadow-lg cursor-pointer animate-pulse-ring"
      onClick={() => dismiss(latest.id)}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-bold text-base">{latest.title}</p>
          <p className="text-sm opacity-90 mt-0.5">{latest.body}</p>
        </div>
        {unreadCount > 1 && (
          <Badge className="bg-white/20 text-white shrink-0">+{unreadCount - 1}</Badge>
        )}
      </div>
    </div>
  )
}
