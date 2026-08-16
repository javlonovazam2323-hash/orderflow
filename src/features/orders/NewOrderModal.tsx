import { useCallback, useMemo, useState } from 'react'
import { getMenuItems } from '@/lib/api'
import { createPhoneOrder } from '@/lib/api/orders'
import { formatCurrency } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { MenuItemCard } from '@/components/menu/MenuItemCard'
import {
  ORDER_TYPE_ICONS,
  PAYMENT_METHOD_LABELS,
  type CreatePhoneOrderInput,
  type MenuItem,
  type OrderType,
  type PaymentMethod,
} from '@/types/database'

type RemoteOrderType = 'pickup' | 'delivery'

interface CartLine {
  menu_item: MenuItem
  quantity: number
  notes: string
}

interface NewOrderModalProps {
  onClose: () => void
  onCreated: () => void
}

export function NewOrderModal({ onClose, onCreated }: NewOrderModalProps) {
  const [step, setStep] = useState<'type' | 'details' | 'menu'>('type')
  const [orderType, setOrderType] = useState<RemoteOrderType>('pickup')
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [cart, setCart] = useState<CartLine[]>([])
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [notes, setNotes] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [deliveryLandmark, setDeliveryLandmark] = useState('')
  const [deliveryFee, setDeliveryFee] = useState('15000')
  const [discount, setDiscount] = useState('0')
  const [readyTime, setReadyTime] = useState('')
  const [deliveryTime, setDeliveryTime] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [prepay, setPrepay] = useState('0')

  const loadMenu = useCallback(async () => {
    setMenuItems(await getMenuItems())
  }, [])

  const subtotal = cart.reduce((s, c) => s + c.menu_item.price * c.quantity, 0)
  const fee = orderType === 'delivery' ? parseInt(deliveryFee, 10) || 0 : 0
  const disc = parseInt(discount, 10) || 0
  const total = Math.max(subtotal + fee - disc, 0)
  const prepayNum = parseInt(prepay, 10) || 0
  const balance = Math.max(total - prepayNum, 0)

  const filteredMenu = useMemo(() => {
    if (!search.trim()) return menuItems
    const q = search.toLowerCase()
    return menuItems.filter((m) => m.name.toLowerCase().includes(q))
  }, [menuItems, search])

  const addToCart = (item: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.menu_item.id === item.id)
      if (existing) {
        return prev.map((c) =>
          c.menu_item.id === item.id ? { ...c, quantity: c.quantity + 1 } : c,
        )
      }
      return [...prev, { menu_item: item, quantity: 1, notes: '' }]
    })
  }

  const handleSubmit = async () => {
    if (!customerName.trim() || !customerPhone.trim()) {
      setError('Mijoz ismi va telefon majburiy')
      return
    }
    if (cart.length === 0) {
      setError('Kamida bitta mahsulot tanlang')
      return
    }
    if (orderType === 'delivery' && !deliveryAddress.trim()) {
      setError('Yetkazish manzili majburiy')
      return
    }

    setSaving(true)
    setError('')
    try {
      const input: CreatePhoneOrderInput = {
        order_type: orderType,
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim(),
        items: cart.map((c) => ({
          menu_item_id: c.menu_item.id,
          quantity: c.quantity,
          notes: c.notes || null,
        })),
        notes: notes || null,
        delivery_address: orderType === 'delivery' ? deliveryAddress.trim() : null,
        delivery_landmark: orderType === 'delivery' ? deliveryLandmark.trim() || null : null,
        delivery_fee: fee,
        discount_amount: disc,
        payment_method: prepayNum > 0 ? paymentMethod : null,
        prepayment_amount: prepayNum,
        scheduled_ready_at: readyTime ? new Date(readyTime).toISOString() : null,
        scheduled_delivery_at: deliveryTime ? new Date(deliveryTime).toISOString() : null,
        idempotency_key: crypto.randomUUID(),
      }
      await createPhoneOrder(input)
      onCreated()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xatolik yuz berdi')
    } finally {
      setSaving(false)
    }
  }

  const selectType = (t: RemoteOrderType) => {
    setOrderType(t)
    setStep('details')
  }

  const goMenu = async () => {
    if (!customerName.trim() || !customerPhone.trim()) {
      setError('Mijoz ismi va telefon majburiy')
      return
    }
    if (orderType === 'delivery' && !deliveryAddress.trim()) {
      setError('Yetkazish manzili majburiy')
      return
    }
    setError('')
    await loadMenu()
    setStep('menu')
  }

  return (
    <Modal open onClose={onClose} title="+ Yangi zakaz" className="max-w-2xl">
      {step === 'type' && (
        <div className="p-5 space-y-4">
          <p className="text-muted text-sm">Zakaz turini tanlang</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(['pickup', 'delivery'] as RemoteOrderType[]).map((t) => (
              <button
                key={t}
                onClick={() => selectType(t)}
                className="rounded-2xl border-2 border-border p-6 text-left hover:border-brand-500 hover:bg-brand-500/5 transition-all active:scale-[0.98]"
              >
                <span className="text-3xl">{ORDER_TYPE_ICONS[t as OrderType]}</span>
                <p className="font-bold text-lg mt-2">{t === 'pickup' ? 'Olib ketish' : 'Dostavka'}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 'details' && (
        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          <BadgeType type={orderType} />
          <Input label="Mijoz ismi" value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
          <Input label="Telefon" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="+998..." required />
          {orderType === 'delivery' && (
            <>
              <Input label="Yetkazish manzili" value={deliveryAddress} onChange={(e) => setDeliveryAddress(e.target.value)} required />
              <Input label="Orientir" value={deliveryLandmark} onChange={(e) => setDeliveryLandmark(e.target.value)} />
              <Input label="Dostavka narxi" type="number" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} />
              <Input label="Yetkazish vaqti" type="datetime-local" value={deliveryTime} onChange={(e) => setDeliveryTime(e.target.value)} />
            </>
          )}
          {orderType === 'pickup' && (
            <Input label="Tayyor bo'lish vaqti" type="datetime-local" value={readyTime} onChange={(e) => setReadyTime(e.target.value)} />
          )}
          <Input label="Izoh" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <Input label="Chegirma (so'm)" type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">To'lov turi (oldindan)</span>
            <select
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              className="w-full h-12 px-4 rounded-xl border border-border bg-surface"
            >
              {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
              ))}
            </select>
          </label>
          <Input label="Oldindan to'langan" type="number" value={prepay} onChange={(e) => setPrepay(e.target.value)} />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => setStep('type')}>Orqaga</Button>
            <Button className="flex-1" onClick={goMenu}>Mahsulotlar →</Button>
          </div>
        </div>
      )}

      {step === 'menu' && (
        <div className="flex flex-col max-h-[80vh]">
          <div className="p-4 border-b border-border space-y-3">
            <input
              type="search"
              placeholder="Mahsulot qidirish..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-11 px-4 rounded-xl border border-border bg-surface"
            />
            {cart.length > 0 && (
              <div className="rounded-xl bg-surface-2 p-3 text-sm space-y-1">
                {cart.map((c) => (
                  <div key={c.menu_item.id} className="flex justify-between items-center gap-2">
                    <span>{c.quantity}× {c.menu_item.name}</span>
                    <div className="flex items-center gap-2">
                      <button
                        className="h-8 w-8 rounded-lg bg-surface border"
                        onClick={() => setCart((p) => p.map((x) => x.menu_item.id === c.menu_item.id ? { ...x, quantity: Math.max(1, x.quantity - 1) } : x))}
                      >−</button>
                      <button
                        className="h-8 w-8 rounded-lg bg-surface border"
                        onClick={() => setCart((p) => p.map((x) => x.menu_item.id === c.menu_item.id ? { ...x, quantity: x.quantity + 1 } : x))}
                      >+</button>
                    </div>
                  </div>
                ))}
                <div className="pt-2 border-t border-border font-semibold flex justify-between">
                  <span>Jami</span>
                  <span>{formatCurrency(total)} · Qoldiq: {formatCurrency(balance)}</span>
                </div>
              </div>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {filteredMenu.map((item) => (
              <MenuItemCard key={item.id} item={item} onAdd={addToCart} showAdd />
            ))}
          </div>
          <div className="p-4 border-t border-border space-y-2">
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep('details')}>Orqaga</Button>
              <Button className="flex-1" size="lg" loading={saving} onClick={handleSubmit}>
                Oshxonaga yuborish
              </Button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

function BadgeType({ type }: { type: RemoteOrderType }) {
  return (
    <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-brand-500/10 text-brand-600 text-sm font-semibold">
      {ORDER_TYPE_ICONS[type]} {type === 'pickup' ? 'Olib ketish' : 'Dostavka'}
    </span>
  )
}
