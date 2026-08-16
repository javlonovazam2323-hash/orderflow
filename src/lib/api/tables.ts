import { getSupabase, USE_MOCK } from '@/lib/supabase'
import { mockStore } from '@/lib/mock/store'
import type {
  OrderItem,
  TableReservationInput,
  TableSummary,
  TableUpsertInput,
} from '@/types/database'

export async function getTableSummaries(activeOnly = true): Promise<TableSummary[]> {
  if (USE_MOCK) return mockStore.getTableSummaries(activeOnly)

  let query = getSupabase().from('table_summaries').select('*').order('number')
  if (activeOnly) query = query.eq('is_active', true)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map(normalizeSummary)
}

export async function getTableSummaryById(id: string): Promise<TableSummary | null> {
  if (USE_MOCK) {
    const rows = mockStore.getTableSummaries()
    return rows.find((r) => r.id === id) ?? null
  }

  const { data, error } = await getSupabase()
    .from('table_summaries')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data ? normalizeSummary(data) : null
}

export async function getTableOrderItems(orderId: string): Promise<OrderItem[]> {
  const { getOrderItems } = await import('@/lib/api')
  return getOrderItems(orderId)
}

export async function createReservation(input: TableReservationInput): Promise<string> {
  const { data, error } = await getSupabase().rpc('create_table_reservation', {
    p_table_id: input.table_id,
    p_customer_name: input.customer_name,
    p_phone: input.phone ?? null,
    p_reserved_for: input.reserved_for,
    p_guest_count: input.guest_count,
    p_notes: input.notes ?? null,
  })
  if (error) throw error
  return data as string
}

export async function cancelReservation(reservationId: string): Promise<void> {
  const { error } = await getSupabase().rpc('cancel_table_reservation', {
    p_reservation_id: reservationId,
  })
  if (error) throw error
}

export async function checkInReservation(reservationId: string, waiterId?: string): Promise<string> {
  const { data, error } = await getSupabase().rpc('check_in_reservation', {
    p_reservation_id: reservationId,
    p_waiter_id: waiterId ?? null,
  })
  if (error) throw error
  return data as string
}

export async function upsertTable(input: TableUpsertInput): Promise<string> {
  const { data, error } = await getSupabase().rpc('admin_upsert_table', {
    p_number: input.number,
    p_capacity: input.capacity,
    p_zone: input.zone,
    p_name: input.name ?? null,
    p_is_active: input.is_active ?? true,
    p_table_id: input.table_id ?? null,
  })
  if (error) throw error
  return data as string
}

export async function setTableCleaning(tableId: string): Promise<void> {
  const { error } = await getSupabase().rpc('set_table_cleaning', { p_table_id: tableId })
  if (error) throw error
}

export async function setTableAvailable(tableId: string): Promise<void> {
  const { error } = await getSupabase().rpc('set_table_available', { p_table_id: tableId })
  if (error) throw error
}

function normalizeSummary(row: Record<string, unknown>): TableSummary {
  return {
    id: row.id as string,
    number: Number(row.number),
    name: (row.name as string | null) ?? null,
    status: row.status as TableSummary['status'],
    capacity: Number(row.capacity ?? 4),
    zone: (row.zone as string | null) ?? null,
    is_active: Boolean(row.is_active ?? true),
    current_order_id: (row.current_order_id as string | null) ?? null,
    order_number: (row.order_number as string | null) ?? null,
    waiter_id: (row.waiter_id as string | null) ?? null,
    order_status: (row.order_status as TableSummary['order_status']) ?? null,
    order_total: Number(row.order_total ?? 0),
    guest_count: row.guest_count != null ? Number(row.guest_count) : null,
    opened_at: (row.opened_at as string | null) ?? null,
    waiter_name: (row.waiter_name as string | null) ?? null,
    item_count: Number(row.item_count ?? 0),
    paid_total: Number(row.paid_total ?? 0),
    balance_due: Number(row.balance_due ?? 0),
    reservation_id: (row.reservation_id as string | null) ?? null,
    reservation_name: (row.reservation_name as string | null) ?? null,
    reservation_phone: (row.reservation_phone as string | null) ?? null,
    reserved_for: (row.reserved_for as string | null) ?? null,
    reservation_guests: row.reservation_guests != null ? Number(row.reservation_guests) : null,
    reservation_notes: (row.reservation_notes as string | null) ?? null,
  }
}

export const REALTIME_TABLES = [
  'restaurant_tables',
  'orders',
  'order_items',
  'payments',
  'table_reservations',
  'kitchen_tickets',
] as const
