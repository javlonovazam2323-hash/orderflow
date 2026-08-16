import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  cancelReservation,
  checkInReservation,
  createReservation,
  getTableOrderItems,
  getTableSummaries,
  setTableAvailable,
  setTableCleaning,
  upsertTable,
} from '@/lib/api/tables'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import {
  DISPLAY_CATEGORY_META,
  TABLE_ZONES,
  countByCategory,
  formatElapsed,
  formatTime,
  getDisplayCategory,
  ORDER_ITEM_STATUS_LABELS,
  type TableDisplayCategory,
  type TableFilterCategory,
} from '@/lib/tables/status'
import { formatCurrency, cn } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import type { OrderItem, TableReservationInput, TableSummary, TableUpsertInput } from '@/types/database'

const STATUS_FILTERS: { id: TableFilterCategory; label: string }[] = [
  { id: 'all', label: 'Barchasi' },
  { id: 'empty', label: 'Bo\'sh' },
  { id: 'occupied', label: 'Band' },
  { id: 'reserved', label: 'Bron' },
  { id: 'awaiting_payment', label: 'Hisob' },
  { id: 'cleaning', label: 'Tozalash' },
]

export function TablesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [tables, setTables] = useState<TableSummary[]>([])
  const [zoneFilter, setZoneFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<TableFilterCategory>('all')
  const [selected, setSelected] = useState<TableSummary | null>(null)
  const [detailItems, setDetailItems] = useState<OrderItem[]>([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [showReserve, setShowReserve] = useState(false)
  const [showAddTable, setShowAddTable] = useState(false)
  const [editTable, setEditTable] = useState<TableSummary | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const detailLoadRef = useRef(0)

  const refresh = useCallback(async () => {
    setTables(await getTableSummaries(true))
  }, [])

  useRealtimeRefresh(refresh, [refresh])

  const loadDetail = useCallback(async (table: TableSummary) => {
    const requestId = ++detailLoadRef.current
    setSelected(table)
    setDetailLoading(true)

    try {
      const fresh = (await getTableSummaries()).find((t) => t.id === table.id) ?? table
      if (requestId !== detailLoadRef.current) return

      setSelected(fresh)
      if (!fresh.current_order_id) {
        setDetailItems([])
        return
      }

      const items = await getTableOrderItems(fresh.current_order_id)
      if (requestId !== detailLoadRef.current) return
      setDetailItems(items)
    } catch {
      if (requestId !== detailLoadRef.current) return
      setDetailItems([])
    } finally {
      if (requestId === detailLoadRef.current) setDetailLoading(false)
    }
  }, [])

  const closeDetail = useCallback(() => {
    detailLoadRef.current += 1
    setSelected(null)
    setDetailItems([])
    setDetailLoading(false)
    if (searchParams.has('table')) {
      const next = new URLSearchParams(searchParams)
      next.delete('table')
      setSearchParams(next, { replace: true })
    }
  }, [searchParams, setSearchParams])

  useEffect(() => {
    const tableId = searchParams.get('table')
    if (!tableId || tables.length === 0) return
    // Qo‘lda boshqa stol tanlangan bo‘lsa, URL dagi stolni ustiga yozma
    if (selected && selected.id !== tableId) return
    const table = tables.find((t) => t.id === tableId)
    if (!table || selected?.id === tableId) return
    void loadDetail(table)
  }, [searchParams, tables, loadDetail, selected?.id])

  const zones = useMemo(() => {
    const set = new Set(tables.map((t) => t.zone ?? 'Asosiy zal'))
    TABLE_ZONES.forEach((z) => set.add(z))
    return ['all', ...Array.from(set).sort()]
  }, [tables])

  const counts = useMemo(() => countByCategory(tables), [tables])

  const filtered = useMemo(() => {
    return tables.filter((t) => {
      if (zoneFilter !== 'all' && (t.zone ?? 'Asosiy zal') !== zoneFilter) return false
      if (statusFilter !== 'all' && getDisplayCategory(t.status) !== statusFilter) return false
      return true
    })
  }, [tables, zoneFilter, statusFilter])

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-6xl mx-auto">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Stollar</h1>
          <p className="text-sm text-muted">Real-time stol holati va boshqaruv</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => { setShowReserve(true); setError('') }}>
            + Bron qilish
          </Button>
          <Button onClick={() => { setEditTable(null); setShowAddTable(true); setError('') }}>
            + Stol qo&apos;shish
          </Button>
        </div>
      </header>

      {/* KPI */}
      <Card>
        <CardContent className="pt-4">
          <p className="text-sm font-medium mb-3">
            Jami stollar: <span className="font-bold">{counts.total}</span>
          </p>
          <div className="flex flex-wrap gap-3 text-sm">
            {(Object.keys(DISPLAY_CATEGORY_META) as TableDisplayCategory[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setStatusFilter(key)}
                className={cn(
                  'px-3 py-1.5 rounded-xl border transition-colors',
                  statusFilter === key ? 'border-brand-600 bg-brand-50 dark:bg-brand-900/20' : 'border-border',
                )}
              >
                {DISPLAY_CATEGORY_META[key].emoji} {DISPLAY_CATEGORY_META[key].label}:{' '}
                <span className="font-bold">{counts[key]}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <div className="flex flex-wrap gap-1">
          {zones.map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => setZoneFilter(z)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm border',
                zoneFilter === z ? 'bg-brand-600 text-white border-brand-600' : 'border-border',
              )}
            >
              {z === 'all' ? 'Barchasi' : z}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setStatusFilter(f.id)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-sm border',
              statusFilter === f.id ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'border-border',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {filtered.map((table) => (
          <TableCard key={table.id} table={table} onClick={() => loadDetail(table)} />
        ))}
      </div>

      {selected && (
        <TableDetailModal
          table={selected}
          items={detailItems}
          loading={detailLoading}
          onClose={closeDetail}
          onRefresh={() => selected && loadDetail(selected)}
          onEdit={() => { setEditTable(selected); setShowAddTable(true) }}
          onCleaning={async () => {
            setSaving(true)
            try {
              await setTableCleaning(selected.id)
              await refresh()
              if (selected) await loadDetail(selected)
            } finally { setSaving(false) }
          }}
          onAvailable={async () => {
            setSaving(true)
            try {
              await setTableAvailable(selected.id)
              await refresh()
              if (selected) await loadDetail(selected)
            } finally { setSaving(false) }
          }}
          onCheckIn={async () => {
            if (!selected.reservation_id) return
            setSaving(true)
            try {
              await checkInReservation(selected.reservation_id)
              await refresh()
              if (selected) await loadDetail(selected)
            } finally { setSaving(false) }
          }}
          onCancelReservation={async () => {
            if (!selected.reservation_id) return
            setSaving(true)
            try {
              await cancelReservation(selected.reservation_id)
              await refresh()
              setSelected(null)
            } finally { setSaving(false) }
          }}
          saving={saving}
        />
      )}

      {showReserve && (
        <ReservationModal
          tables={tables.filter((t) => t.status === 'empty' || t.status === 'reserved')}
          onClose={() => setShowReserve(false)}
          onSave={async (input) => {
            setSaving(true)
            setError('')
            try {
              await createReservation(input)
              setShowReserve(false)
              refresh()
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Xatolik')
            } finally { setSaving(false) }
          }}
          saving={saving}
          error={error}
        />
      )}

      {showAddTable && (
        <TableFormModal
          table={editTable}
          onClose={() => { setShowAddTable(false); setEditTable(null) }}
          onSave={async (input) => {
            setSaving(true)
            setError('')
            try {
              await upsertTable(input)
              setShowAddTable(false)
              setEditTable(null)
              refresh()
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Xatolik')
            } finally { setSaving(false) }
          }}
          saving={saving}
          error={error}
        />
      )}
    </div>
  )
}

function TableCard({ table, onClick }: { table: TableSummary; onClick: () => void }) {
  const cat = getDisplayCategory(table.status)
  const meta = DISPLAY_CATEGORY_META[cat]
  const label = table.name ? `${table.name}` : `Stol ${table.number}`
  const isActive = cat === 'occupied' || cat === 'awaiting_payment'

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'text-left rounded-2xl border-2 p-4 transition-all hover:shadow-md active:scale-[0.98]',
        meta.color,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-bold text-lg">{label}</p>
        <span className="text-lg">{meta.emoji}</span>
      </div>
      <p className={cn('text-xs font-semibold mt-1 inline-block px-2 py-0.5 rounded-full', meta.badge)}>
        {meta.label}
      </p>

      {cat === 'reserved' && table.reservation_name && (
        <div className="mt-3 text-sm space-y-0.5">
          <p>{formatTime(table.reserved_for)}</p>
          <p className="font-medium">{table.reservation_name}</p>
          {table.reservation_guests && <p className="text-muted">{table.reservation_guests} kishi</p>}
        </div>
      )}

      {isActive && (
        <div className="mt-3 text-sm space-y-1">
          {table.item_count > 0 && <p>{table.item_count} ta zakaz</p>}
          {table.order_total > 0 && <p className="font-bold">{formatCurrency(table.order_total)}</p>}
          {table.opened_at && <p className="text-muted font-mono">{formatElapsed(table.opened_at)}</p>}
          {table.waiter_name && <p className="text-muted text-xs">{table.waiter_name}</p>}
        </div>
      )}

      {cat === 'empty' && (
        <p className="mt-3 text-xs text-muted">{table.capacity} kishilik · {table.zone}</p>
      )}
    </button>
  )
}

function TableDetailModal({
  table, items, loading, onClose, onRefresh, onEdit, onCleaning, onAvailable, onCheckIn,
  onCancelReservation, saving,
}: {
  table: TableSummary
  items: OrderItem[]
  loading: boolean
  onClose: () => void
  onRefresh: () => void
  onEdit: () => void
  onCleaning: () => void
  onAvailable: () => void
  onCheckIn: () => void
  onCancelReservation: () => void
  saving: boolean
}) {
  const cat = getDisplayCategory(table.status)
  const meta = DISPLAY_CATEGORY_META[cat]
  const title = table.name ?? `Stol ${table.number}`

  return (
    <Modal open onClose={onClose} title={title}>
      <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto">
        <div className="flex items-center gap-2">
          <span className="text-xl">{meta.emoji}</span>
          <span className={cn('text-sm font-semibold px-2 py-0.5 rounded-full', meta.badge)}>
            {meta.label}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <p><span className="text-muted">Zona:</span> {table.zone}</p>
          <p><span className="text-muted">Sig‘im:</span> {table.capacity} kishi</p>
          {table.waiter_name && <p><span className="text-muted">Ofitsiant:</span> {table.waiter_name}</p>}
          {table.guest_count != null && table.guest_count > 0 && (
            <p><span className="text-muted">Mehmonlar:</span> {table.guest_count}</p>
          )}
          {table.opened_at && (
            <p><span className="text-muted">Boshlangan:</span> {formatTime(table.opened_at)} ({formatElapsed(table.opened_at)})</p>
          )}
        </div>

        {cat === 'reserved' && table.reservation_name && (
          <Card>
            <CardContent className="pt-4 text-sm space-y-1">
              <p className="font-semibold">Bron: {table.reservation_name}</p>
              {table.reservation_phone && <p>{table.reservation_phone}</p>}
              <p>{formatTime(table.reserved_for)} · {table.reservation_guests} kishi</p>
              {table.reservation_notes && <p className="text-muted">{table.reservation_notes}</p>}
              <div className="flex flex-wrap gap-2 pt-2">
                <Button size="sm" loading={saving} onClick={onCheckIn}>Mijoz keldi</Button>
                <Button size="sm" variant="ghost" loading={saving} onClick={onCancelReservation}>Bron bekor</Button>
              </div>
            </CardContent>
          </Card>
        )}

        {table.current_order_id && (
          <>
            <div>
              <h3 className="font-semibold mb-2">Zakazlar</h3>
              {loading ? (
                <p className="text-sm text-muted">Yuklanmoqda...</p>
              ) : items.length === 0 ? (
                <p className="text-sm text-muted">Mahsulot yo‘q</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {items.map((item) => (
                    <li key={item.id} className="flex justify-between gap-2 border-b border-border pb-2">
                      <span>
                        {item.quantity} × {item.menu_item?.name ?? '—'}
                        <span className="block text-xs text-muted">
                          {formatCurrency(item.unit_price)} · {ORDER_ITEM_STATUS_LABELS[item.status] ?? item.status}
                        </span>
                      </span>
                      <span className="font-medium text-right">
                        {formatCurrency(item.total_price)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-xl bg-surface-2 p-3 text-sm space-y-1">
              <div className="flex justify-between font-bold text-base">
                <span>JAMI</span>
                <span>{formatCurrency(table.order_total)}</span>
              </div>
              {table.paid_total > 0 && (
                <div className="flex justify-between text-green-700">
                  <span>To‘langan</span>
                  <span>{formatCurrency(table.paid_total)}</span>
                </div>
              )}
              {table.balance_due > 0 && (
                <div className="flex justify-between text-orange-700">
                  <span>Qoldiq</span>
                  <span>{formatCurrency(table.balance_due)}</span>
                </div>
              )}
            </div>
            {table.current_order_id && (
              <Link to={`/cashier/pay/${table.current_order_id}`}>
                <Button variant="outline" size="sm" className="w-full">Kassada ochish</Button>
              </Link>
            )}
          </>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          <Button size="sm" variant="outline" onClick={onEdit}>Tahrirlash</Button>
          <Button size="sm" variant="ghost" onClick={onRefresh}>Yangilash</Button>
          {cat === 'cleaning' ? (
            <Button size="sm" loading={saving} onClick={onAvailable}>Bo‘sh qilish</Button>
          ) : cat === 'empty' ? (
            <Button size="sm" variant="ghost" loading={saving} onClick={onCleaning}>Tozalashga</Button>
          ) : null}
        </div>
      </div>
    </Modal>
  )
}

function ReservationModal({
  tables, onClose, onSave, saving, error,
}: {
  tables: TableSummary[]
  onClose: () => void
  onSave: (input: TableReservationInput) => Promise<void>
  saving: boolean
  error: string
}) {
  const [tableId, setTableId] = useState(tables[0]?.id ?? '')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [guests, setGuests] = useState('4')
  const [notes, setNotes] = useState('')

  const submit = () => {
    if (!tableId || !name || !date || !time) return
    const reserved_for = new Date(`${date}T${time}`).toISOString()
    onSave({
      table_id: tableId,
      customer_name: name,
      phone,
      reserved_for,
      guest_count: parseInt(guests, 10) || 2,
      notes: notes || undefined,
    })
  }

  return (
    <Modal open onClose={onClose} title="Bron qilish">
      <div className="p-4 space-y-3">
        <div>
          <p className="text-sm font-medium mb-1">Stol</p>
          <select
            className="w-full rounded-xl border border-border bg-surface px-3 py-2"
            value={tableId}
            onChange={(e) => setTableId(e.target.value)}
          >
            {tables.map((t) => (
              <option key={t.id} value={t.id}>
                Stol {t.number} {t.name ? `(${t.name})` : ''} — {t.zone}
              </option>
            ))}
          </select>
        </div>
        <Input label="Mijoz ismi" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Telefon" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Sana" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <Input label="Vaqt" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        <Input label="Odam soni" type="number" value={guests} onChange={(e) => setGuests(e.target.value)} />
        <Input label="Izoh" value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2 pt-2">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Bekor</Button>
          <Button className="flex-1" loading={saving} onClick={submit}>Saqlash</Button>
        </div>
      </div>
    </Modal>
  )
}

function TableFormModal({
  table, onClose, onSave, saving, error,
}: {
  table: TableSummary | null
  onClose: () => void
  onSave: (input: TableUpsertInput) => Promise<void>
  saving: boolean
  error: string
}) {
  const [number, setNumber] = useState(String(table?.number ?? ''))
  const [name, setName] = useState(table?.name ?? '')
  const [capacity, setCapacity] = useState(String(table?.capacity ?? 4))
  const [zone, setZone] = useState(table?.zone ?? 'Asosiy zal')
  const [isActive, setIsActive] = useState(table?.is_active ?? true)

  const submit = () => {
    onSave({
      table_id: table?.id,
      number: parseInt(number, 10),
      capacity: parseInt(capacity, 10) || 4,
      zone,
      name: name || null,
      is_active: isActive,
    })
  }

  return (
    <Modal open onClose={onClose} title={table ? 'Stolni tahrirlash' : 'Yangi stol'}>
      <div className="p-4 space-y-3">
        <Input label="Stol raqami" type="number" value={number} onChange={(e) => setNumber(e.target.value)} />
        <Input label="Nomi (ixtiyoriy, masalan VIP 1)" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Sig‘im" type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} />
        <div>
          <p className="text-sm font-medium mb-1">Zona</p>
          <select
            className="w-full rounded-xl border border-border bg-surface px-3 py-2"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
          >
            {TABLE_ZONES.map((z) => (
              <option key={z} value={z}>{z}</option>
            ))}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Faol stol
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2 pt-2">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Bekor</Button>
          <Button className="flex-1" loading={saving} onClick={submit}>Saqlash</Button>
        </div>
      </div>
    </Modal>
  )
}
