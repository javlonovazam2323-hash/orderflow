import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { addPayment, getOrder, getOrderItems, getPayments, getSettings, getTables } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { formatCurrency, formatDateTime, generateIdempotencyKey } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { ReceiptView } from './ReceiptView'
import { PAYMENT_METHOD_LABELS, type Order, type OrderItem, type Payment, type PaymentMethod, type RestaurantSettings } from '@/types/database'

const METHODS: PaymentMethod[] = ['cash', 'card', 'click', 'payme', 'other']

export function PaymentPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [order, setOrder] = useState<Order | null>(null)
  const [items, setItems] = useState<OrderItem[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [settings, setSettings] = useState<RestaurantSettings | null>(null)
  const [tableNumber, setTableNumber] = useState<number | null>(null)
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [showReceipt, setShowReceipt] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    if (!orderId) return
    const [o, i, p, s, tables] = await Promise.all([
      getOrder(orderId),
      getOrderItems(orderId),
      getPayments(orderId),
      getSettings(),
      getTables(),
    ])
    setOrder(o)
    setItems(i)
    setPayments(p)
    setSettings(s)
    if (o) {
      const t = tables.find((tb) => tb.id === o.table_id)
      setTableNumber(t?.number ?? null)
    }
    if (o?.status === 'paid') setShowReceipt(true)
  }, [orderId])

  useRealtimeRefresh(refresh, [refresh])

  const paid = useMemo(() => payments.reduce((s, p) => s + p.amount, 0), [payments])
  const remaining = order ? Math.max(0, order.total - paid) : 0

  const handleAddPayment = async () => {
    if (!orderId || !user) return
    const val = parseInt(amount.replace(/\D/g, ''), 10)
    if (!val || val <= 0) {
      setError('Summani kiriting')
      return
    }
    if (val > remaining) {
      setError(`Qolgan summa: ${formatCurrency(remaining)}`)
      return
    }
    setLoading(true)
    setError('')
    try {
      await addPayment(orderId, val, method, generateIdempotencyKey(), user.id)
      setAmount('')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xatolik')
    } finally {
      setLoading(false)
    }
  }

  const fillRemaining = () => setAmount(String(remaining))

  if (!order) {
    return <div className="p-6 text-center text-muted">Yuklanmoqda...</div>
  }

  if (showReceipt && order.status === 'paid') {
    return (
      <ReceiptView
        order={order}
        items={items}
        payments={payments}
        settings={settings}
        tableNumber={tableNumber}
        onClose={() => navigate('/cashier')}
      />
    )
  }

  return (
    <div className="min-h-full p-4 max-w-lg mx-auto space-y-4 pb-8">
      <button onClick={() => navigate('/cashier')} className="text-sm text-muted">← Kassa</button>

      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="flex justify-between">
            <div>
              <p className="font-bold text-lg">Stol {tableNumber} · № {order.order_number}</p>
              <p className="text-sm text-muted">{formatDateTime(order.opened_at)}</p>
            </div>
          </div>

          <ul className="divide-y divide-border text-sm">
            {items.filter((i) => i.status !== 'cancelled').map((item) => (
              <li key={item.id} className="flex justify-between py-2">
                <span>{item.menu_item?.name} × {item.quantity}</span>
                <span>{formatCurrency(item.total_price)}</span>
              </li>
            ))}
          </ul>

          <div className="space-y-1 pt-2 border-t border-border text-sm">
            <div className="flex justify-between"><span>Taomlar</span><span>{formatCurrency(order.subtotal)}</span></div>
            {order.service_charge > 0 && (
              <div className="flex justify-between text-muted">
                <span>Xizmat haqi</span><span>{formatCurrency(order.service_charge)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg pt-1">
              <span>Jami</span><span className="text-brand-600">{formatCurrency(order.total)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {payments.length > 0 && (
        <Card>
          <CardContent className="pt-4 space-y-2">
            <p className="font-medium">To'lovlar</p>
            {payments.map((p) => (
              <div key={p.id} className="flex justify-between text-sm">
                <span>{PAYMENT_METHOD_LABELS[p.method]}</span>
                <span>{formatCurrency(p.amount)}</span>
              </div>
            ))}
            <div className="flex justify-between font-semibold pt-2 border-t border-border">
              <span>To'langan</span>
              <span className="text-green-600">{formatCurrency(paid)}</span>
            </div>
            {remaining > 0 && (
              <div className="flex justify-between text-amber-600 font-semibold">
                <span>Qolgan</span>
                <span>{formatCurrency(remaining)}</span>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {remaining > 0 && (
        <Card>
          <CardContent className="pt-4 space-y-4">
            <p className="font-semibold">Split Payment — To'lov qo'shish</p>

            <div className="grid grid-cols-3 gap-2">
              {METHODS.map((m) => (
                <button
                  key={m}
                  onClick={() => setMethod(m)}
                  className={`py-2 px-2 rounded-xl text-xs font-medium border-2 transition-colors ${
                    method === m
                      ? 'border-brand-600 bg-brand-50 dark:bg-brand-900/20 text-brand-700'
                      : 'border-border'
                  }`}
                >
                  {PAYMENT_METHOD_LABELS[m]}
                </button>
              ))}
            </div>

            <Input
              label="Summa (so'm)"
              type="number"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={String(remaining)}
            />

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={fillRemaining}>
                Qolganini to'ldirish
              </Button>
              <Button className="flex-1" loading={loading} onClick={handleAddPayment}>
                To'lov qo'shish
              </Button>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <p className="text-xs text-muted text-center">
              Jami to'lov hisob summasiga teng bo'lguncha hisob yopilmaydi
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
