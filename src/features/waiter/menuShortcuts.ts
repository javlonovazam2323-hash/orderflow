import { getActiveRestaurantId } from '@/stores/tenantStore'

const RECENT_PREFIX = 'orderflow.menu.recent'
const FAVORITES_PREFIX = 'orderflow.menu.favorites'
const MAX_RECENT = 24

function scopedKey(prefix: string): string {
  const restaurantId = getActiveRestaurantId()
  return restaurantId ? `${prefix}.${restaurantId}` : prefix
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function readRecentIds(): string[] {
  const ids = readJson<string[]>(scopedKey(RECENT_PREFIX), [])
  return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []
}

export function pushRecentId(id: string): string[] {
  const next = [id, ...readRecentIds().filter((item) => item !== id)].slice(0, MAX_RECENT)
  try {
    localStorage.setItem(scopedKey(RECENT_PREFIX), JSON.stringify(next))
  } catch {
    /* ignore quota / private mode */
  }
  return next
}

export function readFavoriteIds(): Set<string> {
  const ids = readJson<string[]>(scopedKey(FAVORITES_PREFIX), [])
  return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [])
}

export function toggleFavoriteId(id: string): Set<string> {
  const next = readFavoriteIds()
  if (next.has(id)) next.delete(id)
  else next.add(id)
  try {
    localStorage.setItem(scopedKey(FAVORITES_PREFIX), JSON.stringify([...next]))
  } catch {
    /* ignore quota / private mode */
  }
  return next
}
