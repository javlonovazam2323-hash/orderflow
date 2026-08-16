import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getTables, openTableOrder } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { useCartStore } from '@/stores/cartStore'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/format'
import { TABLE_STATUS_COLORS, TABLE_STATUS_LABELS, type RestaurantTable } from '@/types/database'

export function TablesPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [tables, setTables] = useState<RestaurantTable[]>([])
  const [loading, setLoading] = useState<string | null>(null)
  const setContext = useCartStore((s) => s.setContext)

  const refresh = useCallback(async () => {
    setTables(await getTables())
  }, [])

  useRealtimeRefresh(refresh, [refresh])

  const handleTableClick = async (table: RestaurantTable) => {
    if (!user) return
    setLoading(table.id)
    try {
      const orderId = await openTableOrder(table.id, user.id)
      setContext(table.id, orderId)
      navigate(`/waiter/menu/${table.id}`)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="p-4 space-y-4">
      <header>
        <h1 className="text-2xl font-bold">Stollar</h1>
        <p className="text-sm text-muted">Stol tanlang va buyurtma boshlang</p>
      </header>

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
        {tables.map((table) => (
          <button
            key={table.id}
            onClick={() => handleTableClick(table)}
            disabled={loading === table.id}
            className={cn(
              'relative aspect-square rounded-2xl border-2 flex flex-col items-center justify-center gap-1',
              'transition-all active:scale-95 hover:shadow-md',
              table.status === 'empty'
                ? 'border-slate-200 dark:border-slate-700 bg-surface hover:border-brand-500'
                : 'border-transparent',
              loading === table.id && 'opacity-60',
            )}
          >
            <span className="text-2xl font-bold">{table.number}</span>
            <Badge className={cn('text-[10px] px-1.5', TABLE_STATUS_COLORS[table.status])}>
              {TABLE_STATUS_LABELS[table.status]}
            </Badge>
          </button>
        ))}
      </div>
    </div>
  )
}
