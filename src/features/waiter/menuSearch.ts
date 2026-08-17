import type { MenuItem } from '@/types/database'

export function normalizeMenuQuery(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[ʻʼ''`´]/g, "'")
    .replace(/o['']/g, 'o')
    .replace(/g['']/g, 'g')
    .replace(/ё/g, 'е')
    .trim()
}

export function filterMenuItems(
  items: MenuItem[],
  options: {
    search: string
    categoryId: string | null
    categoryNameById: Map<string, string>
    recentIds: string[]
    favoriteIds: Set<string>
    quick: 'none' | 'bestsellers' | 'recent' | 'favorites'
  },
): MenuItem[] {
  const { search, categoryId, categoryNameById, recentIds, favoriteIds, quick } = options

  if (quick === 'bestsellers') return []

  let list = items
  if (quick === 'recent') {
    const byId = new Map(items.map((item) => [item.id, item]))
    list = recentIds.reduce<MenuItem[]>((acc, id) => {
      const item = byId.get(id)
      if (item) acc.push(item)
      return acc
    }, [])
  } else if (quick === 'favorites') {
    list = items.filter((item) => favoriteIds.has(item.id))
  }

  if (categoryId) {
    list = list.filter((item) => item.category_id === categoryId)
  }

  const q = normalizeMenuQuery(search)
  if (!q) return list

  return list.filter((item) => {
    const categoryName = categoryNameById.get(item.category_id) ?? ''
    return (
      normalizeMenuQuery(item.name).includes(q) ||
      normalizeMenuQuery(item.description ?? '').includes(q) ||
      normalizeMenuQuery(categoryName).includes(q)
    )
  })
}
