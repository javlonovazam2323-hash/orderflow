import { create } from 'zustand'
import type { CartItem, MenuItem } from '@/types/database'

interface CartState {
  tableId: string | null
  orderId: string | null
  items: CartItem[]
  setContext: (tableId: string, orderId: string) => void
  addItem: (item: MenuItem, quantity?: number) => void
  updateQuantity: (menuItemId: string, quantity: number) => void
  updateNotes: (menuItemId: string, notes: string) => void
  removeItem: (menuItemId: string) => void
  clear: () => void
  total: () => number
  count: () => number
}

export const useCartStore = create<CartState>((set, get) => ({
  tableId: null,
  orderId: null,
  items: [],

  setContext: (tableId, orderId) => set({ tableId, orderId }),

  addItem: (menuItem, quantity = 1) => {
    const { items } = get()
    const existing = items.find((i) => i.menu_item_id === menuItem.id)
    if (existing) {
      set({
        items: items.map((i) =>
          i.menu_item_id === menuItem.id
            ? { ...i, quantity: i.quantity + quantity }
            : i,
        ),
      })
    } else {
      set({
        items: [...items, { menu_item_id: menuItem.id, menu_item: menuItem, quantity, notes: '' }],
      })
    }
  },

  updateQuantity: (menuItemId, quantity) => {
    if (quantity <= 0) {
      get().removeItem(menuItemId)
      return
    }
    set({
      items: get().items.map((i) =>
        i.menu_item_id === menuItemId ? { ...i, quantity } : i,
      ),
    })
  },

  updateNotes: (menuItemId, notes) => {
    set({
      items: get().items.map((i) =>
        i.menu_item_id === menuItemId ? { ...i, notes } : i,
      ),
    })
  },

  removeItem: (menuItemId) => {
    set({ items: get().items.filter((i) => i.menu_item_id !== menuItemId) })
  },

  clear: () => set({ items: [], tableId: null, orderId: null }),

  total: () => get().items.reduce((s, i) => s + i.menu_item.price * i.quantity, 0),

  count: () => get().items.reduce((s, i) => s + i.quantity, 0),
}))
