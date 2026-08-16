import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  dispatchDelivery,
  getCouriers,
  getOrderEvents,
  getOrderSummary,
  markAwaitingPickup,
  markDelivered,
  markPickedUp,
} from '@/lib/api/orders'
import { getOrderItems, getPayments } from '@/lib/api'
import { formatCurrency, formatTime } from '@/lib/format'
import { Drawer } from '@/components/ui/Drawer'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import {
  FULFILLMENT_STATUS_LABELS,
  ORDER_TYPE_ICONS,
  ORDER_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  type OrderEvent,
  type OrderItem,
  type OrderSummary,
  type Payment,
  type Profile,
} from '@/types/database'

interface OrderDetailDrawerProps {
  orderId: string | null
  onClose: () => void
  onUpdated: () => void
  payBasePath?: string
}

export function OrderDetailDrawer({ orderId, onClose, onUpdated, payBasePath = '/cashier/pay' }: OrderDetailDrawerProps) {
  const [order, setOrder] = useState<OrderSummary | null>(null)
  const [items, setItems] = useState<OrderItem[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [events, setEvents] = useState<OrderEvent[]>([])
  const [couriers, setCouriers] = useState<Profile[]>([])
  const [courierId, setCourierId] = useState('')
  const [loading, setLoading] = useState(false)
  const [acting, setActing] = useState(false)

  const load = useCallback(async () => {
    if (!orderId) return
    setLoading(true)
    try {
      const [summary, orderItems, pays, evts] = await Promise.all([
        getOrderSummary(orderId),
        getOrderItems(orderId),
        getPayments(orderId),
        getOrderEvents(orderId),
      ])
      setOrder(summary)
      setItems(orderItems)
      setPayments(pays)
      setEvents(evts)
      if (summary?.order_type === 'delivery') {
        setCouriers(await getCouriers())
      }
    } finally {
      setLoading(false)
    }
  }, [orderId])

  useEffect(() => { load() }, [load])

  const act = async (fn: () => Promise<void>) => {
    setActing(true)
    try {
      await fn()
      await load()
      onUpdated()
    } finally {
      setActing(false)
    }
  }

  if (!orderId) return null

  return (
    <Drawer open={!!orderId} onClose={onClose} title={order ? `№ ${order.order_number}` : 'Zakaz'}>
      {loading && !order ? (
        <div className="p-8 text-center text-muted">Yuklanmoqda...</div>
      ) : order ? (
        <div className="p-5 space-y-6">
          <div className="flex flex-wrap gap-2">
            <Badge className="bg-brand-500/10 text-brand-600">
              {ORDER_TYPE_ICONS[order.order_type]} {ORDER_TYPE_LABELS[order.order_type]}
            </Badge>
            {order.fulfillment_status && (
              <Badge className="bg-surface-2">{FULFILLMENT_STATUS_LABELS[order.fulfillment_status]}</Badge>
            )}
            <Badge className={order.status === 'paid' ? 'bg-green-500/10 text-green-600' : 'bg-amber-500/10 text-amber-700'}>
              {order.status === 'paid' ? 'Yakunlandi' : order.status}
            </Badge>
          </div>

          <section className="space-y-2 text-sm">
            {order.customer_name && <Row label="Mijoz" value={order.customer_name} />}
            {order.customer_phone && <Row label="Telefon" value={order.customer_phone} />}
            {order.delivery_address && <Row label="Manzil" value={order.delivery_address} />}
            {order.delivery_landmark && <Row label="Orientir" value={order.delivery_landmark} />}
            {order.courier_name && <Row label="Kuryer" value={order.courier_name} />}
            {order.table_number && <Row label="Stol" value={`Stol ${order.table_number}`} />}
          </section>

          <section className="space-y-3">
            <h3 className="font-semibold">Mahsulotlar</h3>
            {items.map((item) => (
              <div key={item.id} className="flex gap-3 items-start">
                <div className="w-14 h-14 rounded-xl bg-surface-2 overflow-hidden shrink-0">
                  {item.menu_item?.image_url ? (
                    <img src={item.menu_item.image_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-lg">🍽️</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{item.quantity}× {item.menu_item?.name}</p>
                  <p className="text-sm text-muted">{formatCurrency(item.total_price)}</p>
                  {item.notes && <p className="text-xs text-amber-600 mt-0.5">{item.notes}</p>}
                </div>
              </div>
            ))}
          </section>

          <section className="rounded-2xl bg-surface-2 p-4 space-y-2 text-sm">
            <Row label="Mahsulotlar jami" value={formatCurrency(order.subtotal)} />
            {order.delivery_fee > 0 && <Row label="Dostavka" value={formatCurrency(order.delivery_fee)} />}
            {order.discount_amount > 0 && <Row label="Chegirma" value={`−${formatCurrency(order.discount_amount)}`} />}
            <Row label="JAMI" value={formatCurrency(order.total)} bold />
            <Row label="To'langan" value={formatCurrency(order.paid_total)} />
            <Row label="QOLDIQ" value={formatCurrency(order.balance_due)} bold highlight={order.balance_due > 0} />
          </section>

          {payments.length > 0 && (
            <section className="space-y-2">
              <h3 className="font-semibold text-sm">To'lovlar</h3>
              {payments.map((p) => (
                <div key={p.id} className="text-sm flex justify-between">
                  <span>{PAYMENT_METHOD_LABELS[p.method as keyof typeof PAYMENT_METHOD_LABELS]}</span>
                  <span>{formatCurrency(p.amount)} · {formatTime(p.created_at)}</span>
                </div>
              ))}
            </section>
          )}

          {events.length > 0 && (
            <section className="space-y-2">
              <h3 className="font-semibold text-sm">Timeline</h3>
              <ol className="space-y-2 border-l-2 border-border pl-4">
                {events.map((e) => (
                  <li key={e.id} className="text-sm">
                    <span className="text-muted">{formatTime(e.created_at)}</span>{' '}
                    {e.message}
                  </li>
                ))}
              </ol>
            </section>
          )}

          <div className="space-y-2 pt-2">
            {order.balance_due > 0 && order.status !== 'paid' && (
              <Link to={`${payBasePath}/${order.id}`}>
                <Button className="w-full" size="lg">To'lov qabul qilish</Button>
              </Link>
            )}

            {order.order_type === 'pickup' && order.fulfillment_status === 'ready' && (
              <Button className="w-full" variant="secondary" loading={acting} onClick={() => act(() => markAwaitingPickup(order.id))}>
                🥡 Olib ketishga tayyor
              </Button>
            )}

            {order.order_type === 'pickup' && ['ready', 'awaiting_pickup'].includes(order.fulfillment_status ?? '') && order.balance_due === 0 && (
              <Button className="w-full" size="lg" loading={acting} onClick={() => act(() => markPickedUp(order.id))}>
                Olib ketdi → Yakunlandi
              </Button>
            )}

            {order.order_type === 'delivery' && order.fulfillment_status === 'ready' && (
              <div className="space-y-2">
                <select
                  value={courierId}
                  onChange={(e) => setCourierId(e.target.value)}
                  className="w-full h-12 px-4 rounded-xl border border-border bg-surface"
                >
                  <option value="">Kuryer tanlang</option>
                  {couriers.map((c) => (
                    <option key={c.id} value={c.id}>{c.full_name}</option>
                  ))}
                </select>
                <Button
                  className="w-full"
                  loading={acting}
                  disabled={!courierId}
                  onClick={() => act(() => dispatchDelivery(order.id, courierId))}
                >
                  Dostavkaga berish
                </Button>
              </div>
            )}

            {order.order_type === 'delivery' && order.fulfillment_status === 'in_transit' && order.balance_due === 0 && (
              <Button className="w-full" size="lg" loading={acting} onClick={() => act(() => markDelivered(order.id))}>
                Yetkazildi → Yakunlandi
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="p-8 text-center text-muted">Zakaz topilmadi</div>
      )}
    </Drawer>
  )
}

function Row({ label, value, bold, highlight }: { label: string; value: string; bold?: boolean; highlight?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${bold ? 'font-bold text-base' : ''}`}>
      <span className="text-muted">{label}</span>
      <span className={highlight ? 'text-red-500' : ''}>{value}</span>
    </div>
  )
}
