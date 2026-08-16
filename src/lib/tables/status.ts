import type { TableStatus } from '@/types/database'

/** Admin panel display categories (5 states) */
export type TableDisplayCategory =
  | 'empty'
  | 'occupied'
  | 'reserved'
  | 'awaiting_payment'
  | 'cleaning'

export const DISPLAY_CATEGORY_META: Record<
  TableDisplayCategory,
  { label: string; emoji: string; color: string; badge: string }
> = {
  empty: {
    label: 'Bo\'sh',
    emoji: '🟢',
    color: 'border-green-300 bg-green-50 dark:bg-green-950/30',
    badge: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  },
  occupied: {
    label: 'Band',
    emoji: '🔴',
    color: 'border-red-300 bg-red-50 dark:bg-red-950/30',
    badge: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  },
  reserved: {
    label: 'Bron qilingan',
    emoji: '🟡',
    color: 'border-yellow-300 bg-yellow-50 dark:bg-yellow-950/30',
    badge: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300',
  },
  awaiting_payment: {
    label: 'Hisob so\'ralgan',
    emoji: '🟠',
    color: 'border-orange-300 bg-orange-50 dark:bg-orange-950/30',
    badge: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  },
  cleaning: {
    label: 'Tozalash',
    emoji: '🔵',
    color: 'border-blue-300 bg-blue-50 dark:bg-blue-950/30',
    badge: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  },
}

export function getDisplayCategory(status: TableStatus): TableDisplayCategory {
  switch (status) {
    case 'empty':
      return 'empty'
    case 'reserved':
      return 'reserved'
    case 'awaiting_payment':
      return 'awaiting_payment'
    case 'cleaning':
      return 'cleaning'
    default:
      return 'occupied'
  }
}

export function formatElapsed(fromIso: string | null): string {
  if (!fromIso) return ''
  const ms = Date.now() - new Date(fromIso).getTime()
  if (ms < 0) return '00:00'
  const mins = Math.floor(ms / 60000)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:00`
}

export function formatTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })
}

export const ORDER_ITEM_STATUS_LABELS: Record<string, string> = {
  pending: 'Yangi',
  sent: 'Oshxonada',
  accepted: 'Oshxonada',
  in_progress: 'Oshxonada',
  ready: 'Tayyor',
  served: 'Yetkazildi',
  cancelled: 'Bekor qilindi',
}

export const TABLE_ZONES = ['Asosiy zal', 'VIP', 'Terassa'] as const

export type TableFilterCategory = TableDisplayCategory | 'all'

export function countByCategory<T extends { status: TableStatus }>(
  rows: T[],
): Record<TableDisplayCategory, number> & { total: number } {
  const counts: Record<TableDisplayCategory, number> = {
    empty: 0,
    occupied: 0,
    reserved: 0,
    awaiting_payment: 0,
    cleaning: 0,
  }
  for (const row of rows) {
    if ('is_active' in row && row.is_active === false) continue
    counts[getDisplayCategory(row.status)]++
  }
  return { ...counts, total: rows.filter((r) => !('is_active' in r) || r.is_active !== false).length }
}
