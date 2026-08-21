import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { getCashSession } from '@/lib/api'
import { getOrderSummaries } from '@/lib/api/orders'
import { useAuth } from '@/hooks/useAuth'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { RestaurantSwitcher } from '@/components/layout/RestaurantSwitcher'
import { formatCurrency, formatTime } from '@/lib/format'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { OrderNotificationBanner } from '@/features/orders/OrderNotificationBanner'
import {
  ORDER_TYPE_ICONS,
  ORDER_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  type CashSessionSummary,
  type OrderSummary,
} from '@/types/database'

export function CashierPage() {
  const { signOut } = useAuth()
  const [session, setSession] = useState<CashSessionSummary | null>(null)
  const [orders, setOrders] = useState<OrderSummary[]>([])

  const refresh = useCallback(async () => {
    const [cash, summaries] = await Promise.all([
      getCashSession(),
      getOrderSummaries({ todayOnly: true }),
    ])
    setSession(cash)
    setOrders(summaries.filter((o) => ['open', 'awaiting_payment'].includes(o.status)))
  }, [])

  useRealtimeRefresh(refresh, [refresh])

  const awaitingCount = orders.filter((o) => o.status === 'awaiting_payment' || o.balance_due > 0).length

  return (
    <div className="min-h-full p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">💰 Kassa</h1>
          <p className="text-muted text-sm">Bugungi tushum va ochiq hisoblar</p>
        </div>
        <div className="flex gap-2 items-center">
          <RestaurantSwitcher />
          <Link to="/cashier/orders">
            <Button variant="outline">Zakazlar</Button>
          </Link>
          <Button variant="ghost" onClick={() => signOut()}>Chiqish</Button>
        </div>
      </header>

      <OrderNotificationBanner />

      {session && (
        <Card className="bg-gradient-to-br from-brand-600 to-brand-700 text-white border-0">
          <CardHeader>
            <p className="text-brand-100 text-sm">Bugungi tushum</p>
            <p className="text-4xl font-black">{formatCurrency(session.total_revenue)}</p>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              {(['cash', 'card', 'click', 'payme', 'other'] as const).map((m) => (
                <div key={m} className="bg-white/10 rounded-xl p-3">
                  <p className="text-brand-100">{PAYMENT_METHOD_LABELS[m]}</p>
                  <p className="font-bold">{formatCurrency(session[`${m}_total` as keyof CashSessionSummary] as number)}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-4 mt-4 text-sm">
              <span>{session.order_count} ta hisob</span>
              <span>{awaitingCount} ochiq</span>
            </div>
          </CardContent>
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="font-semibold text-lg">Ochiq hisoblar</h2>
        {orders.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-muted">Ochiq hisob yo'q</CardContent></Card>
        ) : (
          orders.map((order) => (
            <Link key={order.id} to={`/cashier/pay/${order.id}`}>
              <Card className="hover:shadow-md transition-shadow active:scale-[0.99]">
                <CardContent className="py-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-bold">{order.order_number}</p>
                        <Badge className="bg-brand-500/10 text-brand-600">
                          {ORDER_TYPE_ICONS[order.order_type]} {ORDER_TYPE_LABELS[order.order_type]}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted mt-1">
                        {order.order_type === 'dine_in'
                          ? `Stol ${order.table_number ?? '—'}`
                          : `${order.customer_name ?? '—'} · ${order.customer_phone ?? ''}`}
                      </p>
                      <p className="text-xs text-muted">{formatTime(order.opened_at)}</p>
                    </div>
                    <p className="text-xl font-bold text-brand-600">{formatCurrency(order.balance_due > 0 ? order.balance_due : order.total)}</p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-muted">
                    <span>Jami: {formatCurrency(order.total)}</span>
                    {order.delivery_fee > 0 && <span>Dostavka: {formatCurrency(order.delivery_fee)}</span>}
                    {order.discount_amount > 0 && <span>Chegirma: {formatCurrency(order.discount_amount)}</span>}
                    <span>To'langan: {formatCurrency(order.paid_total)}</span>
                    <span className={order.balance_due > 0 ? 'text-red-500 font-semibold' : ''}>
                      Qoldiq: {formatCurrency(order.balance_due)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </section>
    </div>
  )
}
