import { getSupabase, USE_MOCK } from '@/lib/supabase'
import { mockStore } from '@/lib/mock/store'
import type {
  CartItem,
  CashSessionSummary,
  KitchenTicket,
  MenuCategory,
  MenuItem,
  Notification,
  Order,
  OrderItem,
  Payment,
  PaymentMethod,
  Profile,
  RestaurantSettings,
  RestaurantTable,
} from '@/types/database'

export async function signIn(email: string, password: string): Promise<Profile | null> {
  if (USE_MOCK) return mockStore.signIn(email, password)

  const sb = getSupabase()
  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  if (error || !data.user) return null

  const { data: profile } = await sb.from('profiles').select('*').eq('id', data.user.id).single()
  return profile
}

export async function signInWithPin(pin: string): Promise<Profile | null> {
  if (USE_MOCK) return mockStore.signInWithPin(pin)

  const sb = getSupabase()
  const { data, error } = await sb.functions.invoke('pin-login', { body: { pin } })
  if (error || !data?.token_hash) return null

  const { error: otpError } = await sb.auth.verifyOtp({
    token_hash: data.token_hash as string,
    type: 'email',
  })
  if (otpError) return null

  const { data: { session } } = await sb.auth.getSession()
  if (!session) return null

  const { data: profile } = await sb.from('profiles').select('*').eq('id', session.user.id).single()
  return profile
}

export async function signOut(): Promise<void> {
  if (USE_MOCK) {
    mockStore.signOut()
    return
  }
  await getSupabase().auth.signOut()
}

export async function getSession(): Promise<Profile | null> {
  if (USE_MOCK) return mockStore.getSession()

  const sb = getSupabase()
  const { data: { session } } = await sb.auth.getSession()
  if (!session) return null

  const { data: profile } = await sb.from('profiles').select('*').eq('id', session.user.id).single()
  return profile
}

export async function getSettings(): Promise<RestaurantSettings> {
  if (USE_MOCK) return mockStore.getSettings()

  const { data } = await getSupabase().from('restaurant_settings').select('*').limit(1).single()
  return data!
}

export async function getCategories(): Promise<MenuCategory[]> {
  if (USE_MOCK) return mockStore.getCategories()

  const { data } = await getSupabase()
    .from('menu_categories')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')
  return data ?? []
}

export async function getMenuItems(): Promise<MenuItem[]> {
  if (USE_MOCK) return mockStore.getMenuItems()

  const { data } = await getSupabase()
    .from('menu_items')
    .select('*')
    .eq('is_available', true)
    .order('sort_order')
  return data ?? []
}

export async function getTables(): Promise<RestaurantTable[]> {
  if (USE_MOCK) return mockStore.getTables()

  const { data } = await getSupabase()
    .from('restaurant_tables')
    .select('*')
    .order('number')
  return data ?? []
}

export async function getTable(id: string): Promise<RestaurantTable | undefined> {
  if (USE_MOCK) return mockStore.getTable(id)

  const { data } = await getSupabase()
    .from('restaurant_tables')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  return data ?? undefined
}

export async function openTableOrder(tableId: string, waiterId: string): Promise<string> {
  if (USE_MOCK) return mockStore.openTableOrder(tableId, waiterId)

  const { data, error } = await getSupabase().rpc('open_table_order', {
    p_table_id: tableId,
    p_waiter_id: waiterId,
  })
  if (error) throw error
  return data as string
}

export async function getOrder(orderId: string): Promise<Order | null> {
  if (USE_MOCK) return mockStore.getOrder(orderId) ?? null

  const { data } = await getSupabase().from('orders').select('*').eq('id', orderId).single()
  return data
}

export async function getOrderItems(orderId: string): Promise<OrderItem[]> {
  if (USE_MOCK) return mockStore.getOrderItems(orderId)

  const { data } = await getSupabase()
    .from('order_items')
    .select('*, menu_item:menu_items(*)')
    .eq('order_id', orderId)
  return (data ?? []).map((row) => ({
    ...row,
    menu_item: row.menu_item as MenuItem,
  }))
}

export async function sendToKitchen(
  orderId: string,
  items: CartItem[],
  idempotencyKey: string,
): Promise<string> {
  if (USE_MOCK) return mockStore.sendToKitchen(orderId, items, idempotencyKey)

  const payload = items.map((i) => ({
    menu_item_id: i.menu_item_id,
    quantity: i.quantity,
    notes: i.notes || null,
  }))

  const { data, error } = await getSupabase().rpc('send_to_kitchen', {
    p_order_id: orderId,
    p_items: payload,
    p_idempotency_key: idempotencyKey,
  })
  if (error) throw error
  return data as string
}

export async function getKitchenTickets(): Promise<KitchenTicket[]> {
  if (USE_MOCK) return mockStore.getKitchenTickets()

  const { data: tickets } = await getSupabase()
    .from('kitchen_tickets')
    .select('*, table:restaurant_tables(*), waiter:profiles(*)')
    .not('status', 'eq', 'cancelled')
    .order('sent_at')

  if (!tickets) return []

  const result: KitchenTicket[] = []
  for (const t of tickets) {
    const { data: items } = await getSupabase()
      .from('order_items')
      .select('*, menu_item:menu_items(*)')
      .eq('kitchen_ticket_id', t.id)

    result.push({
      ...t,
      table: t.table as RestaurantTable,
      waiter: t.waiter as Profile,
      items: (items ?? []).map((i) => ({ ...i, menu_item: i.menu_item as MenuItem })),
    })
  }
  return result
}

export async function updateKitchenStatus(
  ticketId: string,
  status: KitchenTicket['status'],
): Promise<void> {
  if (USE_MOCK) {
    mockStore.updateKitchenStatus(ticketId, status)
    return
  }
  const { error } = await getSupabase().rpc('update_kitchen_ticket_status', {
    p_ticket_id: ticketId,
    p_status: status,
  })
  if (error) throw error
}

export async function getNotifications(userId: string): Promise<Notification[]> {
  if (USE_MOCK) return mockStore.getNotifications(userId)

  const { data } = await getSupabase()
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50)
  return data ?? []
}

export async function markNotificationRead(id: string): Promise<void> {
  if (USE_MOCK) {
    mockStore.markNotificationRead(id)
    return
  }
  await getSupabase().from('notifications').update({ is_read: true }).eq('id', id)
}

export async function getOpenOrders(): Promise<Order[]> {
  if (USE_MOCK) return mockStore.getOpenOrders()

  const { data } = await getSupabase()
    .from('orders')
    .select('*')
    .in('status', ['open', 'awaiting_payment'])
    .order('opened_at', { ascending: false })
  return data ?? []
}

export async function getPayments(orderId: string): Promise<Payment[]> {
  if (USE_MOCK) return mockStore.getPayments(orderId)

  const { data } = await getSupabase()
    .from('payments')
    .select('*')
    .eq('order_id', orderId)
    .order('created_at')
  return data ?? []
}

export async function addPayment(
  orderId: string,
  amount: number,
  method: PaymentMethod,
  idempotencyKey?: string,
  cashierId?: string,
): Promise<void> {
  if (USE_MOCK) {
    mockStore.addPayment(orderId, amount, method, idempotencyKey, cashierId)
    return
  }
  const { error } = await getSupabase().rpc('add_payment', {
    p_order_id: orderId,
    p_amount: amount,
    p_method: method,
    p_idempotency_key: idempotencyKey ?? null,
  })
  if (error) throw error
}

export async function requestBill(orderId: string): Promise<void> {
  if (USE_MOCK) {
    mockStore.requestBill(orderId)
    return
  }
  const { error } = await getSupabase().rpc('request_bill', { p_order_id: orderId })
  if (error) throw error
}

export async function getCashSession(): Promise<CashSessionSummary> {
  if (USE_MOCK) return mockStore.getCashSession()

  const today = new Date().toISOString().slice(0, 10)
  const { data } = await getSupabase()
    .from('cash_sessions')
    .select('*')
    .eq('session_date', today)
    .maybeSingle()

  return data ?? {
    total_revenue: 0,
    cash_total: 0,
    card_total: 0,
    click_total: 0,
    payme_total: 0,
    other_total: 0,
    order_count: 0,
  }
}

export function subscribeMock(fn: () => void): () => void {
  return mockStore.subscribe(fn)
}
