import { useEffect } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { isGuestCallNotification, useNotifications } from '@/hooks/useNotifications'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'

export function NotificationBanner() {
  const { user } = useAuth()
  const { notifications, unreadCount, dismiss, requestPermission } = useNotifications(user?.id)

  useEffect(() => {
    requestPermission()
  }, [requestPermission])

  const latest = notifications.find((n) => !n.is_read)
  if (!latest) return null

  const guestCall = isGuestCallNotification(latest)
  const tableNo = latest.data?.table_number

  return (
    <div
      className={`sticky top-0 z-30 mx-3 mt-3 rounded-2xl text-white p-4 shadow-lg ${
        guestCall ? 'bg-red-600 animate-pulse-ring' : 'bg-green-600 animate-pulse-ring cursor-pointer'
      }`}
      onClick={guestCall ? undefined : () => dismiss(latest.id)}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-bold text-base">
            {guestCall ? `🔔 ${latest.title}` : latest.title}
          </p>
          <p className="text-sm opacity-90 mt-0.5">{latest.body}</p>
          {guestCall && tableNo != null && (
            <p className="text-xs mt-1 opacity-80">Stol №{String(tableNo)}</p>
          )}
        </div>
        {unreadCount > 1 && (
          <Badge className="bg-white/20 text-white shrink-0">+{unreadCount - 1}</Badge>
        )}
      </div>
      {guestCall && (
        <Button
          size="sm"
          className="mt-3 bg-white text-red-700 hover:bg-red-50"
          onClick={() => void dismiss(latest.id)}
        >
          Qabul qildim
        </Button>
      )}
    </div>
  )
}
