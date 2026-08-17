import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getCategories, getDraftCartItems, getMenuItems, getTable, upsertDraftCartItem } from '@/lib/api'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { useCartStore } from '@/stores/cartStore'
import { USE_MOCK } from '@/lib/supabase'
import { formatCurrency } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { CartDrawer } from './CartDrawer'
import { MenuItemTile } from './MenuItemTile'
import { filterMenuItems } from './menuSearch'
import { pushRecentId, readFavoriteIds, readRecentIds, toggleFavoriteId } from './menuShortcuts'
import type { MenuCategory, MenuItem } from '@/types/database'

type QuickFilter = 'none' | 'bestsellers' | 'recent' | 'favorites'

const QUICK_FILTERS: { id: Exclude<QuickFilter, 'none'>; label: string }[] = [
  { id: 'bestsellers', label: '⭐ Ko‘p sotilganlar' },
  { id: 'recent', label: '🕘 Oxirgi tanlanganlar' },
  { id: 'favorites', label: '❤️ Sevimlilar' },
]

export function MenuPage() {
  const { tableId } = useParams<{ tableId: string }>()
  const navigate = useNavigate()
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [quick, setQuick] = useState<QuickFilter>('none')
  const [search, setSearch] = useState('')
  const [cartOpen, setCartOpen] = useState(false)
  const [tableNumber, setTableNumber] = useState<number | null>(null)
  const [recentIds, setRecentIds] = useState(readRecentIds)
  const [favoriteIds, setFavoriteIds] = useState(readFavoriteIds)

  const addItem = useCartStore((s) => s.addItem)
  const hydrateItems = useCartStore((s) => s.hydrateItems)
  const cartCount = useCartStore((s) => s.items.reduce((n, item) => n + item.quantity, 0))
  const cartTotal = useCartStore((s) => s.items.reduce((n, item) => n + item.menu_item.price * item.quantity, 0))
  const orderId = useCartStore((s) => s.orderId)

  const refresh = useCallback(async () => {
    const [cats, menu, table] = await Promise.all([
      getCategories(),
      getMenuItems(),
      tableId ? getTable(tableId) : Promise.resolve(undefined),
    ])
    setCategories(cats)
    setItems(menu)
    if (table) setTableNumber(table.number)
    if (orderId && !USE_MOCK) {
      hydrateItems(await getDraftCartItems(orderId))
    }
  }, [tableId, orderId, hydrateItems])

  useRealtimeRefresh(refresh, [refresh])

  const categoryNameById = useMemo(
    () => new Map(categories.map((cat) => [cat.id, cat.name])),
    [categories],
  )

  const filtered = useMemo(
    () =>
      filterMenuItems(items, {
        search,
        categoryId: activeCategory,
        categoryNameById,
        recentIds,
        favoriteIds,
        quick,
      }),
    [items, search, activeCategory, categoryNameById, recentIds, favoriteIds, quick],
  )

  const handleAdd = useCallback(
    async (item: MenuItem) => {
      addItem(item)
      setRecentIds(pushRecentId(item.id))
      const state = useCartStore.getState()
      if (!state.orderId || USE_MOCK) return
      const row = state.items.find((i) => i.menu_item_id === item.id)
      if (!row) return
      try {
        await upsertDraftCartItem(state.orderId, row.menu_item_id, row.quantity, row.notes)
      } catch {
        if (state.orderId) hydrateItems(await getDraftCartItems(state.orderId))
      }
    },
    [addItem, hydrateItems],
  )

  const handleToggleFavorite = useCallback((item: MenuItem) => {
    setFavoriteIds(toggleFavoriteId(item.id))
  }, [])

  const emptyMessage = (() => {
    if (quick === 'bestsellers') return 'Sotuv statistikasi hali ulanmagan'
    if (quick === 'recent') return 'Hali tanlov yo‘q — taom qo‘shing'
    if (quick === 'favorites') return 'Sevimlilarga qo‘shish uchun 🤍 ni bosing'
    if (search.trim()) return 'Hech narsa topilmadi'
    return 'Menyu bo‘sh'
  })()

  if (!tableId || !orderId) {
    return (
      <div className="p-6 text-center space-y-4">
        <p className="text-muted">Avval stol tanlang</p>
        <Button onClick={() => navigate('/waiter/tables')}>Stollarga qaytish</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-[calc(100vh-5rem)]">
      <header className="sticky top-0 z-20 bg-surface/95 backdrop-blur border-b border-border px-3 pt-2 pb-2 space-y-2">
        <div className="flex items-center justify-between">
          <button onClick={() => navigate('/waiter/tables')} className="text-sm text-muted">← Stollar</button>
          <h1 className="font-bold text-sm">Stol {tableNumber}</h1>
          <button
            onClick={() => setCartOpen(true)}
            className="relative h-9 w-9 rounded-full bg-brand-600 text-white flex items-center justify-center text-sm"
          >
            🛒
            {cartCount > 0 && (
              <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-[10px] flex items-center justify-center">
                {cartCount}
              </span>
            )}
          </button>
        </div>

        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted text-sm pointer-events-none">🔍</span>
          <input
            type="text"
            inputMode="search"
            placeholder="Taom qidirish..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-9 pl-9 pr-9 rounded-xl border border-border bg-surface-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
          />
          {search ? (
            <button
              type="button"
              aria-label="Qidiruvni tozalash"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full text-muted text-sm"
            >
              ✕
            </button>
          ) : null}
        </div>

        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
          {QUICK_FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setQuick((current) => (current === item.id ? 'none' : item.id))}
              className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium ${
                quick === item.id ? 'bg-brand-600 text-white' : 'bg-surface-2 text-muted'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
          <button
            type="button"
            onClick={() => setActiveCategory(null)}
            className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium ${
              !activeCategory ? 'bg-brand-600 text-white' : 'bg-surface-2 text-muted'
            }`}
          >
            Barchasi
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCategory(cat.id)}
              className={`shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium ${
                activeCategory === cat.id ? 'bg-brand-600 text-white' : 'bg-surface-2 text-muted'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 p-2 pb-24 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 content-start">
        {filtered.length === 0 ? (
          <p className="col-span-full text-center text-sm text-muted py-10">{emptyMessage}</p>
        ) : (
          filtered.map((item) => (
            <MenuItemTile
              key={item.id}
              item={item}
              favorite={favoriteIds.has(item.id)}
              onAdd={handleAdd}
              onToggleFavorite={handleToggleFavorite}
            />
          ))
        )}
      </div>

      {cartCount > 0 && (
        <div className="sticky bottom-20 z-30 px-3 pb-2">
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="w-full h-12 rounded-xl bg-brand-600 text-white shadow-lg px-4 flex items-center justify-between text-sm font-semibold"
          >
            <span>
              {cartCount} ta mahsulot · {formatCurrency(cartTotal)}
            </span>
            <span>Savat →</span>
          </button>
        </div>
      )}

      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
    </div>
  )
}
