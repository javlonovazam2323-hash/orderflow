import { memo, type MouseEvent } from 'react'
import { formatCurrency } from '@/lib/format'
import type { MenuItem } from '@/types/database'

interface MenuItemTileProps {
  item: MenuItem
  favorite: boolean
  onAdd: (item: MenuItem) => void
  onToggleFavorite: (item: MenuItem) => void
}

function MenuItemTileInner({ item, favorite, onAdd, onToggleFavorite }: MenuItemTileProps) {
  const handleFavorite = (event: MouseEvent) => {
    event.stopPropagation()
    onToggleFavorite(item)
  }

  return (
    <article className="rounded-xl border border-border bg-surface overflow-hidden [content-visibility:auto] [contain-intrinsic-size:auto_148px]">
      <div className="relative h-[4.5rem] sm:h-24 bg-slate-100 dark:bg-slate-800 overflow-hidden">
        {item.image_url ? (
          <img
            src={item.image_url}
            alt=""
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xl">🍽️</div>
        )}
        <button
          type="button"
          aria-label={favorite ? 'Sevimlidan olib tashlash' : 'Sevimlilarga qo‘shish'}
          onClick={handleFavorite}
          className="absolute top-1 right-1 h-8 w-8 rounded-full bg-black/45 text-white text-sm flex items-center justify-center"
        >
          {favorite ? '❤️' : '🤍'}
        </button>
      </div>
      <div className="p-1.5">
        <p className="font-semibold text-[13px] leading-tight line-clamp-2 min-h-[2.1em]">{item.name}</p>
        <div className="mt-1 flex items-end justify-between gap-1">
          <span className="text-[15px] font-extrabold text-brand-600 leading-tight tabular-nums">
            {formatCurrency(item.price)}
          </span>
          <button
            type="button"
            aria-label={`${item.name} qo‘shish`}
            onClick={() => onAdd(item)}
            className="h-11 w-11 shrink-0 rounded-xl bg-brand-600 text-white text-2xl font-bold leading-none flex items-center justify-center active:scale-95"
          >
            +
          </button>
        </div>
      </div>
    </article>
  )
}

export const MenuItemTile = memo(MenuItemTileInner)
