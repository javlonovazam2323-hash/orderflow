import { useCallback, useRef, useState } from 'react'
import {
  createCategory,
  createMenuItem,
  deleteCategory,
  getAdminCategories,
  getAdminMenuItems,
  updateCategory,
  updateMenuItem,
} from '@/lib/api/admin'
import { deleteMenuImageFromUrl, uploadMenuImage } from '@/lib/storage/menuImages'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { MenuItemCard } from '@/components/menu/MenuItemCard'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((item) => {
          const cat = categories.find((c) => c.id === item.category_id)
          return (
            <MenuItemCard
              key={item.id}
              item={item}
              category={cat}
              showAdd={false}
              onEdit={() => setItemModal(item)}
            />
          )
        })}
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
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const handleImageUpload = async (file: File) => {
    setUploading(true)
    setUploadError('')
    try {
      if (item?.image_url?.includes('menu-images')) {
        await deleteMenuImageFromUrl(item.image_url).catch(() => {})
      }
      const url = await uploadMenuImage(file, item?.id)
      setImageUrl(url)
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Yuklash xatoligi')
    } finally {
      setUploading(false)
    }
  }

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

        <div className="space-y-2">
          <span className="text-sm font-medium">Rasm yuklash</span>
          <div className="flex gap-3 items-start">
            <div className="w-24 h-24 rounded-xl bg-surface-2 overflow-hidden shrink-0">
              {imageUrl ? (
                <img src={imageUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-2xl text-muted">🍽️</div>
              )}
            </div>
            <div className="flex-1 space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleImageUpload(f)
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={uploading}
                onClick={() => fileRef.current?.click()}
              >
                Rasm tanlash
              </Button>
              <p className="text-xs text-muted">JPG, PNG, WEBP · avtomatik siqiladi</p>
              {uploadError && <p className="text-xs text-red-500">{uploadError}</p>}
            </div>
          </div>
        </div>

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
