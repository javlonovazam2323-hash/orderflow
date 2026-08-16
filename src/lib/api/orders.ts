import { USE_MOCK, getSupabase } from '@/lib/supabase'
import type {
  CreatePhoneOrderInput,
  FulfillmentStatus,
  Order,
  OrderEvent,
  OrderSummary,
  OrderType,
  PaymentMethod,
  Profile,
} from '@/types/database'

export async function getOrderSummaries(filters?: {
  orderType?: OrderType | 'all'
  statusGroup?: 'all' | 'new' | 'kitchen' | 'ready' | 'transit' | 'done' | 'cancelled'
  search?: string
  todayOnly?: boolean
}): Promise<OrderSummary[]> {
  if (USE_MOCK) return []

  const sb = getSupabase()
  let rows: OrderSummary[] = []

  const { data, error } = await sb.from('order_summaries').select('*').order('opened_at', { ascending: false })
  if (!error && data) {
    rows = data as OrderSummary[]
  } else {
    const { data: orders, error: ordersError } = await sb.from('orders').select('*').order('opened_at', { ascending: false })
    if (ordersError) throw ordersError
    rows = await Promise.all((orders ?? []).map(async (o) => {
      const { data: payments } = await sb.from('payments').select('amount').eq('order_id', o.id).eq('status', 'completed')
      const paid = (payments ?? []).reduce((s, p) => s + Number(p.amount), 0)
      const { count } = await sb.from('order_items').select('*', { count: 'exact', head: true }).eq('order_id', o.id)
      return {
        ...o,
        table_number: null,
        created_by_name: null,
        waiter_name: null,
        courier_name: null,
        paid_total: paid,
        balance_due: Math.max(Number(o.total) - paid, 0),
        item_count: count ?? 0,
      } as OrderSummary
    }))
  }

  if (filters?.todayOnly !== false) {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    rows = rows.filter((o) => new Date(o.opened_at) >= start)
  }

  if (filters?.orderType && filters.orderType !== 'all') {
    rows = rows.filter((o) => o.order_type === filters.orderType)
  }

  if (filters?.statusGroup && filters.statusGroup !== 'all') {
    rows = rows.filter((o) => matchesStatusGroup(o, filters.statusGroup!))
  }

  if (filters?.search?.trim()) {
    const q = filters.search.trim().toLowerCase()
    rows = rows.filter(
      (o) =>
        o.order_number.toLowerCase().includes(q) ||
        (o.customer_phone ?? '').includes(q) ||
        (o.customer_name ?? '').toLowerCase().includes(q),
    )
  }

  return rows
}

function matchesStatusGroup(o: OrderSummary, group: string): boolean {
  if (group === 'new') return o.fulfillment_status === 'new' || (o.order_type === 'dine_in' && o.status === 'open' && !o.fulfillment_status)
  if (group === 'kitchen') return o.fulfillment_status === 'in_kitchen' || o.status === 'open'
  if (group === 'ready') return o.fulfillment_status === 'ready' || o.fulfillment_status === 'awaiting_pickup'
  if (group === 'transit') return o.fulfillment_status === 'in_transit' || o.fulfillment_status === 'dispatched'
  if (group === 'done') return o.status === 'paid' || o.fulfillment_status === 'completed'
  if (group === 'cancelled') return o.status === 'cancelled' || o.fulfillment_status === 'cancelled'
  return true
}

export async function getOrderSummary(orderId: string): Promise<OrderSummary | null> {
  if (USE_MOCK) return null
  const { data } = await getSupabase().from('order_summaries').select('*').eq('id', orderId).maybeSingle()
  return data as OrderSummary | null
}

export async function getOrderEvents(orderId: string): Promise<OrderEvent[]> {
  if (USE_MOCK) return []
  const { data } = await getSupabase()
    .from('order_events')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at')
  return data ?? []
}

export async function createPhoneOrder(input: CreatePhoneOrderInput): Promise<string> {
  if (USE_MOCK) throw new Error('Mock mode')

  const { data, error } = await getSupabase().rpc('create_phone_order', {
    p_order_type: input.order_type,
    p_customer_name: input.customer_name,
    p_customer_phone: input.customer_phone,
    p_items: input.items,
    p_notes: input.notes ?? null,
    p_scheduled_ready_at: input.scheduled_ready_at ?? null,
    p_scheduled_delivery_at: input.scheduled_delivery_at ?? null,
    p_delivery_address: input.delivery_address ?? null,
    p_delivery_landmark: input.delivery_landmark ?? null,
    p_delivery_fee: input.delivery_fee ?? 0,
    p_discount_amount: input.discount_amount ?? 0,
    p_payment_method: input.payment_method ?? null,
    p_prepayment_amount: input.prepayment_amount ?? 0,
    p_idempotency_key: input.idempotency_key ?? crypto.randomUUID(),
  })
  if (error) throw error
  return data as string
}

export async function markAwaitingPickup(orderId: string): Promise<void> {
  const { error } = await getSupabase().rpc('mark_order_awaiting_pickup', { p_order_id: orderId })
  if (error) throw error
}

export async function markPickedUp(orderId: string): Promise<void> {
  const { error } = await getSupabase().rpc('mark_order_picked_up', { p_order_id: orderId })
  if (error) throw error
}

export async function dispatchDelivery(orderId: string, courierId: string): Promise<void> {
  const { error } = await getSupabase().rpc('dispatch_delivery_order', {
    p_order_id: orderId,
    p_courier_id: courierId,
  })
  if (error) throw error
}

export async function markDelivered(orderId: string): Promise<void> {
  const { error } = await getSupabase().rpc('mark_order_delivered', { p_order_id: orderId })
  if (error) throw error
}

export async function getCouriers(): Promise<Profile[]> {
  if (USE_MOCK) return []
  const { data } = await getSupabase()
    .from('profiles')
    .select('*')
    .in('role', ['waiter', 'cashier', 'admin'])
    .eq('is_active', true)
    .order('full_name')
  return data ?? []
}

export interface OrderKpis {
  total: number
  dineIn: number
  pickup: number
  delivery: number
  inKitchen: number
  ready: number
  inTransit: number
  completed: number
  todaySales: number
}

export function computeOrderKpis(orders: OrderSummary[]): OrderKpis {
  return {
    total: orders.length,
    dineIn: orders.filter((o) => o.order_type === 'dine_in').length,
    pickup: orders.filter((o) => o.order_type === 'pickup').length,
    delivery: orders.filter((o) => o.order_type === 'delivery').length,
    inKitchen: orders.filter((o) => o.fulfillment_status === 'in_kitchen').length,
    ready: orders.filter((o) => ['ready', 'awaiting_pickup'].includes(o.fulfillment_status ?? '')).length,
    inTransit: orders.filter((o) => ['in_transit', 'dispatched'].includes(o.fulfillment_status ?? '')).length,
    completed: orders.filter((o) => o.status === 'paid').length,
    todaySales: orders.filter((o) => o.status === 'paid').reduce((s, o) => s + o.total, 0),
  }
}

export function getDisplayStatus(order: OrderSummary): { label: string; tone: string } {
  if (order.status === 'paid') return { label: 'Yakunlandi', tone: 'success' }
  if (order.status === 'cancelled') return { label: 'Bekor', tone: 'danger' }
  if (order.fulfillment_status === 'in_transit') return { label: 'Yo\'lda', tone: 'info' }
  if (order.fulfillment_status === 'ready') return { label: 'Tayyor', tone: 'success' }
  if (order.fulfillment_status === 'awaiting_pickup') return { label: 'Olib ketishga tayyor', tone: 'success' }
  if (order.fulfillment_status === 'in_kitchen') return { label: 'Oshxonada', tone: 'warning' }
  if (order.status === 'awaiting_payment') return { label: 'To\'lov kutilmoqda', tone: 'purple' }
  return { label: 'Yangi', tone: 'muted' }
}

export type { Order, FulfillmentStatus, PaymentMethod }
