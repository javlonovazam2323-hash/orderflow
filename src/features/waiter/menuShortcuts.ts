const RECENT_KEY = 'orderflow.menu.recent'
const FAVORITES_KEY = 'orderflow.menu.favorites'
const MAX_RECENT = 24

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
  const ids = readJson<string[]>(RECENT_KEY, [])
  return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : []
}

export function pushRecentId(id: string): string[] {
  const next = [id, ...readRecentIds().filter((item) => item !== id)].slice(0, MAX_RECENT)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* ignore quota / private mode */
  }
  return next
}

export function readFavoriteIds(): Set<string> {
  const ids = readJson<string[]>(FAVORITES_KEY, [])
  return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [])
}

export function toggleFavoriteId(id: string): Set<string> {
  const next = readFavoriteIds()
  if (next.has(id)) next.delete(id)
  else next.add(id)
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]))
  } catch {
    /* ignore quota / private mode */
  }
  return next
}
