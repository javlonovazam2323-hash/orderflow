import type { User as AuthUser } from '@supabase/supabase-js'
import { getSupabase, USE_MOCK } from '@/lib/supabase'
import { mockStore } from '@/lib/mock/store'
import { withRestaurantId } from '@/lib/tenant/scope'
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

/** Display-only identity when auth.users has a session but profiles INSERT is still service_role-only. */
function syntheticIdentityProfile(user: AuthUser): Profile {
  const meta = user.user_metadata?.full_name
  const metaName = typeof meta === 'string' && meta.trim() ? meta.trim() : null
  return {
    id: user.id,
    full_name: metaName || user.email?.split('@')[0] || 'Yangi foydalanuvchi',
    role: 'admin',
    is_active: true,
  }
}

async function loadProfileOrSynthetic(user: AuthUser): Promise<Profile> {
  const { data: profile } = await getSupabase().from('profiles').select('*').eq('id', user.id).maybeSingle()
  if (profile) return profile
  return syntheticIdentityProfile(user)
}

export async function signIn(email: string, password: string): Promise<Profile | null> {
  if (USE_MOCK) return mockStore.signIn(email, password)

  const sb = getSupabase()
  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  if (error || !data.user) return null

  return loadProfileOrSynthetic(data.user)
}

export async function signUp(email: string, password: string): Promise<{
  profile: Profile | null
  needsEmailConfirm: boolean
}> {
  if (USE_MOCK) throw new Error('Ro\'yxatdan o\'tish demo rejimda mavjud emas')

  const sb = getSupabase()
  const { data, error } = await sb.auth.signUp({ email, password })
  if (error) throw error
  if (!data.session || !data.user) {
    return { profile: null, needsEmailConfirm: true }
  }
  return {
    profile: await loadProfileOrSynthetic(data.user),
    needsEmailConfirm: false,
  }
}

export async function signInWithPin(pin: string, restaurantSlug?: string | null): Promise<Profile | null> {
  if (USE_MOCK) return mockStore.signInWithPin(pin)

  const sb = getSupabase()
  const { data, error } = await sb.functions.invoke('pin-login', {
    body: { pin, restaurant_slug: restaurantSlug ?? null },
  })
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

  return loadProfileOrSynthetic(session.user)
}

export async function getSettings(): Promise<RestaurantSettings> {
  if (USE_MOCK) return mockStore.getSettings()

  const { data } = await withRestaurantId(getSupabase().from('restaurant_settings').select('*')).limit(1).maybeSingle()
  if (!data) throw new Error('Restaurant settings not found')
  return data
}

export async function getCategories(): Promise<MenuCategory[]> {
  if (USE_MOCK) return mockStore.getCategories()

  const { data } = await withRestaurantId(getSupabase().from('menu_categories').select('*'))
    .eq('is_active', true)
    .order('sort_order')
  return data ?? []
}

export async function getMenuItems(): Promise<MenuItem[]> {
  if (USE_MOCK) return mockStore.getMenuItems()

  const { data } = await withRestaurantId(getSupabase().from('menu_items').select('*'))
    .eq('is_available', true)
    .order('sort_order')
  return data ?? []
}

export async function getTables(activeOnly = true): Promise<RestaurantTable[]> {
  if (USE_MOCK) return mockStore.getTables()

  let query = withRestaurantId(getSupabase().from('restaurant_tables').select('*')).order('number')
  if (activeOnly) query = query.eq('is_active', true)
  const { data } = await query
  return data ?? []
}

export async function getTable(id: string): Promise<RestaurantTable | undefined> {
  if (USE_MOCK) return mockStore.getTable(id)

  const { data } = await withRestaurantId(getSupabase().from('restaurant_tables').select('*'))
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

  const { data } = await withRestaurantId(getSupabase().from('orders').select('*')).eq('id', orderId).maybeSingle()
  return data
}

export async function getOrderItems(orderId: string): Promise<OrderItem[]> {
  if (USE_MOCK) return mockStore.getOrderItems(orderId)

  const { data } = await withRestaurantId(getSupabase().from('order_items').select('*, menu_item:menu_items(*)'))
    .eq('order_id', orderId)
  return (data ?? []).map((row) => ({
    ...row,
    menu_item: row.menu_item as MenuItem,
  }))
}

export async function getDraftCartItems(orderId: string): Promise<CartItem[]> {
  const rows = await getOrderItems(orderId)
  return rows
    .filter((row) => row.status === 'pending' && row.menu_item)
    .map((row) => ({
      menu_item_id: row.menu_item_id,
      menu_item: row.menu_item as MenuItem,
      quantity: row.quantity,
      notes: row.notes ?? '',
    }))
}

export async function upsertDraftCartItem(
  orderId: string,
  menuItemId: string,
  quantity: number,
  notes?: string,
): Promise<void> {
  if (USE_MOCK) return
  const { error } = await getSupabase().rpc('upsert_draft_order_item', {
    p_order_id: orderId,
    p_menu_item_id: menuItemId,
    p_quantity: quantity,
    p_notes: notes ?? null,
  })
  if (error) throw error
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

  const { data: tickets } = await withRestaurantId(
    getSupabase().from('kitchen_tickets').select('*, table:restaurant_tables(*), waiter:profiles(*), order:orders(*)'),
  )
    .not('status', 'eq', 'cancelled')
    .order('sent_at')

  if (!tickets) return []

  const result: KitchenTicket[] = []
  for (const t of tickets) {
    const { data: items } = await withRestaurantId(getSupabase().from('order_items').select('*, menu_item:menu_items(*)'))
      .eq('kitchen_ticket_id', t.id)

    result.push({
      ...t,
      table: t.table as RestaurantTable | undefined,
      waiter: t.waiter as Profile | undefined,
      order: t.order as Order | undefined,
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

  const { data } = await withRestaurantId(getSupabase().from('notifications').select('*'))
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
  await withRestaurantId(getSupabase().from('notifications').update({ is_read: true })).eq('id', id)
}

export async function getOpenOrders(): Promise<Order[]> {
  if (USE_MOCK) return mockStore.getOpenOrders()

  const { data } = await withRestaurantId(getSupabase().from('orders').select('*'))
    .in('status', ['open', 'awaiting_payment'])
    .order('opened_at', { ascending: false })
  return data ?? []
}

export async function getPayments(orderId: string): Promise<Payment[]> {
  if (USE_MOCK) return mockStore.getPayments(orderId)

  const { data } = await withRestaurantId(getSupabase().from('payments').select('*'))
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
  const { data } = await withRestaurantId(getSupabase().from('cash_sessions').select('*'))
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
