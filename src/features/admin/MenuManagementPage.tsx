import { Link } from 'react-router-dom'
import { useCallback, useState } from 'react'
import {
  createCategory,
  createMenuItem,
  deleteCategory,
  deleteMenuItem,
  getAdminCategories,
  getAdminMenuItems,
  updateCategory,
  updateMenuItem,
} from '@/lib/api/admin'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { formatCurrency } from '@/lib/format'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import type { MenuCategory, MenuItem, MenuCategoryInput, MenuItemInput } from '@/types/database'

export function MenuManagementPage() {
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  const [activeCat, setActiveCat] = useState<string | null>(null)
  const [itemModal, setItemModal] = useState<MenuItem | null | 'new'>(null)
  const [catModal, setCatModal] = useState<MenuCategory | null | 'new'>(null)
  const [saving, setSaving] = useState(false)

  const refresh = useCallback(async () => {
    const [cats, menu] = await Promise.all([getAdminCategories(), getAdminMenuItems()])
    setCategories(cats)
    setItems(menu)
    if (!activeCat && cats.length) setActiveCat(cats[0].id)
  }, [activeCat])

  useRealtimeRefresh(refresh, [refresh])

  const filtered = activeCat ? items.filter((i) => i.category_id === activeCat) : items

  const handleSaveItem = async (data: MenuItemInput, id?: string) => {
    setSaving(true)
    try {
      if (id) await updateMenuItem(id, data)
      else await createMenuItem(data)
      setItemModal(null)
      refresh()
    } finally {
      setSaving(false)
    }
  }

  const handleSaveCategory = async (data: MenuCategoryInput, id?: string) => {
    setSaving(true)
    try {
      if (id) await updateCategory(id, data)
      else await createCategory(data)
      setCatModal(null)
      refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Menyu boshqaruvi</h1>
          <p className="text-sm text-muted">Kategoriyalar va mahsulotlar</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setCatModal('new')}>+ Kategoriya</Button>
          <Button size="sm" onClick={() => setItemModal('new')}>+ Mahsulot</Button>
        </div>
      </header>

      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCat(cat.id)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium ${
              activeCat === cat.id ? 'bg-brand-600 text-white' : 'bg-surface-2 text-muted'
            }`}
          >
            {cat.name}
            {!cat.is_active && ' (off)'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((item) => (
          <Card key={item.id}>
            <CardContent className="pt-3 space-y-2">
              <div className="flex gap-3">
                <div className="w-16 h-16 rounded-xl overflow-hidden bg-surface-2 shrink-0">
                  {item.image_url ? (
                    <img src={item.image_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">🍽️</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{item.name}</p>
                  <p className="text-brand-600 font-bold text-sm">{formatCurrency(item.price)}</p>
                  <div className="flex gap-1 mt-1">
                    <Badge className={item.is_available ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}>
                      {item.is_available ? 'Mavjud' : 'Yo\'q'}
                    </Badge>
                    <Badge className="bg-surface-2 text-muted">{item.prep_time_minutes} daq</Badge>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="flex-1" onClick={() => setItemModal(item)}>Tahrirlash</Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (confirm('O\'chirish?')) { await deleteMenuItem(item.id); refresh() }
                  }}
                >
                  🗑
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {catModal && (
        <CategoryFormModal
          category={catModal === 'new' ? null : catModal}
          saving={saving}
          onClose={() => setCatModal(null)}
          onSave={handleSaveCategory}
          onDelete={catModal !== 'new' ? async () => {
            if (confirm('Kategoriyani o\'chirish?')) {
              await deleteCategory(catModal.id)
              setCatModal(null)
              refresh()
            }
          } : undefined}
        />
      )}

      {itemModal && (
        <ItemFormModal
          item={itemModal === 'new' ? null : itemModal}
          categories={categories}
          defaultCategoryId={activeCat ?? categories[0]?.id}
          saving={saving}
          onClose={() => setItemModal(null)}
          onSave={handleSaveItem}
        />
      )}
    </div>
  )
}

function CategoryFormModal({
  category, saving, onClose, onSave, onDelete,
}: {
  category: MenuCategory | null
  saving: boolean
  onClose: () => void
  onSave: (data: MenuCategoryInput, id?: string) => void
  onDelete?: () => void
}) {
  const [name, setName] = useState(category?.name ?? '')
  const [sortOrder, setSortOrder] = useState(String(category?.sort_order ?? 0))
  const [isActive, setIsActive] = useState(category?.is_active ?? true)

  return (
    <Modal open onClose={onClose} title={category ? 'Kategoriya tahrirlash' : 'Yangi kategoriya'}>
      <div className="p-4 space-y-4">
        <Input label="Nomi" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input label="Tartib" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Faol
        </label>
        <div className="flex gap-2">
          {onDelete && <Button variant="danger" onClick={onDelete}>O'chirish</Button>}
          <Button className="flex-1" loading={saving} onClick={() => onSave({
            name,
            sort_order: parseInt(sortOrder, 10) || 0,
            is_active: isActive,
          }, category?.id)}>
            Saqlash
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function ItemFormModal({
  item, categories, defaultCategoryId, saving, onClose, onSave,
}: {
  item: MenuItem | null
  categories: MenuCategory[]
  defaultCategoryId?: string
  saving: boolean
  onClose: () => void
  onSave: (data: MenuItemInput, id?: string) => void
}) {
  const [name, setName] = useState(item?.name ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [price, setPrice] = useState(String(item?.price ?? ''))
  const [categoryId, setCategoryId] = useState(item?.category_id ?? defaultCategoryId ?? '')
  const [prepTime, setPrepTime] = useState(String(item?.prep_time_minutes ?? 15))
  const [imageUrl, setImageUrl] = useState(item?.image_url ?? '')
  const [isAvailable, setIsAvailable] = useState(item?.is_available ?? true)

  return (
    <Modal open onClose={onClose} title={item ? 'Mahsulot tahrirlash' : 'Yangi mahsulot'}>
      <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
        <Input label="Nomi" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input label="Tavsif" value={description} onChange={(e) => setDescription(e.target.value)} />
        <Input label="Narxi (so'm)" type="number" value={price} onChange={(e) => setPrice(e.target.value)} required />
        <label className="block space-y-1.5">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">Kategoriya</span>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="w-full h-12 px-4 rounded-xl border border-border bg-surface"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <Input label="Tayyorlanish vaqti (daq)" type="number" value={prepTime} onChange={(e) => setPrepTime(e.target.value)} />
        <Input label="Rasm URL" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://..." />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isAvailable} onChange={(e) => setIsAvailable(e.target.checked)} />
          Mavjud
        </label>
        <Button className="w-full" loading={saving} onClick={() => onSave({
          category_id: categoryId,
          name,
          description: description || null,
          price: parseInt(price, 10) || 0,
          prep_time_minutes: parseInt(prepTime, 10) || 15,
          image_url: imageUrl || null,
          is_available: isAvailable,
        }, item?.id)}>
          Saqlash
        </Button>
      </div>
    </Modal>
  )
}
