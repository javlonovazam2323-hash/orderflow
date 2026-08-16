import { Link } from 'react-router-dom'
import { useCallback, useState } from 'react'
import { getCashSession, getKitchenTickets, getOpenOrders, getTables } from '@/lib/api'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { formatCurrency } from '@/lib/format'
import { Card, CardContent } from '@/components/ui/Card'
import type { CashSessionSummary } from '@/types/database'

export function DashboardPage() {
  const [session, setSession] = useState<CashSessionSummary | null>(null)
  const [stats, setStats] = useState({ occupied: 0, openOrders: 0, kitchenActive: 0, ready: 0 })

  const refresh = useCallback(async () => {
    const [cash, tables, orders, tickets] = await Promise.all([
      getCashSession(),
      getTables(),
      getOpenOrders(),
      getKitchenTickets(),
    ])
    setSession(cash)
    setStats({
      occupied: tables.filter((t) => t.status !== 'empty').length,
      openOrders: orders.length,
      kitchenActive: tickets.filter((t) => !['ready', 'cancelled'].includes(t.status)).length,
      ready: tickets.filter((t) => t.status === 'ready').length,
    })
  }, [])

  useRealtimeRefresh(refresh, [refresh])

  const kpis = [
    { label: 'Bugungi savdo', value: formatCurrency(session?.total_revenue ?? 0), icon: '💰' },
    { label: 'Band stollar', value: String(stats.occupied), icon: '🪑' },
    { label: 'Ochiq hisoblar', value: String(stats.openOrders), icon: '📋' },
    { label: 'Oshxona aktiv', value: String(stats.kitchenActive), icon: '🍳' },
    { label: 'Tayyor', value: String(stats.ready), icon: '✅' },
    { label: 'Hisoblar soni', value: String(session?.order_count ?? 0), icon: '🧾' },
  ]

  const quickLinks = [
    { to: '/admin/menu', label: 'Menyu boshqaruvi', icon: '📋' },
    { to: '/admin/staff', label: 'Xodimlar', icon: '👤' },
    { to: '/admin/reports', label: 'Kunlik hisobot', icon: '📈' },
    { to: '/admin/waiters', label: 'Ofitsiant KPI', icon: '👥' },
    { to: '/admin/settings', label: 'Sozlamalar', icon: '⚙️' },
    { to: '/cashier', label: 'Kassa', icon: '💰' },
  ]

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

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
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
