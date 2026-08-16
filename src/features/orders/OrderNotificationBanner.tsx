import { useAuth } from '@/hooks/useAuth'
import { useNotifications } from '@/hooks/useNotifications'
import { ORDER_TYPE_LABELS, type Notification } from '@/types/database'

interface OrderNotificationBannerProps {
  onSelectOrder?: (orderId: string) => void
}

export function OrderNotificationBanner({ onSelectOrder }: OrderNotificationBannerProps) {
  const { user } = useAuth()
  const { notifications, dismiss } = useNotifications(user?.id)

  const readyAlerts = notifications.filter(
    (n) => !n.is_read && (n.type === 'pickup_ready' || n.type === 'delivery_ready' || n.type === 'order_ready'),
  )

  if (readyAlerts.length === 0) return null

  return (
    <div className="space-y-2">
      {readyAlerts.slice(0, 3).map((n) => (
        <ReadyAlert key={n.id} notification={n} onDismiss={() => dismiss(n.id)} onSelect={onSelectOrder} />
      ))}
    </div>
  )
}

function ReadyAlert({
  notification,
  onDismiss,
  onSelect,
}: {
  notification: Notification
  onDismiss: () => void
  onSelect?: (orderId: string) => void
}) {
  const data = notification.data as { order_id?: string; order_number?: string; order_type?: string; customer_name?: string }
  const orderType = data.order_type as keyof typeof ORDER_TYPE_LABELS | undefined

  return (
    <div className="rounded-2xl border border-green-500/40 bg-green-500/10 p-4 flex flex-wrap items-center justify-between gap-3 animate-in fade-in">
      <div>
        <p className="font-bold text-green-700 dark:text-green-400">🔔 ZAKAZ TAYYOR</p>
        <p className="font-semibold">{data.order_number ?? notification.title}</p>
        <p className="text-sm text-muted">
          {data.customer_name ?? notification.body}
          {orderType && ` · ${ORDER_TYPE_LABELS[orderType]}`}
        </p>
        <p className="text-xs text-muted mt-0.5">Zakaz tayyor bo'ldi</p>
      </div>
      <div className="flex gap-2">
        {data.order_id && onSelect && (
          <button
            onClick={() => { onSelect(data.order_id!); onDismiss() }}
            className="px-4 py-2 rounded-xl bg-green-600 text-white text-sm font-semibold"
          >
            Ko'rish
          </button>
        )}
        <button onClick={onDismiss} className="px-3 py-2 rounded-xl bg-surface-2 text-sm">Yopish</button>
      </div>
    </div>
  )
}
