import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { openTableOrder } from '@/lib/api'
import { getTableSummaries } from '@/lib/api/tables'
import { useAuth } from '@/hooks/useAuth'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { useCartStore } from '@/stores/cartStore'
import { Badge } from '@/components/ui/Badge'
import { cn, formatCurrency } from '@/lib/format'
import {
  DISPLAY_CATEGORY_META,
  formatElapsed,
  getDisplayCategory,
} from '@/lib/tables/status'
import { TABLE_STATUS_COLORS, TABLE_STATUS_LABELS, type TableSummary } from '@/types/database'

export function TablesPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [tables, setTables] = useState<TableSummary[]>([])
  const [loading, setLoading] = useState<string | null>(null)
  const setContext = useCartStore((s) => s.setContext)

  const refresh = useCallback(async () => {
    setTables(await getTableSummaries(true))
  }, [])

  useRealtimeRefresh(refresh, [refresh])

  const sorted = useMemo(
    () => [...tables].sort((a, b) => a.number - b.number),
    [tables],
  )

  const handleTableClick = async (table: TableSummary) => {
    if (!user) return
    if (table.status === 'cleaning') return

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
        <p className="text-sm text-muted">Bo‘sh yoki bron stolni tanlang — zakaz oching</p>
      </header>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {sorted.map((table) => {
          const cat = getDisplayCategory(table.status)
          const meta = DISPLAY_CATEGORY_META[cat]
          const disabled = table.status === 'cleaning'
          const label = table.name ?? String(table.number)
          const calling = table.pending_guest_call_action
            && table.pending_guest_call_waiter_id === user?.id

          return (
            <button
              key={table.id}
              type="button"
              onClick={() => handleTableClick(table)}
              disabled={disabled || loading === table.id}
              className={cn(
                'relative rounded-2xl border-2 flex flex-col items-start p-3 text-left gap-1 min-h-[100px]',
                'transition-all active:scale-95 hover:shadow-md',
                disabled && 'opacity-50 cursor-not-allowed',
                calling
                  ? 'border-red-500 bg-red-50 dark:bg-red-950/40 animate-pulse'
                  : cat === 'empty' ? 'border-slate-200 dark:border-slate-700 bg-surface hover:border-brand-500' : meta.color,
                loading === table.id && 'opacity-60',
              )}
            >
              <div className="flex w-full items-center justify-between">
                <span className="text-xl font-bold">{label}</span>
                <span>{calling ? '🔔' : meta.emoji}</span>
              </div>
              <Badge className={cn('text-[10px] px-1.5', TABLE_STATUS_COLORS[table.status] ?? meta.badge)}>
                {TABLE_STATUS_LABELS[table.status] ?? meta.label}
              </Badge>

              {cat === 'reserved' && table.reservation_name && (
                <p className="text-[10px] text-muted mt-1">{table.reservation_name}</p>
              )}

              {table.order_total > 0 && (
                <p className="text-xs font-semibold mt-auto">{formatCurrency(table.order_total)}</p>
              )}
              {table.opened_at && cat !== 'empty' && (
                <p className="text-[10px] text-muted font-mono">{formatElapsed(table.opened_at)}</p>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
