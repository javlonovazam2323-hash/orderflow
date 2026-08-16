import { useCallback, useState } from 'react'
import { getKitchenTickets, getOpenOrders, getOrderItems, requestBill } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { formatCurrency, formatTime } from '@/lib/format'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { KITCHEN_STATUS_LABELS, type KitchenTicket, type Order } from '@/types/database'

export function OrdersPage() {
  const { user } = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [tickets, setTickets] = useState<KitchenTicket[]>([])

  const refresh = useCallback(async () => {
    const [allOrders, allTickets] = await Promise.all([
      getOpenOrders(),
      getKitchenTickets(),
    ])
    setOrders(allOrders.filter((o) => o.waiter_id === user?.id))
    setTickets(allTickets.filter((t) => t.waiter_id === user?.id))
  }, [user?.id])

  useRealtimeRefresh(refresh, [refresh])

  const handleRequestBill = async (orderId: string) => {
    await requestBill(orderId)
    refresh()
  }

  return (
    <div className="p-4 space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Buyurtmalarim</h1>
        <p className="text-sm text-muted">Aktiv stollar va holat</p>
      </header>

      {orders.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted">
            Hozircha aktiv buyurtma yo'q
          </CardContent>
        </Card>
      ) : (
        orders.map((order) => {
          const orderTickets = tickets.filter((t) => t.order_id === order.id)
          return (
            <OrderCard
              key={order.id}
              order={order}
              tickets={orderTickets}
              onRequestBill={() => handleRequestBill(order.id)}
            />
          )
        })
      )}
    </div>
  )
}

function OrderCard({
  order,
  tickets,
  onRequestBill,
}: {
  order: Order
  tickets: KitchenTicket[]
  onRequestBill: () => void
}) {
  const [items, setItems] = useState<Awaited<ReturnType<typeof getOrderItems>>>([])

  useRealtimeRefresh(async () => {
    setItems(await getOrderItems(order.id))
  }, [order.id])

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex justify-between items-start">
          <div>
            <p className="font-bold text-lg">Hisob № {order.order_number}</p>
            <p className="text-sm text-muted">{formatTime(order.opened_at)}</p>
          </div>
          <Badge className="bg-brand-100 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
            {formatCurrency(order.total)}
          </Badge>
        </div>

        <ul className="space-y-1 text-sm">
          {items.map((item) => (
            <li key={item.id} className="flex justify-between">
              <span>{item.menu_item?.name ?? '—'} × {item.quantity}</span>
              <span className="text-muted">{item.status}</span>
            </li>
          ))}
        </ul>

        {tickets.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {tickets.map((t) => (
              <Badge
                key={t.id}
                className={
                  t.status === 'ready'
                    ? 'bg-green-100 text-green-700'
                    : t.status === 'new'
                      ? 'bg-red-100 text-red-700 animate-pulse'
                      : 'bg-amber-100 text-amber-700'
                }
              >
                #{t.ticket_number} {KITCHEN_STATUS_LABELS[t.status]}
              </Badge>
            ))}
          </div>
        )}

        {order.status === 'open' && (
          <Button variant="outline" className="w-full" onClick={onRequestBill}>
            Hisob so'rash
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
