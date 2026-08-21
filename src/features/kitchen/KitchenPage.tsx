import { useCallback, useState } from 'react'
import { getKitchenTickets, updateKitchenStatus } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { RestaurantSwitcher } from '@/components/layout/RestaurantSwitcher'
import { elapsedMinutes, formatTime } from '@/lib/format'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import {
  KITCHEN_STATUS_LABELS,
  ORDER_TYPE_ICONS,
  ORDER_TYPE_LABELS,
  type KitchenTicket,
  type OrderType,
} from '@/types/database'

const STATUS_ACTIONS: Record<string, { next: KitchenTicket['status']; label: string } | null> = {
  new: { next: 'accepted', label: 'QABUL QILDIM' },
  accepted: { next: 'in_progress', label: 'Jarayonda' },
  in_progress: { next: 'ready', label: 'TAYYOR' },
  ready: null,
}

const STATUS_COLORS: Record<string, string> = {
  new: 'border-red-500 bg-red-50 dark:bg-red-950/30',
  accepted: 'border-amber-500 bg-amber-50 dark:bg-amber-950/30',
  in_progress: 'border-orange-500 bg-orange-50 dark:bg-orange-950/30',
  ready: 'border-green-500 bg-green-50 dark:bg-green-950/30',
}

function ticketTitle(ticket: KitchenTicket): string {
  const orderType = (ticket.order?.order_type ?? ticket.order_type ?? 'dine_in') as OrderType
  if (orderType === 'dine_in' && ticket.table?.number) {
    return `Stol ${ticket.table.number}`
  }
  return ticket.order?.order_number ?? `#${ticket.ticket_number}`
}

function ticketSubtitle(ticket: KitchenTicket): string {
  const orderType = (ticket.order?.order_type ?? ticket.order_type ?? 'dine_in') as OrderType
  if (orderType !== 'dine_in') {
    const name = ticket.order?.customer_name ?? 'Mijoz'
    const phone = ticket.order?.customer_phone ?? ''
    return `${ORDER_TYPE_ICONS[orderType]} ${ORDER_TYPE_LABELS[orderType].toUpperCase()} · ${name}${phone ? ` · ${phone}` : ''}`
  }
  return ticket.waiter?.full_name ?? ''
}

function waitElapsed(sentAt: string, acceptedAt: string | null): string {
  if (!acceptedAt) return `${elapsedMinutes(sentAt)} daq`
  const mins = Math.floor((Date.now() - new Date(acceptedAt).getTime()) / 60000)
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}

export function KitchenPage() {
  const { signOut } = useAuth()
  const [tickets, setTickets] = useState<KitchenTicket[]>([])
  const [updating, setUpdating] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setTickets(await getKitchenTickets())
  }, [])

  useRealtimeRefresh(refresh, [refresh])

  const active = tickets.filter((t) => t.status !== 'ready')
  const ready = tickets.filter((t) => t.status === 'ready')

  return (
    <div className="min-h-full bg-slate-100 dark:bg-slate-900">
      <header className="sticky top-0 z-10 bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">🍳 Oshxona</h1>
          <p className="text-slate-400 text-sm">{active.length} aktiv · {ready.length} tayyor</p>
        </div>
        <div className="flex items-center gap-2">
          <RestaurantSwitcher className="text-slate-900" />
          <Button variant="ghost" size="sm" className="text-white" onClick={() => signOut()}>
            Chiqish
          </Button>
        </div>
      </header>

      <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
        {tickets.map((ticket) => {
          const action = STATUS_ACTIONS[ticket.status]
          const orderType = (ticket.order?.order_type ?? ticket.order_type ?? 'dine_in') as OrderType
          const isPhone = orderType !== 'dine_in'

          return (
            <Card
              key={ticket.id}
              className={`border-l-4 ${STATUS_COLORS[ticket.status] ?? ''}`}
            >
              <CardContent className="pt-4 space-y-3">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <p className="text-2xl font-black truncate">{ticketTitle(ticket)}</p>
                    <p className="text-sm font-semibold text-brand-600 dark:text-brand-400 mt-0.5">
                      {ticketSubtitle(ticket)}
                    </p>
                    <p className="text-xs text-muted mt-1">
                      Qabul: {formatTime(ticket.sent_at)}
                      {ticket.accepted_at && ` · Kutish: ${waitElapsed(ticket.sent_at, ticket.accepted_at)}`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <Badge className={
                      ticket.status === 'new' ? 'bg-red-500 text-white animate-pulse' :
                      ticket.status === 'ready' ? 'bg-green-500 text-white' :
                      'bg-amber-500 text-white'
                    }>
                      {KITCHEN_STATUS_LABELS[ticket.status]}
                    </Badge>
                  </div>
                </div>

                <ul className="space-y-2">
                  {ticket.items?.map((item) => (
                    <li key={item.id} className="text-sm border-b border-border pb-2">
                      <span className="font-bold text-base">{item.quantity}×</span>{' '}
                      {item.menu_item?.name}
                      {item.notes && (
                        <p className="text-amber-600 text-xs mt-0.5 bg-amber-500/10 rounded px-2 py-1 inline-block">
                          Izoh: {item.notes}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>

                {isPhone && ticket.order?.notes && (
                  <p className="text-xs text-muted border-t border-border pt-2">
                    Umumiy izoh: {ticket.order.notes}
                  </p>
                )}

                {action && (
                  <Button
                    size="lg"
                    className="w-full"
                    loading={updating === ticket.id}
                    variant={ticket.status === 'in_progress' ? 'primary' : 'secondary'}
                    onClick={() => {
                      setUpdating(ticket.id)
                      updateKitchenStatus(ticket.id, action.next)
                        .then(refresh)
                        .finally(() => setUpdating(null))
                    }}
                  >
                    {action.label}
                  </Button>
                )}
              </CardContent>
            </Card>
          )
        })}

        {tickets.length === 0 && (
          <div className="col-span-full text-center py-20 text-muted text-xl">
            Buyurtmalar kutilmoqda...
          </div>
        )}
      </div>
    </div>
  )
}
