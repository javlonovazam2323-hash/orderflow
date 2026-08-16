import { useCallback, useMemo, useState } from 'react'
import { computeOrderKpis, getDisplayStatus, getOrderSummaries } from '@/lib/api/orders'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { formatCurrency, formatTime } from '@/lib/format'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { OrderDetailDrawer } from './OrderDetailDrawer'
import { NewOrderModal } from './NewOrderModal'
import { OrderNotificationBanner } from './OrderNotificationBanner'
import {
  ORDER_TYPE_ICONS,
  ORDER_TYPE_LABELS,
  type OrderSummary,
  type OrderType,
} from '@/types/database'

type StatusFilter = 'all' | 'new' | 'kitchen' | 'ready' | 'transit' | 'done' | 'cancelled'

interface OrdersPageProps {
  title?: string
  payBasePath?: string
  showSignOut?: boolean
  onSignOut?: () => void
}

export function OrdersPage({
  title = 'Zakazlar',
  payBasePath = '/cashier/pay',
  showSignOut,
  onSignOut,
}: OrdersPageProps) {
  const [orders, setOrders] = useState<OrderSummary[]>([])
  const [typeFilter, setTypeFilter] = useState<OrderType | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)

  const refresh = useCallback(async () => {
    setOrders(await getOrderSummaries({
      orderType: typeFilter,
      statusGroup: statusFilter,
      search,
      todayOnly: true,
    }))
  }, [typeFilter, statusFilter, search])

  useRealtimeRefresh(refresh, [refresh])

  const kpis = useMemo(() => computeOrderKpis(orders), [orders])

  return (
    <div className="min-h-full p-4 md:p-6 space-y-5 max-w-6xl mx-auto">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="text-sm text-muted">Bugungi barcha zakazlar</p>
        </div>
        <div className="flex gap-2">
          <Button size="lg" onClick={() => setShowNew(true)}>+ Yangi zakaz</Button>
          {showSignOut && onSignOut && (
            <Button variant="ghost" onClick={onSignOut}>Chiqish</Button>
          )}
        </div>
      </header>

      <OrderNotificationBanner onSelectOrder={setSelectedId} />

      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
        <KpiCard label="Jami" value={String(kpis.total)} />
        <KpiCard label="Stol" value={String(kpis.dineIn)} />
        <KpiCard label="Olib ketish" value={String(kpis.pickup)} />
        <KpiCard label="Dostavka" value={String(kpis.delivery)} />
        <KpiCard label="Oshxonada" value={String(kpis.inKitchen)} />
        <KpiCard label="Tayyor" value={String(kpis.ready)} />
        <KpiCard label="Yo'lda" value={String(kpis.inTransit)} />
        <KpiCard label="Savdo" value={formatCurrency(kpis.todaySales)} small />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <input
          type="search"
          placeholder="Zakaz №, telefon, mijoz..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 h-11 px-4 rounded-xl border border-border bg-surface"
        />
        <div className="flex gap-2 overflow-x-auto scrollbar-hide">
          {(['all', 'dine_in', 'pickup', 'delivery'] as const).map((t) => (
            <FilterChip key={t} active={typeFilter === t} onClick={() => setTypeFilter(t)}>
              {t === 'all' ? 'Barchasi' : `${ORDER_TYPE_ICONS[t]} ${ORDER_TYPE_LABELS[t]}`}
            </FilterChip>
          ))}
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
        {([
          ['all', 'Barchasi'],
          ['new', 'Yangi'],
          ['kitchen', 'Oshxonada'],
          ['ready', 'Tayyor'],
          ['transit', 'Yo\'lda'],
          ['done', 'Yakunlandi'],
          ['cancelled', 'Bekor'],
        ] as [StatusFilter, string][]).map(([k, label]) => (
          <FilterChip key={k} active={statusFilter === k} onClick={() => setStatusFilter(k)}>
            {label}
          </FilterChip>
        ))}
      </div>

      <div className="space-y-2">
        {orders.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted">Zakaz topilmadi</CardContent></Card>
        ) : (
          orders.map((order) => (
            <OrderRow key={order.id} order={order} onClick={() => setSelectedId(order.id)} />
          ))
        )}
      </div>

      {showNew && <NewOrderModal onClose={() => setShowNew(false)} onCreated={refresh} />}
      <OrderDetailDrawer
        orderId={selectedId}
        onClose={() => setSelectedId(null)}
        onUpdated={refresh}
        payBasePath={payBasePath}
      />
    </div>
  )
}

function OrderRow({ order, onClick }: { order: OrderSummary; onClick: () => void }) {
  const status = getDisplayStatus(order)
  const toneClass =
    status.tone === 'success' ? 'bg-green-500/10 text-green-600' :
    status.tone === 'warning' ? 'bg-orange-500/10 text-orange-600' :
    status.tone === 'info' ? 'bg-blue-500/10 text-blue-600' :
    status.tone === 'purple' ? 'bg-purple-500/10 text-purple-600' :
    'bg-surface-2 text-muted'

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-2xl border border-border bg-surface p-4 hover:border-brand-500/40 hover:shadow-md transition-all active:scale-[0.99]"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-black text-lg">{order.order_number}</span>
            <Badge className="bg-brand-500/10 text-brand-600">
              {ORDER_TYPE_ICONS[order.order_type]} {ORDER_TYPE_LABELS[order.order_type]}
            </Badge>
            <Badge className={toneClass}>{status.label}</Badge>
          </div>
          <p className="text-sm text-muted">
            {order.customer_name ?? order.waiter_name ?? '—'}
            {order.customer_phone ? ` · ${order.customer_phone}` : ''}
            {order.table_number ? ` · Stol ${order.table_number}` : ''}
          </p>
          <p className="text-xs text-muted">{formatTime(order.opened_at)}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-bold text-lg">{formatCurrency(order.total)}</p>
          {order.balance_due > 0 && (
            <p className="text-sm text-red-500">Qoldiq: {formatCurrency(order.balance_due)}</p>
          )}
        </div>
      </div>
    </button>
  )
}

function KpiCard({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <Card>
      <CardContent className={`py-3 ${small ? 'px-2' : ''}`}>
        <p className="text-[10px] uppercase tracking-wide text-muted">{label}</p>
        <p className={`font-bold ${small ? 'text-sm' : 'text-xl'} truncate`}>{value}</p>
      </CardContent>
    </Card>
  )
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 px-3 py-2 rounded-xl text-xs font-medium transition-colors ${
        active ? 'bg-brand-600 text-white' : 'bg-surface-2 text-muted hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}
