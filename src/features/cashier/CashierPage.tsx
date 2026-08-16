import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { getCashSession, getOpenOrders, getTables } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { formatCurrency } from '@/lib/format'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { PAYMENT_METHOD_LABELS, type CashSessionSummary, type Order } from '@/types/database'

export function CashierPage() {
  const { signOut } = useAuth()
  const [session, setSession] = useState<CashSessionSummary | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [awaitingCount, setAwaitingCount] = useState(0)

  const refresh = useCallback(async () => {
    const [cash, openOrders, tables] = await Promise.all([
      getCashSession(),
      getOpenOrders(),
      getTables(),
    ])
    setSession(cash)
    setOrders(openOrders.filter((o) => ['open', 'awaiting_payment'].includes(o.status)))
    setAwaitingCount(tables.filter((t) => t.status === 'awaiting_payment').length)
  }, [])

  useRealtimeRefresh(refresh, [refresh])

  return (
    <div className="min-h-full p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">💰 Kassa</h1>
          <p className="text-muted text-sm">Bugungi tushum va ochiq hisoblar</p>
        </div>
        <Button variant="ghost" onClick={() => signOut()}>Chiqish</Button>
      </header>

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
              {session.order_count > 0 && (
                <span>O'rtacha: {formatCurrency(Math.round(session.total_revenue / session.order_count))}</span>
              )}
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
            <OpenOrderRow key={order.id} order={order} />
          ))
        )}
      </section>
    </div>
  )
}

function OpenOrderRow({ order }: { order: Order }) {
  const [tableNum, setTableNum] = useState<number | null>(null)

  useRealtimeRefresh(async () => {
    const tables = await getTables()
    const t = tables.find((tb) => tb.id === order.table_id)
    if (t) setTableNum(t.number)
  }, [order.table_id])

  return (
    <Link to={`/cashier/pay/${order.id}`}>
      <Card className="hover:shadow-md transition-shadow active:scale-[0.99]">
        <CardContent className="py-4 flex items-center justify-between">
          <div>
            <p className="font-bold">Stol {tableNum ?? '—'} · № {order.order_number}</p>
            <Badge className={order.status === 'awaiting_payment' ? 'bg-purple-100 text-purple-700 mt-1' : 'bg-amber-100 text-amber-700 mt-1'}>
              {order.status === 'awaiting_payment' ? 'To\'lov kutilmoqda' : 'Ochiq'}
            </Badge>
          </div>
          <p className="text-xl font-bold text-brand-600">{formatCurrency(order.total)}</p>
        </CardContent>
      </Card>
    </Link>
  )
}
