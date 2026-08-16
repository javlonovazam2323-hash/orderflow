import { USE_MOCK, getSupabase } from '@/lib/supabase'
import { mockStore } from '@/lib/mock/store'
import type {
  DailyReport,
  MenuCategory,
  MenuCategoryInput,
  MenuItem,
  MenuItemInput,
  RestaurantSettings,
  SettingsInput,
  WaiterStats,
} from '@/types/database'

export async function getAdminCategories(): Promise<MenuCategory[]> {
  if (USE_MOCK) return mockStore.getAdminCategories()
  const { data } = await getSupabase().from('menu_categories').select('*').order('sort_order')
  return data ?? []
}

export async function getAdminMenuItems(): Promise<MenuItem[]> {
  if (USE_MOCK) return mockStore.getAdminMenuItems()
  const { data } = await getSupabase().from('menu_items').select('*').order('sort_order')
  return data ?? []
}

export async function createCategory(input: MenuCategoryInput): Promise<MenuCategory> {
  if (USE_MOCK) return mockStore.createCategory(input)
  const slug = input.slug ?? input.name.toLowerCase().replace(/\s+/g, '-')
  const { data, error } = await getSupabase()
    .from('menu_categories')
    .insert({ ...input, slug })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateCategory(id: string, input: MenuCategoryInput): Promise<void> {
  if (USE_MOCK) { mockStore.updateCategory(id, input); return }
  const { error } = await getSupabase().from('menu_categories').update(input).eq('id', id)
  if (error) throw error
}

export async function deleteCategory(id: string): Promise<void> {
  if (USE_MOCK) { mockStore.deleteCategory(id); return }
  const { error } = await getSupabase().from('menu_categories').delete().eq('id', id)
  if (error) throw error
}

export async function createMenuItem(input: MenuItemInput): Promise<MenuItem> {
  if (USE_MOCK) return mockStore.createMenuItem(input)
  const { data, error } = await getSupabase().from('menu_items').insert(input).select().single()
  if (error) throw error
  return data
}

export async function updateMenuItem(id: string, input: MenuItemInput): Promise<void> {
  if (USE_MOCK) { mockStore.updateMenuItem(id, input); return }
  const { error } = await getSupabase().from('menu_items').update(input).eq('id', id)
  if (error) throw error
}

export async function deleteMenuItem(id: string): Promise<void> {
  if (USE_MOCK) { mockStore.deleteMenuItem(id); return }
  const { error } = await getSupabase().from('menu_items').delete().eq('id', id)
  if (error) throw error
}

export async function getSettings(): Promise<RestaurantSettings> {
  if (USE_MOCK) return mockStore.getSettings()
  const { data } = await getSupabase().from('restaurant_settings').select('*').limit(1).single()
  return data!
}

export async function updateSettings(input: SettingsInput): Promise<void> {
  if (USE_MOCK) { mockStore.updateSettings(input); return }
  const { data: existing } = await getSupabase().from('restaurant_settings').select('id').limit(1).single()
  const { error } = await getSupabase().from('restaurant_settings').update(input).eq('id', existing!.id)
  if (error) throw error
  if (input.table_count !== undefined) {
    await getSupabase().rpc('sync_restaurant_tables')
  }
}

export async function getDailyReport(date: string): Promise<DailyReport> {
  if (USE_MOCK) return mockStore.getDailyReport(date)

  const start = `${date}T00:00:00`
  const end = `${date}T23:59:59`

  const { data: orders } = await getSupabase()
    .from('orders')
    .select('*, payments(*)')
    .eq('status', 'paid')
    .gte('closed_at', start)
    .lte('closed_at', end)

  // Simplified Supabase aggregation — full RPC can be added later
  const paidOrders = orders ?? []
  const total = paidOrders.reduce((s, o) => s + Number(o.total), 0)
  return {
    date,
    total_sales: total,
    order_count: paidOrders.length,
    cash_total: 0,
    card_total: 0,
    online_total: 0,
    other_total: 0,
    average_check: paidOrders.length ? total / paidOrders.length : 0,
    top_dish: null,
    waiter_sales: [],
  }
}

export async function getWaiterStats(date: string): Promise<WaiterStats[]> {
  if (USE_MOCK) return mockStore.getWaiterStats(date)
  // Supabase RPC placeholder — mock handles demo
  return []
}
