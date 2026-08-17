import type {
  CartItem,
  CashSessionSummary,
  DailyReport,
  KitchenTicket,
  MenuCategory,
  MenuCategoryInput,
  MenuItem,
  MenuItemInput,
  Notification,
  Order,
  OrderItem,
  Payment,
  Profile,
  RestaurantSettings,
  RestaurantTable,
  SettingsInput,
  UserRole,
  WaiterStats,
} from '@/types/database'

type Listener = () => void

function uid(): string {
  return crypto.randomUUID()
}

const DEFAULT_CATEGORIES: MenuCategory[] = [
  { id: 'c1', name: 'Osh', slug: 'osh', sort_order: 1, is_active: true },
  { id: 'c2', name: "Sho'rva", slug: 'shorva', sort_order: 2, is_active: true },
  { id: 'c3', name: 'Kabob', slug: 'kabob', sort_order: 3, is_active: true },
  { id: 'c4', name: 'Salatlar', slug: 'salatlar', sort_order: 5, is_active: true },
  { id: 'c5', name: 'Ichimliklar', slug: 'ichimliklar', sort_order: 7, is_active: true },
  { id: 'c6', name: 'Choy', slug: 'choy', sort_order: 8, is_active: true },
]

const DEFAULT_MENU: MenuItem[] = [
  { id: 'm1', category_id: 'c1', name: 'Osh palov', description: "An'anaviy palov", price: 40000, image_url: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400', prep_time_minutes: 25, is_available: true, sort_order: 1 },
  { id: 'm2', category_id: 'c1', name: 'Devzira palov', description: 'Qizil guruchli', price: 45000, image_url: 'https://images.unsplash.com/photo-1563379926898-05f4575a58d8?w=400', prep_time_minutes: 30, is_available: true, sort_order: 2 },
  { id: 'm3', category_id: 'c2', name: "Sho'rva", description: "Go'shtli sho'rva", price: 35000, image_url: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=400', prep_time_minutes: 20, is_available: true, sort_order: 1 },
  { id: 'm4', category_id: 'c3', name: "Qo'y kabob", description: 'Tandirda', price: 25000, image_url: 'https://images.unsplash.com/photo-1529042410819-b791f0a79140?w=400', prep_time_minutes: 15, is_available: true, sort_order: 1 },
  { id: 'm5', category_id: 'c3', name: 'Lulya kabob', description: '3 dona', price: 30000, image_url: 'https://images.unsplash.com/photo-1594041680534-e8c8cdebd659?w=400', prep_time_minutes: 15, is_available: true, sort_order: 2 },
  { id: 'm6', category_id: 'c4', name: 'Achchiq-chuchuk', description: 'Salat', price: 12000, image_url: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=400', prep_time_minutes: 5, is_available: true, sort_order: 1 },
  { id: 'm7', category_id: 'c5', name: 'Coca-Cola', description: '0.5L', price: 10000, image_url: 'https://images.unsplash.com/photo-1629203851122-3729814c932e?w=400', prep_time_minutes: 1, is_available: true, sort_order: 1 },
  { id: 'm8', category_id: 'c6', name: "Ko'k choy", description: 'Choynak', price: 15000, image_url: 'https://images.unsplash.com/photo-1564890369478-c89ca6d734cb?w=400', prep_time_minutes: 5, is_available: true, sort_order: 1 },
]

const USERS: (Profile & { email: string; password: string; pin: string | null })[] = [
  { id: 'u-admin', full_name: 'Admin', role: 'admin', is_active: true, email: 'admin@orderflow.uz', password: 'demo1234', pin: null },
  { id: 'u-cashier', full_name: 'Kassir Ali', role: 'cashier', is_active: true, email: 'kassir@orderflow.uz', password: 'demo1234', pin: '0000' },
  { id: 'u-waiter', full_name: 'Ofitsiant Sardor', role: 'waiter', is_active: true, email: 'ofitsiant@orderflow.uz', password: 'demo1234', pin: '1234' },
  { id: 'u-kitchen', full_name: 'Oshpaz', role: 'kitchen', is_active: true, email: 'oshxona@orderflow.uz', password: 'demo1234', pin: '5678' },
]

interface MockState {
  session: { user: Profile } | null
  tables: RestaurantTable[]
  categories: MenuCategory[]
  menu: MenuItem[]
  orders: Order[]
  orderItems: OrderItem[]
  kitchenTickets: KitchenTicket[]
  payments: Payment[]
  notifications: Notification[]
  settings: RestaurantSettings
  cashSession: CashSessionSummary
  orderSeq: number
  ticketSeq: number
  sentKeys: Set<string>
}

const STORAGE_KEY = 'orderflow_mock_state'

function defaultState(): MockState {
  return {
    session: null,
    tables: Array.from({ length: 30 }, (_, i) => ({
      id: `t${i + 1}`,
      number: i + 1,
      name: null,
      status: 'empty' as const,
      current_order_id: null,
      capacity: 4,
      zone: 'Asosiy zal',
      is_active: true,
    })),
    categories: [...DEFAULT_CATEGORIES],
    menu: [...DEFAULT_MENU],
    orders: [],
    orderItems: [],
    kitchenTickets: [],
    payments: [],
    notifications: [],
    settings: {
      id: 's1',
      name: 'Choyxona Premium',
      phone: '+998 90 123 45 67',
      address: 'Toshkent, Amir Temur ko\'chasi 15',
      table_count: 30,
      service_charge_percent: 10,
      tax_percent: 0,
      currency: 'UZS',
      receipt_footer: 'Rahmat!',
    },
    cashSession: {
      total_revenue: 0,
      cash_total: 0,
      card_total: 0,
      click_total: 0,
      payme_total: 0,
      other_total: 0,
      order_count: 0,
    },
    orderSeq: 145,
    ticketSeq: 0,
    sentKeys: new Set(),
  }
}

function loadState(): MockState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultState()
    const parsed = JSON.parse(raw)
    parsed.sentKeys = new Set(parsed.sentKeys ?? [])
    if (!parsed.categories) parsed.categories = [...DEFAULT_CATEGORIES]
    if (!parsed.menu) parsed.menu = [...DEFAULT_MENU]
    return parsed
  } catch {
    return defaultState()
  }
}

function saveState(state: MockState) {
  const toSave = { ...state, sentKeys: [...state.sentKeys] }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
}

class MockStore {
  private state: MockState = defaultState()
  private listeners = new Set<Listener>()

  init() {
    this.state = loadState()
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit() {
    saveState(this.state)
    this.listeners.forEach((fn) => fn())
  }

  getState() {
    return this.state
  }

  signIn(email: string, password: string): Profile | null {
    const user = USERS.find((u) => u.email === email && u.password === password)
    if (!user) return null
    const profile: Profile = { id: user.id, full_name: user.full_name, role: user.role, is_active: user.is_active }
    this.state.session = { user: profile }
    this.emit()
    return profile
  }

  signInWithPin(pin: string): Profile | null {
    const user = USERS.find((u) => u.pin === pin && u.is_active)
    if (!user) return null
    const profile: Profile = { id: user.id, full_name: user.full_name, role: user.role, is_active: user.is_active }
    this.state.session = { user: profile }
    this.emit()
    return profile
  }

  signOut() {
    this.state.session = null
    this.emit()
  }

  getSession(): Profile | null {
    return this.state.session?.user ?? null
  }

  getSettings(): RestaurantSettings {
    return this.state.settings
  }

  getCategories(): MenuCategory[] {
    return this.state.categories.filter((c) => c.is_active).sort((a, b) => a.sort_order - b.sort_order)
  }

  getMenuItems(): MenuItem[] {
    return this.state.menu.filter((m) => m.is_available).sort((a, b) => a.sort_order - b.sort_order)
  }

  getAdminCategories(): MenuCategory[] {
    return [...this.state.categories].sort((a, b) => a.sort_order - b.sort_order)
  }

  getAdminMenuItems(): MenuItem[] {
    return [...this.state.menu].sort((a, b) => a.sort_order - b.sort_order)
  }

  createCategory(input: MenuCategoryInput): MenuCategory {
    const cat: MenuCategory = {
      id: uid(),
      name: input.name,
      slug: input.slug ?? input.name.toLowerCase().replace(/\s+/g, '-'),
      sort_order: input.sort_order ?? this.state.categories.length + 1,
      is_active: input.is_active ?? true,
    }
    this.state.categories.push(cat)
    this.emit()
    return cat
  }

  updateCategory(id: string, input: MenuCategoryInput) {
    const cat = this.state.categories.find((c) => c.id === id)!
    if (input.name) cat.name = input.name
    if (input.slug) cat.slug = input.slug
    if (input.sort_order !== undefined) cat.sort_order = input.sort_order
    if (input.is_active !== undefined) cat.is_active = input.is_active
    this.emit()
  }

  deleteCategory(id: string) {
    this.state.categories = this.state.categories.filter((c) => c.id !== id)
    this.emit()
  }

  createMenuItem(input: MenuItemInput): MenuItem {
    const item: MenuItem = {
      id: uid(),
      category_id: input.category_id,
      name: input.name,
      description: input.description ?? null,
      price: input.price,
      image_url: input.image_url ?? null,
      prep_time_minutes: input.prep_time_minutes,
      is_available: input.is_available,
      sort_order: input.sort_order ?? this.state.menu.length + 1,
    }
    this.state.menu.push(item)
    this.emit()
    return item
  }

  updateMenuItem(id: string, input: MenuItemInput) {
    const item = this.state.menu.find((m) => m.id === id)!
    Object.assign(item, input)
    this.emit()
  }

  deleteMenuItem(id: string) {
    this.state.menu = this.state.menu.filter((m) => m.id !== id)
    this.emit()
  }

  updateSettings(input: SettingsInput) {
    Object.assign(this.state.settings, input)
    this.emit()
  }

  getDailyReport(date: string): DailyReport {
    const orders = this.state.orders.filter((o) => {
      if (o.status !== 'paid' || !o.closed_at) return false
      return o.closed_at.slice(0, 10) === date
    })

    const orderIds = new Set(orders.map((o) => o.id))
    const dayPayments = this.state.payments.filter((p) => orderIds.has(p.order_id))

    const cash = dayPayments.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0)
    const card = dayPayments.filter((p) => p.method === 'card').reduce((s, p) => s + p.amount, 0)
    const online = dayPayments.filter((p) => ['click', 'payme'].includes(p.method)).reduce((s, p) => s + p.amount, 0)
    const other = dayPayments.filter((p) => p.method === 'other').reduce((s, p) => s + p.amount, 0)
    const total = orders.reduce((s, o) => s + o.total, 0)

    const dishCounts: Record<string, { name: string; quantity: number }> = {}
    for (const item of this.state.orderItems) {
      if (!orderIds.has(item.order_id) || item.status === 'cancelled') continue
      const menuItem = this.state.menu.find((m) => m.id === item.menu_item_id)
      const key = item.menu_item_id
      if (!dishCounts[key]) dishCounts[key] = { name: menuItem?.name ?? '—', quantity: 0 }
      dishCounts[key].quantity += item.quantity
    }
    const topDish = Object.values(dishCounts).sort((a, b) => b.quantity - a.quantity)[0] ?? null

    const waiterMap: Record<string, { name: string; total: number; count: number }> = {}
    for (const o of orders) {
      if (!o.waiter_id) continue
      const waiter = USERS.find((u) => u.id === o.waiter_id)
      if (!waiterMap[o.waiter_id]) waiterMap[o.waiter_id] = { name: waiter?.full_name ?? '—', total: 0, count: 0 }
      waiterMap[o.waiter_id].total += o.total
      waiterMap[o.waiter_id].count += 1
    }

    return {
      date,
      total_sales: total,
      order_count: orders.length,
      cash_total: cash,
      card_total: card,
      online_total: online,
      other_total: other,
      average_check: orders.length ? Math.round(total / orders.length) : 0,
      top_dish: topDish,
      waiter_sales: Object.entries(waiterMap).map(([id, w]) => ({
        waiter_id: id,
        waiter_name: w.name,
        total: w.total,
        order_count: w.count,
      })).sort((a, b) => b.total - a.total),
    }
  }

  getWaiterStats(date: string): WaiterStats[] {
    return this.getDailyReport(date).waiter_sales.map((w) => ({
      waiter_id: w.waiter_id,
      waiter_name: w.waiter_name,
      order_count: w.order_count,
      closed_count: w.order_count,
      open_count: 0,
      total_sales: w.total,
      average_check: w.order_count ? Math.round(w.total / w.order_count) : 0,
    }))
  }

  private findMenuItem(id: string) {
    return this.state.menu.find((m) => m.id === id)
  }

  getTables(): RestaurantTable[] {
    return [...this.state.tables].sort((a, b) => a.number - b.number)
  }

  getTable(id: string): RestaurantTable | undefined {
    return this.state.tables.find((t) => t.id === id)
  }

  openTableOrder(tableId: string, waiterId: string): string {
    const table = this.state.tables.find((t) => t.id === tableId)!
    if (table.status === 'empty') {
      const orderId = uid()
      this.state.orderSeq += 1
      const order: Order = {
        id: orderId,
        order_number: String(this.state.orderSeq).padStart(6, '0'),
        order_type: 'dine_in',
        table_id: tableId,
        waiter_id: waiterId,
        created_by: waiterId,
        status: 'open',
        fulfillment_status: null,
        customer_name: null,
        customer_phone: null,
        delivery_address: null,
        delivery_landmark: null,
        delivery_fee: 0,
        discount_amount: 0,
        notes: null,
        payment_method_preference: null,
        scheduled_ready_at: null,
        scheduled_delivery_at: null,
        courier_id: null,
        subtotal: 0,
        service_charge: 0,
        tax_amount: 0,
        total: 0,
        guest_count: 1,
        opened_at: new Date().toISOString(),
        closed_at: null,
        kitchen_ready_at: null,
        dispatched_at: null,
        delivered_at: null,
        picked_up_at: null,
      }
      this.state.orders.push(order)
      table.status = 'occupied'
      table.current_order_id = orderId
      this.emit()
      return orderId
    }
    return table.current_order_id!
  }

  getOrder(id: string): Order | undefined {
    return this.state.orders.find((o) => o.id === id)
  }

  getOrderItems(orderId: string): OrderItem[] {
    return this.state.orderItems
      .filter((i) => i.order_id === orderId)
      .map((i) => ({ ...i, menu_item: this.findMenuItem(i.menu_item_id) }))
  }

  recalcOrder(orderId: string) {
    const order = this.state.orders.find((o) => o.id === orderId)!
    const items = this.state.orderItems.filter((i) => i.order_id === orderId && i.status !== 'cancelled')
    const subtotal = items.reduce((s, i) => s + i.total_price, 0)
    const service = Math.round(subtotal * this.state.settings.service_charge_percent / 100)
    order.subtotal = subtotal
    order.service_charge = service
    order.tax_amount = 0
    order.total = subtotal + service
  }

  sendToKitchen(orderId: string, items: CartItem[], idempotencyKey: string): string {
    if (this.state.sentKeys.has(idempotencyKey)) {
      const existing = this.state.orderItems.find((i) => i.idempotency_key?.startsWith(idempotencyKey))
      return existing?.kitchen_ticket_id ?? ''
    }
    this.state.sentKeys.add(idempotencyKey)

    this.state.ticketSeq += 1
    const ticketId = uid()
    const order = this.state.orders.find((o) => o.id === orderId)!
    const table = order.table_id ? this.state.tables.find((t) => t.id === order.table_id) : undefined

    const ticket: KitchenTicket = {
      id: ticketId,
      ticket_number: this.state.ticketSeq,
      order_id: orderId,
      table_id: order.table_id,
      waiter_id: order.waiter_id,
      order_type: order.order_type,
      status: 'new',
      sent_at: new Date().toISOString(),
      accepted_at: null,
      started_at: null,
      ready_at: null,
    }
    this.state.kitchenTickets.push(ticket)

    for (const item of items) {
      this.state.orderItems.push({
        id: uid(),
        order_id: orderId,
        menu_item_id: item.menu_item_id,
        kitchen_ticket_id: ticketId,
        quantity: item.quantity,
        unit_price: item.menu_item.price,
        total_price: item.menu_item.price * item.quantity,
        notes: item.notes || null,
        status: 'sent',
        sent_to_kitchen_at: new Date().toISOString(),
        idempotency_key: `${idempotencyKey}-${item.menu_item_id}`,
      })
    }

    this.recalcOrder(orderId)
    if (table) table.status = 'has_order'
    order.status = 'open'
    this.emit()
    return ticketId
  }

  getKitchenTickets(): KitchenTicket[] {
    return this.state.kitchenTickets
      .filter((t) => t.status !== 'cancelled')
      .sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime())
      .map((t) => ({
        ...t,
        table: t.table_id ? this.state.tables.find((tb) => tb.id === t.table_id) : undefined,
        waiter: t.waiter_id ? USERS.find((u) => u.id === t.waiter_id) : undefined,
        order: this.state.orders.find((o) => o.id === t.order_id),
        items: this.state.orderItems
          .filter((i) => i.kitchen_ticket_id === t.id)
          .map((i) => ({ ...i, menu_item: this.findMenuItem(i.menu_item_id) })),
      }))
  }

  updateKitchenStatus(ticketId: string, status: KitchenTicket['status']) {
    const ticket = this.state.kitchenTickets.find((t) => t.id === ticketId)!
    ticket.status = status
    const now = new Date().toISOString()
    if (status === 'accepted') ticket.accepted_at = now
    if (status === 'in_progress') {
      ticket.started_at = now
      const table = ticket.table_id ? this.state.tables.find((t) => t.id === ticket.table_id) : undefined
      if (table) table.status = 'preparing'
    }
    if (status === 'ready') {
      ticket.ready_at = now
      const notifyUserId = ticket.waiter_id ?? this.state.orders.find((o) => o.id === ticket.order_id)?.created_by
      if (notifyUserId) {
        const table = ticket.table_id ? this.state.tables.find((t) => t.id === ticket.table_id) : undefined
        const tableNum = table?.number
        this.state.notifications.unshift({
          id: uid(),
          user_id: notifyUserId,
          type: 'order_ready',
          title: 'Buyurtma tayyor!',
          body: tableNum ? `🔔 Stol ${tableNum} buyurtmasi tayyor!` : 'Buyurtma tayyor!',
          data: { ticket_id: ticketId, table_id: ticket.table_id },
          is_read: false,
          created_at: now,
        })
      }
      const allReady = this.state.kitchenTickets
        .filter((t) => t.order_id === ticket.order_id && t.status !== 'cancelled')
        .every((t) => t.status === 'ready')
      if (allReady && ticket.table_id) {
        const tbl = this.state.tables.find((t) => t.id === ticket.table_id)
        if (tbl) tbl.status = 'ready'
      }
    }
    this.state.orderItems
      .filter((i) => i.kitchen_ticket_id === ticketId)
      .forEach((i) => {
        if (status === 'accepted') i.status = 'accepted'
        if (status === 'in_progress') i.status = 'in_progress'
        if (status === 'ready') i.status = 'ready'
      })
    this.emit()
  }

  getNotifications(userId: string): Notification[] {
    return this.state.notifications.filter((n) => n.user_id === userId)
  }

  markNotificationRead(id: string) {
    const n = this.state.notifications.find((x) => x.id === id)
    if (n) n.is_read = true
    this.emit()
  }

  getOpenOrders(): Order[] {
    return this.state.orders.filter((o) => ['open', 'awaiting_payment'].includes(o.status))
  }

  getPayments(orderId: string): Payment[] {
    return this.state.payments.filter((p) => p.order_id === orderId)
  }

  addPayment(orderId: string, amount: number, method: Payment['method'], idempotencyKey?: string, cashierId?: string) {
    if (idempotencyKey && this.state.payments.some((p) => p.idempotency_key === idempotencyKey)) {
      return
    }
    const order = this.state.orders.find((o) => o.id === orderId)!
    this.state.payments.push({
      id: uid(),
      order_id: orderId,
      amount,
      method,
      status: 'completed',
      cashier_id: cashierId ?? 'u-cashier',
      idempotency_key: idempotencyKey,
      created_at: new Date().toISOString(),
    })

    const paid = this.state.payments.filter((p) => p.order_id === orderId).reduce((s, p) => s + p.amount, 0)
    if (paid >= order.total) {
      this.closeOrder(orderId)
    } else {
      order.status = 'awaiting_payment'
      this.state.tables.find((t) => t.id === order.table_id)!.status = 'awaiting_payment'
    }
    this.emit()
  }

  closeOrder(orderId: string) {
    const order = this.state.orders.find((o) => o.id === orderId)!
    order.status = 'paid'
    order.closed_at = new Date().toISOString()
    const table = this.state.tables.find((t) => t.id === order.table_id)!
    table.status = 'empty'
    table.current_order_id = null

    const payments = this.state.payments.filter((p) => p.order_id === orderId)
    this.state.cashSession.order_count += 1
    this.state.cashSession.total_revenue += order.total
    for (const p of payments) {
      const key = `${p.method}_total` as keyof CashSessionSummary
      if (key in this.state.cashSession && typeof this.state.cashSession[key] === 'number') {
        (this.state.cashSession[key] as number) += p.amount
      }
    }
    this.emit()
  }

  requestBill(orderId: string) {
    const order = this.state.orders.find((o) => o.id === orderId)!
    order.status = 'awaiting_payment'
    this.state.tables.find((t) => t.id === order.table_id)!.status = 'awaiting_payment'
    this.emit()
  }

  getCashSession(): CashSessionSummary {
    return { ...this.state.cashSession }
  }

  resetDemo() {
    this.state = defaultState()
    this.emit()
  }

  bootstrapStaff() {
    return USERS.map((u) => ({
      email: u.email,
      role: u.role,
      password: u.password,
      pin: u.pin,
    }))
  }

  listStaff(): (Profile & { email: string; has_pin: boolean })[] {
    return USERS.map((u) => ({
      id: u.id,
      full_name: u.full_name,
      role: u.role,
      is_active: u.is_active,
      email: u.email,
      has_pin: Boolean(u.pin),
    }))
  }

  createStaff(input: { email: string; password: string; full_name: string; role: UserRole; pin?: string | null }) {
    const id = uid()
    USERS.push({
      id,
      full_name: input.full_name,
      role: input.role,
      is_active: true,
      email: input.email,
      password: input.password,
      pin: input.pin ?? null,
    })
    this.emit()
    return id
  }

  updateStaff(input: { profile_id: string; full_name?: string; role?: UserRole; is_active?: boolean }) {
    const user = USERS.find((u) => u.id === input.profile_id)
    if (!user) return
    if (input.full_name !== undefined) user.full_name = input.full_name
    if (input.role !== undefined) user.role = input.role
    if (input.is_active !== undefined) user.is_active = input.is_active
    this.emit()
  }

  resetStaffPassword(profileId: string, password: string) {
    const user = USERS.find((u) => u.id === profileId)
    if (user) user.password = password
  }

  setStaffPin(profileId: string, pin: string | null) {
    const user = USERS.find((u) => u.id === profileId)
    if (user) user.pin = pin
  }

  getTableSummaries(activeOnly = true): import('@/types/database').TableSummary[] {
    const tables = activeOnly ? this.state.tables.filter((t) => t.is_active) : this.state.tables
    return tables.map((t) => {
      const order = t.current_order_id
        ? this.state.orders.find((o) => o.id === t.current_order_id)
        : null
      const items = order
        ? this.state.orderItems.filter((i) => i.order_id === order.id && i.status !== 'cancelled')
        : []
      const paid = order
        ? this.state.payments.filter((p) => p.order_id === order.id).reduce((s, p) => s + p.amount, 0)
        : 0
      const waiter = order ? USERS.find((u) => u.id === order.waiter_id) : null
      return {
        id: t.id,
        number: t.number,
        name: t.name,
        status: t.status,
        capacity: t.capacity,
        zone: t.zone,
        is_active: t.is_active,
        current_order_id: t.current_order_id,
        order_number: order?.order_number ?? null,
        waiter_id: order?.waiter_id ?? null,
        order_status: order?.status ?? null,
        order_total: order?.total ?? 0,
        guest_count: order?.guest_count ?? null,
        opened_at: order?.opened_at ?? null,
        waiter_name: waiter?.full_name ?? null,
        item_count: items.length,
        paid_total: paid,
        balance_due: Math.max((order?.total ?? 0) - paid, 0),
        reservation_id: null,
        reservation_name: null,
        reservation_phone: null,
        reserved_for: null,
        reservation_guests: null,
        reservation_notes: null,
      }
    })
  }
}

export const mockStore = new MockStore()
mockStore.init()

export function getDemoUserByRole(role: UserRole) {
  return USERS.find((u) => u.role === role)
}
