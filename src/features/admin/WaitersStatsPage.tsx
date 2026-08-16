import { useCallback, useEffect, useState } from 'react'
import { getWaiterStats } from '@/lib/api/admin'
import { formatCurrency } from '@/lib/format'
import { Card, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import type { WaiterStats } from '@/types/database'

export function WaitersStatsPage() {
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [stats, setStats] = useState<WaiterStats[]>([])

  const load = useCallback(async () => {
    setStats(await getWaiterStats(date))
  }, [date])

  useEffect(() => { load() }, [load])

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      <header>
        <h1 className="text-2xl font-bold">Ofitsiant statistikasi</h1>
        <p className="text-sm text-muted">KPI va bonus tizimi uchun tayyor</p>
      </header>

      <div className="flex gap-3 items-end">
        <Input label="Sana" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <button onClick={load} className="h-12 px-5 rounded-xl bg-brand-600 text-white font-medium shrink-0">
          Ko'rsatish
        </button>
      </div>

      <div className="space-y-3">
        {stats.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-muted">Bu kun uchun ma'lumot yo'q</CardContent></Card>
        ) : (
          stats.map((w, i) => (
            <Card key={w.waiter_id}>
              <CardContent className="pt-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-black text-muted w-8">#{i + 1}</span>
                    <div>
                      <p className="font-bold text-lg">{w.waiter_name}</p>
                      <p className="text-sm text-muted">Bugun: {w.order_count} ta stol</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-xl font-bold text-brand-600">{formatCurrency(w.total_sales)}</p>
                    <p className="text-xs text-muted">O'rtacha: {formatCurrency(w.average_check)}</p>
                  </div>
                </div>
                <div className="mt-3 h-2 rounded-full bg-surface-2 overflow-hidden">
                  <div
                    className="h-full bg-brand-600 rounded-full transition-all"
                    style={{ width: `${Math.min(100, (w.total_sales / (stats[0]?.total_sales || 1)) * 100)}%` }}
                  />
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
