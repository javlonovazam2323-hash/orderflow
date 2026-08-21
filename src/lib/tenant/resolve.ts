const SLUG_QUERY_KEYS = ['restaurant', 'r'] as const

export function readHintedRestaurantSlug(search = window.location.search, hostname = window.location.hostname): string | null {
  const params = new URLSearchParams(search)
  for (const key of SLUG_QUERY_KEYS) {
    const value = params.get(key)?.trim()
    if (value) return value
  }

  const host = hostname.toLowerCase()
  if (host.endsWith('.orderflow.uz')) {
    const sub = host.slice(0, -'.orderflow.uz'.length)
    if (sub && !['www', 'app', 'api'].includes(sub)) return sub
  }

  return null
}

/** Future path helper. Production routes stay unprefixed. */
export function tenantPrefixedPath(slug: string, path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `/r/${slug}${normalized}`
}
