import { Link } from 'react-router-dom'
import { useCallback, useMemo, useState } from 'react'
import { getCashSession, getKitchenTickets, getOpenOrders } from '@/lib/api'
import { getTableSummaries } from '@/lib/api/tables'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { formatCurrency } from '@/lib/format'
import {
  DISPLAY_CATEGORY_META,
  countByCategory,
  getDisplayCategory,
  type TableDisplayCategory,
} from '@/lib/tables/status'
import { Card, CardContent } from '@/components/ui/Card'
import type { CashSessionSummary, TableSummary } from '@/types/database'

export function DashboardPage() {
  const [session, setSession] = useState<CashSessionSummary | null>(null)
  const [tables, setTables] = useState<TableSummary[]>([])
  const [stats, setStats] = useState({ openOrders: 0, kitchenActive: 0, ready: 0 })

  const refresh = useCallback(async () => {
    const [cash, tableRows, orders, tickets] = await Promise.all([
      getCashSession(),
      getTableSummaries(),
      getOpenOrders(),
      getKitchenTickets(),
    ])
    setSession(cash)
    setTables(tableRows)
    setStats({
      openOrders: orders.length,
      kitchenActive: tickets.filter((t) => !['ready', 'cancelled'].includes(t.status)).length,
      ready: tickets.filter((t) => t.status === 'ready').length,
    })
  }, [])

  useRealtimeRefresh(refresh, [refresh])

  const counts = useMemo(() => countByCategory(tables), [tables])
  const occupiedCount = counts.occupied + counts.awaiting_payment

  const kpis = [
    { label: 'Bugungi savdo', value: formatCurrency(session?.total_revenue ?? 0), icon: '💰' },
    { label: 'Band stollar', value: String(occupiedCount), icon: '🪑' },
    { label: 'Ochiq hisoblar', value: String(stats.openOrders), icon: '📋' },
    { label: 'Oshxona aktiv', value: String(stats.kitchenActive), icon: '🍳' },
    { label: 'Tayyor', value: String(stats.ready), icon: '✅' },
    { label: 'Hisoblar soni', value: String(session?.order_count ?? 0), icon: '🧾' },
  ]

  const quickLinks = [
    { to: '/admin/tables', label: 'Stollar', icon: '🪑' },
    { to: '/admin/menu', label: 'Menyu boshqaruvi', icon: '📋' },
    { to: '/admin/staff', label: 'Xodimlar', icon: '👤' },
    { to: '/admin/reports', label: 'Kunlik hisobot', icon: '📈' },
    { to: '/admin/waiters', label: 'Ofitsiant KPI', icon: '👥' },
    { to: '/admin/settings', label: 'Sozlamalar', icon: '⚙️' },
    { to: '/cashier', label: 'Kassa', icon: '💰' },
  ]

  const highlightTables = tables.filter((t) => {
    const c = getDisplayCategory(t.status)
    return c === 'occupied' || c === 'awaiting_payment'
  })

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <header>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted text-sm">Real-time restoran holati</p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="pt-4">
              <p className="text-2xl">{kpi.icon}</p>
              <p className="text-sm text-muted mt-2">{kpi.label}</p>
              <p className="text-xl font-bold mt-1">{kpi.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Stollar holati</h2>
            <Link to="/admin/tables" className="text-sm text-brand-600 font-medium">Barchasi →</Link>
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            {(['empty', 'occupied', 'reserved', 'awaiting_payment'] as TableDisplayCategory[]).map((key) => (
              <Link
                key={key}
                to="/admin/tables"
                className="px-3 py-1.5 rounded-xl border border-border hover:bg-surface-2"
              >
                {DISPLAY_CATEGORY_META[key].emoji} {counts[key]} {DISPLAY_CATEGORY_META[key].label}
              </Link>
            ))}
          </div>
          {highlightTables.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {highlightTables.slice(0, 8).map((t) => (
                <Link
                  key={t.id}
                  to={`/admin/tables?table=${t.id}`}
                  className="text-xs px-2 py-1 rounded-lg bg-surface-2 border border-border hover:border-brand-500"
                >
                  Stol {t.number}
                  {t.order_total > 0 ? ` · ${formatCurrency(t.order_total)}` : ''}
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {quickLinks.map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="flex flex-col items-center gap-2 p-4 rounded-2xl border border-border bg-surface hover:shadow-md transition-shadow active:scale-[0.98]"
          >
            <span className="text-2xl">{link.icon}</span>
            <span className="text-xs font-medium text-center">{link.label}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
