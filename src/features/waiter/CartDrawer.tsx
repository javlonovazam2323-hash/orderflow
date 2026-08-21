import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDraftCartItems, sendToKitchen, upsertDraftCartItem } from '@/lib/api'
import { enqueue, isOnline } from '@/lib/offline/queue'
import { USE_MOCK } from '@/lib/supabase'
import { useCartStore } from '@/stores/cartStore'
import { getActiveRestaurantId } from '@/stores/tenantStore'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { formatCurrency, generateIdempotencyKey } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'

interface CartDrawerProps {
  open: boolean
  onClose: () => void
}

export function CartDrawer({ open, onClose }: CartDrawerProps) {
  const navigate = useNavigate()
  const { items, orderId, updateQuantity, updateNotes, clear, total } = useCartStore()
  const { refreshPending } = useOnlineStatus()
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [queued, setQueued] = useState(false)
  const [notesItem, setNotesItem] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')

  const persistDraft = async (menuItemId: string, quantity: number, notes: string) => {
    if (!orderId || USE_MOCK) return
    try {
      await upsertDraftCartItem(orderId, menuItemId, quantity, notes)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Savat saqlanmadi')
      useCartStore.getState().hydrateItems(await getDraftCartItems(orderId))
    }
  }

  const handleSend = async () => {
    if (!orderId || items.length === 0) return
    setSending(true)
    setError('')
    setQueued(false)

    const idempotencyKey = generateIdempotencyKey()
    const offline = !isOnline() && !USE_MOCK

    try {
      if (offline) {
        enqueue({
          id: crypto.randomUUID(),
          type: 'send_to_kitchen',
          idempotency_key: idempotencyKey,
          payload: { order_id: orderId, items: [...items], restaurant_id: getActiveRestaurantId() ?? undefined },
        })
        refreshPending()
        setQueued(true)
        clear()
        onClose()
        navigate('/waiter/orders')
        return
      }

      await sendToKitchen(orderId, items, idempotencyKey)
      clear()
      onClose()
      navigate('/waiter/orders')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xatolik yuz berdi')
    } finally {
      setSending(false)
    }
  }

  const openNotes = (menuItemId: string, current: string) => {
    setNotesItem(menuItemId)
    setNoteText(current)
  }

  const saveNotes = () => {
    if (notesItem) {
      updateNotes(notesItem, noteText)
      const row = useCartStore.getState().items.find((i) => i.menu_item_id === notesItem)
      void persistDraft(notesItem, row?.quantity ?? 0, noteText)
    }
    setNotesItem(null)
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="Savat">
        <div className="p-4 space-y-4">
          {items.length === 0 ? (
            <p className="text-center text-muted py-8">Savat bo'sh</p>
          ) : (
            <>
              <ul className="space-y-3">
                {items.map((item) => (
                  <li key={item.menu_item_id} className="flex gap-3 p-3 rounded-xl bg-surface-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold truncate">{item.menu_item.name}</p>
                      <p className="text-sm text-brand-600 font-medium">
                        {formatCurrency(item.menu_item.price * item.quantity)}
                      </p>
                      {item.notes && (
                        <p className="text-xs text-muted mt-1">📝 {item.notes}</p>
                      )}
                      <button
                        className="text-xs text-brand-600 mt-1"
                        onClick={() => openNotes(item.menu_item_id, item.notes)}
                      >
                        + Izoh
                      </button>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        className="h-9 w-9 rounded-lg bg-surface border border-border font-bold"
                        onClick={() => {
                          const next = item.quantity - 1
                          updateQuantity(item.menu_item_id, next)
                          void persistDraft(item.menu_item_id, next, item.notes)
                        }}
                      >
                        −
                      </button>
                      <span className="w-6 text-center font-bold">{item.quantity}</span>
                      <button
                        className="h-9 w-9 rounded-lg bg-brand-600 text-white font-bold"
                        onClick={() => {
                          const next = item.quantity + 1
                          updateQuantity(item.menu_item_id, next)
                          void persistDraft(item.menu_item_id, next, item.notes)
                        }}
                      >
                        +
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              <div className="flex justify-between items-center pt-2 border-t border-border">
                <span className="font-medium">Jami</span>
                <span className="text-xl font-bold text-brand-600">{formatCurrency(total())}</span>
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}
              {queued && (
                <p className="text-sm text-amber-600 text-center">
                  Internet qaytganida avtomatik yuboriladi
                </p>
              )}

              <Button size="xl" className="w-full" loading={sending} onClick={handleSend}>
                🍳 OSHXONAGA YUBORISH
              </Button>
            </>
          )}
        </div>
      </Modal>

      <Modal open={!!notesItem} onClose={() => setNotesItem(null)} title="Izoh qo'shish">
        <div className="p-4 space-y-4">
          <Input
            label="Izoh"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Masalan: piyozsiz, achchiq emas"
          />
          <Button className="w-full" onClick={saveNotes}>Saqlash</Button>
        </div>
      </Modal>
    </>
  )
}
