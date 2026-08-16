export type UserRole = 'admin' | 'cashier' | 'waiter' | 'kitchen'

export type TableStatus =
  | 'empty'
  | 'occupied'
  | 'has_order'
  | 'preparing'
  | 'ready'
  | 'awaiting_payment'

export type OrderStatus = 'draft' | 'open' | 'awaiting_payment' | 'paid' | 'cancelled'

export type KitchenTicketStatus = 'new' | 'accepted' | 'in_progress' | 'ready' | 'cancelled'

export type PaymentMethod = 'cash' | 'card' | 'click' | 'payme' | 'other'

export interface Profile {
  id: string
  full_name: string
  role: UserRole
  is_active: boolean
}

export interface RestaurantTable {
  id: string
  number: number
  status: TableStatus
  current_order_id: string | null
  capacity: number
}

export interface MenuCategory {
  id: string
  name: string
  slug: string
  sort_order: number
  is_active: boolean
}

export interface MenuItem {
  id: string
  category_id: string
  name: string
  description: string | null
  price: number
  image_url: string | null
  prep_time_minutes: number
  is_available: boolean
  sort_order: number
}

export interface Order {
  id: string
  order_number: string
  table_id: string
  waiter_id: string
  status: OrderStatus
  subtotal: number
  service_charge: number
  tax_amount: number
  total: number
  guest_count: number
  opened_at: string
  closed_at: string | null
}

export interface OrderItem {
  id: string
  order_id: string
  menu_item_id: string
  kitchen_ticket_id: string | null
  quantity: number
  unit_price: number
  total_price: number
  notes: string | null
  status: string
  sent_to_kitchen_at: string | null
  idempotency_key?: string
  menu_item?: MenuItem
}

export interface KitchenTicket {
  id: string
  ticket_number: number
  order_id: string
  table_id: string
  waiter_id: string
  status: KitchenTicketStatus
  sent_at: string
  accepted_at: string | null
  started_at: string | null
  ready_at: string | null
  table?: RestaurantTable
  waiter?: Profile
  items?: OrderItem[]
}

export interface Payment {
  id: string
  order_id: string
  amount: number
  method: PaymentMethod
  status: string
  cashier_id: string
  idempotency_key?: string
  created_at: string
}

export interface Notification {
  id: string
  user_id: string
  type: string
  title: string
  body: string
  data: Record<string, unknown>
  is_read: boolean
  created_at: string
}

export interface RestaurantSettings {
  id: string
  name: string
  logo_url?: string | null
  phone?: string | null
  address?: string | null
  table_count?: number
  service_charge_percent: number
  tax_percent?: number
  currency: string
  receipt_footer?: string | null
}

export interface DailyReport {
  date: string
  total_sales: number
  order_count: number
  cash_total: number
  card_total: number
  online_total: number
  other_total: number
  average_check: number
  top_dish: { name: string; quantity: number } | null
  waiter_sales: { waiter_id: string; waiter_name: string; total: number; order_count: number }[]
}

export interface WaiterStats {
  waiter_id: string
  waiter_name: string
  order_count: number
  total_sales: number
  average_check: number
}

export interface MenuItemInput {
  category_id: string
  name: string
  description?: string | null
  price: number
  image_url?: string | null
  prep_time_minutes: number
  is_available: boolean
  sort_order?: number
}

export interface MenuCategoryInput {
  name: string
  slug?: string
  sort_order?: number
  is_active?: boolean
}

export interface SettingsInput {
  name?: string
  phone?: string | null
  address?: string | null
  table_count?: number
  service_charge_percent?: number
  tax_percent?: number
  currency?: string
  receipt_footer?: string | null
}

export interface CartItem {
  menu_item_id: string
  menu_item: MenuItem
  quantity: number
  notes: string
}

export interface CashSessionSummary {
  total_revenue: number
  cash_total: number
  card_total: number
  click_total: number
  payme_total: number
  other_total: number
  order_count: number
}

export const TABLE_STATUS_LABELS: Record<TableStatus, string> = {
  empty: 'Bo\'sh',
  occupied: 'Band',
  has_order: 'Buyurtma bor',
  preparing: 'Tayyorlanmoqda',
  ready: 'Tayyor',
  awaiting_payment: 'Hisob kutilmoqda',
}

export const TABLE_STATUS_COLORS: Record<TableStatus, string> = {
  empty: 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300',
  occupied: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
  has_order: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
  preparing: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300',
  ready: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
  awaiting_payment: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
}

export const KITCHEN_STATUS_LABELS: Record<KitchenTicketStatus, string> = {
  new: 'YANGI',
  accepted: 'QABUL QILINDI',
  in_progress: 'JARAYONDA',
  ready: 'TAYYOR',
  cancelled: 'BEKOR',
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Naqd',
  card: 'Karta',
  click: 'Click',
  payme: 'Payme',
  other: 'Boshqa',
}
