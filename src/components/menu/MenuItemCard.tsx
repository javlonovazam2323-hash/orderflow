import { formatCurrency } from '@/lib/format'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import type { MenuCategory, MenuItem } from '@/types/database'

interface MenuItemCardProps {
  item: MenuItem
  category?: MenuCategory
  onAdd?: (item: MenuItem) => void
  onEdit?: (item: MenuItem) => void
  showAdd?: boolean
}

export function MenuItemCard({ item, category, onAdd, onEdit, showAdd = true }: MenuItemCardProps) {
  return (
    <article className="group rounded-2xl border border-border bg-surface overflow-hidden hover:border-brand-500/40 transition-all hover:shadow-lg">
      <div className="aspect-[4/3] bg-surface-2 relative overflow-hidden">
        {item.image_url ? (
          <img
            src={item.image_url}
            alt={item.name}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl text-muted/40 animate-pulse bg-gradient-to-br from-surface-2 to-surface">
            🍽️
          </div>
        )}
        {category && (
          <Badge className="absolute top-3 left-3 bg-black/60 text-white backdrop-blur-sm border-0">
            {category.name}
          </Badge>
        )}
        {!item.is_available && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="text-white font-semibold text-sm">Mavjud emas</span>
          </div>
        )}
      </div>
      <div className="p-4 space-y-3">
        <div>
          <h3 className="font-bold text-lg leading-tight">{item.name}</h3>
          {item.description && (
            <p className="text-sm text-muted line-clamp-2 mt-1">{item.description}</p>
          )}
        </div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xl font-black text-brand-500">{formatCurrency(item.price)}</p>
          {onEdit && (
            <Button size="sm" variant="outline" onClick={() => onEdit(item)}>
              Tahrirlash
            </Button>
          )}
          {showAdd && onAdd && item.is_available && (
            <Button size="lg" className="min-w-[120px]" onClick={() => onAdd(item)}>
              + Zakazga
            </Button>
          )}
        </div>
      </div>
    </article>
  )
}
