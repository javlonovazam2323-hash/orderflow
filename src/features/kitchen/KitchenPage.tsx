import { useCallback, useState } from 'react'
import { getKitchenTickets, updateKitchenStatus } from '@/lib/api'
import { useAuth } from '@/hooks/useAuth'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { elapsedMinutes, formatTime } from '@/lib/format'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { KITCHEN_STATUS_LABELS, type KitchenTicket } from '@/types/database'

const STATUS_ACTIONS: Record<string, { next: KitchenTicket['status']; label: string } | null> = {
  new: { next: 'accepted', label: 'Qabul qilish' },
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

export function KitchenPage() {
  const { signOut } = useAuth()
  const [tickets, setTickets] = useState<KitchenTicket[]>([])
  const [updating, setUpdating] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setTickets(await getKitchenTickets())
  }, [])

  useRealtimeRefresh(refresh, [refresh])

  const handleStatus = async (ticketId: string, status: KitchenTicket['status']) => {
    setUpdating(ticketId)
    try {
      await updateKitchenStatus(ticketId, status)
      await refresh()
    } finally {
      setUpdating(null)
    }
  }

  const active = tickets.filter((t) => t.status !== 'ready')
  const ready = tickets.filter((t) => t.status === 'ready')

  return (
    <div className="min-h-full bg-slate-100 dark:bg-slate-900">
      <header className="sticky top-0 z-10 bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">🍳 Oshxona</h1>
          <p className="text-slate-400 text-sm">{active.length} aktiv · {ready.length} tayyor</p>
        </div>
        <Button variant="ghost" size="sm" className="text-white" onClick={() => signOut()}>
          Chiqish
        </Button>
      </header>

      <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
        {tickets.map((ticket) => {
          const action = STATUS_ACTIONS[ticket.status]
          const elapsed = elapsedMinutes(ticket.sent_at)

          return (
            <Card
              key={ticket.id}
              className={`border-l-4 ${STATUS_COLORS[ticket.status] ?? ''}`}
            >
              <CardContent className="pt-4 space-y-3">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-3xl font-black">Stol {ticket.table?.number}</p>
                    <p className="text-sm text-muted">#{ticket.ticket_number} · {formatTime(ticket.sent_at)}</p>
                    <p className="text-sm">{ticket.waiter?.full_name}</p>
                  </div>
                  <div className="text-right">
                    <Badge className={
                      ticket.status === 'new' ? 'bg-red-500 text-white animate-pulse' :
                      ticket.status === 'ready' ? 'bg-green-500 text-white' :
                      'bg-amber-500 text-white'
                    }>
                      {KITCHEN_STATUS_LABELS[ticket.status]}
                    </Badge>
                    <p className="text-xs text-muted mt-1">{elapsed} daq</p>
                  </div>
                </div>

                <ul className="space-y-2">
                  {ticket.items?.map((item) => (
                    <li key={item.id} className="flex justify-between text-sm border-b border-border pb-2">
                      <div>
                        <span className="font-bold text-base">{item.quantity}×</span>{' '}
                        {item.menu_item?.name}
                        {item.notes && (
                          <p className="text-amber-600 text-xs mt-0.5">⚠ {item.notes}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>

                {action && (
                  <Button
                    size="lg"
                    className="w-full"
                    loading={updating === ticket.id}
                    variant={ticket.status === 'in_progress' ? 'primary' : 'secondary'}
                    onClick={() => handleStatus(ticket.id, action.next)}
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
