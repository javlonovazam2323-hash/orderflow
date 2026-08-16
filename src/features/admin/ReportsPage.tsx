import { useCallback, useEffect, useState } from 'react'
import { getDailyReport } from '@/lib/api/admin'
import { formatCurrency } from '@/lib/format'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import type { DailyReport } from '@/types/database'

export function ReportsPage() {
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [report, setReport] = useState<DailyReport | null>(null)

  const load = useCallback(async () => {
    setReport(await getDailyReport(date))
  }, [date])

  useEffect(() => { load() }, [load])

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      <header>
        <h1 className="text-2xl font-bold">Kunlik hisobot</h1>
        <p className="text-sm text-muted">Sotuv va to'lovlar tahlili</p>
      </header>

      <div className="flex gap-3 items-end">
        <Input
          label="Sana"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <button
          onClick={load}
          className="h-12 px-5 rounded-xl bg-brand-600 text-white font-medium shrink-0"
        >
          Ko'rsatish
        </button>
      </div>

      {report && (
        <>
          <Card className="bg-gradient-to-br from-brand-600 to-brand-700 text-white border-0">
            <CardContent className="pt-5">
              <p className="text-brand-100 text-sm">Jami sotuv</p>
              <p className="text-4xl font-black">{formatCurrency(report.total_sales)}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 text-sm">
                <div><p className="text-brand-100">Hisoblar</p><p className="font-bold text-lg">{report.order_count}</p></div>
                <div><p className="text-brand-100">O'rtacha chek</p><p className="font-bold text-lg">{formatCurrency(report.average_check)}</p></div>
                <div><p className="text-brand-100">Naqd</p><p className="font-bold">{formatCurrency(report.cash_total)}</p></div>
                <div><p className="text-brand-100">Karta</p><p className="font-bold">{formatCurrency(report.card_total)}</p></div>
              </div>
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><h2 className="font-semibold">To'lov turlari</h2></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Naqd" value={report.cash_total} />
                <Row label="Karta" value={report.card_total} />
                <Row label="Online (Click + Payme)" value={report.online_total} />
                <Row label="Boshqa" value={report.other_total} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><h2 className="font-semibold">Eng ko'p sotilgan</h2></CardHeader>
              <CardContent>
                {report.top_dish ? (
                  <p className="text-lg font-bold">{report.top_dish.name} <span className="text-muted font-normal">× {report.top_dish.quantity}</span></p>
                ) : (
                  <p className="text-muted">Ma'lumot yo'q</p>
                )}
              </CardContent>
            </Card>
          </div>

          {report.waiter_sales.length > 0 && (
            <Card>
              <CardHeader><h2 className="font-semibold">Ofitsiantlar bo'yicha sotuv</h2></CardHeader>
              <CardContent className="space-y-2">
                {report.waiter_sales.map((w) => (
                  <div key={w.waiter_id} className="flex justify-between items-center py-2 border-b border-border last:border-0">
                    <div>
                      <p className="font-medium">{w.waiter_name}</p>
                      <p className="text-xs text-muted">{w.order_count} ta hisob</p>
                    </div>
                    <p className="font-bold text-brand-600">{formatCurrency(w.total)}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{formatCurrency(value)}</span>
    </div>
  )
}
