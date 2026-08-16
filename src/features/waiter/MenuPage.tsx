import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getCategories, getMenuItems, getTable } from '@/lib/api'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { useCartStore } from '@/stores/cartStore'
import { formatCurrency } from '@/lib/format'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CartDrawer } from './CartDrawer'
import type { MenuCategory, MenuItem } from '@/types/database'

export function MenuPage() {
  const { tableId } = useParams<{ tableId: string }>()
  const navigate = useNavigate()
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [cartOpen, setCartOpen] = useState(false)
  const [tableNumber, setTableNumber] = useState<number | null>(null)

  const addItem = useCartStore((s) => s.addItem)
  const cartCount = useCartStore((s) => s.count())
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
    if (!activeCategory && cats.length) setActiveCategory(cats[0].id)
  }, [tableId, activeCategory])

  useRealtimeRefresh(refresh, [refresh])

  const filtered = useMemo(() => {
    let list = items
    if (activeCategory) list = list.filter((i) => i.category_id === activeCategory)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((i) => i.name.toLowerCase().includes(q))
    }
    return list
  }, [items, activeCategory, search])

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
      <header className="sticky top-0 z-20 bg-surface/95 backdrop-blur border-b border-border px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <button onClick={() => navigate('/waiter/tables')} className="text-sm text-muted">← Stollar</button>
          <h1 className="font-bold">Stol {tableNumber}</h1>
          <button
            onClick={() => setCartOpen(true)}
            className="relative h-10 w-10 rounded-full bg-brand-600 text-white flex items-center justify-center font-bold"
          >
            🛒
            {cartCount > 0 && (
              <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-[10px] flex items-center justify-center">
                {cartCount}
              </span>
            )}
          </button>
        </div>

        <input
          type="search"
          placeholder="Qidirish..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full h-10 px-4 rounded-xl border border-border bg-surface-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/40"
        />

        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
          <button
            onClick={() => setActiveCategory(null)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium ${
              !activeCategory ? 'bg-brand-600 text-white' : 'bg-surface-2 text-muted'
            }`}
          >
            Barchasi
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium ${
                activeCategory === cat.id ? 'bg-brand-600 text-white' : 'bg-surface-2 text-muted'
              }`}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 p-3 grid grid-cols-2 gap-3 content-start">
        {filtered.map((item) => (
          <button
            key={item.id}
            onClick={() => addItem(item)}
            className="text-left rounded-2xl border border-border bg-surface overflow-hidden active:scale-[0.98] transition-transform"
          >
            <div className="aspect-[4/3] bg-slate-100 dark:bg-slate-800 overflow-hidden">
              {item.image_url ? (
                <img
                  src={item.image_url}
                  alt={item.name}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-3xl">🍽️</div>
              )}
            </div>
            <div className="p-2.5 space-y-1">
              <p className="font-semibold text-sm leading-tight line-clamp-2">{item.name}</p>
              <div className="flex items-center justify-between">
                <span className="text-brand-600 font-bold text-sm">{formatCurrency(item.price)}</span>
                <Badge className="bg-slate-100 dark:bg-slate-800 text-muted text-[10px]">
                  {item.prep_time_minutes} daq
                </Badge>
              </div>
            </div>
          </button>
        ))}
      </div>

      {cartCount > 0 && (
        <div className="sticky bottom-20 px-4 pb-2">
          <Button size="xl" className="w-full shadow-lg" onClick={() => setCartOpen(true)}>
            Savat ({cartCount}) — Ko'rish
          </Button>
        </div>
      )}

      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
    </div>
  )
}
