import { create } from 'zustand'
import { USE_MOCK, getSupabase } from '@/lib/supabase'
import { pickActive, uniqueMemberships } from '@/lib/tenant/pickActive'
import { readHintedRestaurantSlug } from '@/lib/tenant/resolve'
import { useCartStore } from '@/stores/cartStore'
import { clearQueueForOtherRestaurants } from '@/lib/offline/queue'
import type { UserRole } from '@/types/database'
import type { TenantMembership } from '@/types/tenant'

export { pickActive, uniqueMemberships, shouldShowRestaurantPicker } from '@/lib/tenant/pickActive'

const STORAGE_PREFIX = 'orderflow.activeRestaurant.'

interface TenantState {
  loading: boolean
  memberships: TenantMembership[]
  active: TenantMembership | null
  hintedSlug: string | null
  userId: string | null
  loadForUser: (userId: string, fallbackRole: UserRole) => Promise<void>
  selectRestaurant: (restaurantId: string) => boolean
  setHintedSlug: (slug: string | null) => void
  reset: () => void
}

function storedId(userId: string): string | null {
  try {
    return sessionStorage.getItem(STORAGE_PREFIX + userId)
  } catch {
    return null
  }
}

function persistId(userId: string, restaurantId: string) {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + userId, restaurantId)
  } catch {
    /* ignore */
  }
}


function onTenantChanged(next: TenantMembership | null) {
  useCartStore.getState().clear()
  clearQueueForOtherRestaurants(next?.restaurantId ?? null)
}

export const useTenantStore = create<TenantState>((set, get) => ({
  loading: false,
  memberships: [],
  active: null,
  hintedSlug: null,
  userId: null,

  setHintedSlug: (slug) => set({ hintedSlug: slug }),

  reset: () => {
    onTenantChanged(null)
    set({ loading: false, memberships: [], active: null, userId: null })
  },

  selectRestaurant: (restaurantId) => {
    const { memberships, userId } = get()
    const match = uniqueMemberships(memberships, userId).find((m) => m.restaurantId === restaurantId)
    if (!match) return false
    if (userId) persistId(userId, match.restaurantId)
    if (get().active?.restaurantId !== match.restaurantId) onTenantChanged(match)
    set({ active: match })
    return true
  },

  loadForUser: async (userId, fallbackRole) => {
    set({ loading: true, userId })
    const hintedSlug = get().hintedSlug ?? readHintedRestaurantSlug()

    try {
      const memberships = uniqueMemberships(
        USE_MOCK
          ? mockMemberships(userId, fallbackRole)
          : await fetchMemberships(userId, fallbackRole),
        userId,
        fallbackRole,
      )

      const active = pickActive(memberships, userId, hintedSlug, storedId(userId), fallbackRole)
      if (active && userId) persistId(userId, active.restaurantId)
      if (get().active?.restaurantId !== active?.restaurantId) onTenantChanged(active)
      set({ memberships, active, loading: false, hintedSlug })
    } catch {
      set({ memberships: [], active: null, loading: false })
    }
  },
}))

export function getActiveRestaurantId(): string | null {
  return useTenantStore.getState().active?.restaurantId ?? null
}

async function fetchMemberships(userId: string, fallbackRole: UserRole): Promise<TenantMembership[]> {
  const sb = getSupabase()
  const { data: sessionData } = await sb.auth.getUser()
  const uid = sessionData.user?.id
  if (!uid) return []

  const { data, error } = await sb
    .from('restaurant_members')
    .select('user_id, role, restaurant_id, restaurants ( id, slug, name )')
    .eq('is_active', true)
    .eq('user_id', uid)

  if (error) throw error

  const pending: TenantMembership[] = []
  const missingIds: string[] = []

  for (const row of data ?? []) {
    if (row.user_id && row.user_id !== uid) continue
    if (userId && row.user_id && row.user_id !== userId) continue
    const restaurantId = row.restaurant_id as string | undefined
    if (!restaurantId) continue
    const restaurant = unwrapRestaurant(row.restaurants)
    if (restaurant?.slug) {
      pending.push({
        restaurantId,
        slug: restaurant.slug,
        name: restaurant.name,
        role: (row.role as UserRole) || fallbackRole,
        userId: uid,
      })
    } else {
      missingIds.push(restaurantId)
      pending.push({
        restaurantId,
        slug: '',
        name: '',
        role: (row.role as UserRole) || fallbackRole,
        userId: uid,
      })
    }
  }

  if (missingIds.length > 0) {
    const { data: restaurants } = await sb
      .from('restaurants')
      .select('id, slug, name')
      .in('id', [...new Set(missingIds)])
    const extras = new Map((restaurants ?? []).map((r) => [r.id as string, r]))
    for (let i = 0; i < pending.length; i++) {
      const extra = extras.get(pending[i].restaurantId)
      if (extra) {
        pending[i] = {
          ...pending[i],
          slug: extra.slug,
          name: extra.name,
        }
      }
    }
  }

  const rows = uniqueMemberships(pending, uid, fallbackRole)
  if (rows.length > 0) return rows

  const { data: rid, error: rpcError } = await sb.rpc('get_current_restaurant_id')
  if (rpcError || !rid) return []
  const { data: restaurant } = await sb
    .from('restaurants')
    .select('id, slug, name')
    .eq('id', rid as string)
    .maybeSingle()
  if (!restaurant) return []
  return [{
    restaurantId: restaurant.id,
    slug: restaurant.slug,
    name: restaurant.name,
    role: fallbackRole,
    userId: uid,
  }]
}

function unwrapRestaurant(value: unknown): { id: string; slug: string; name: string } | null {
  if (!value) return null
  if (Array.isArray(value)) return (value[0] as { id: string; slug: string; name: string } | undefined) ?? null
  return value as { id: string; slug: string; name: string }
}

function mockMemberships(userId: string, role: UserRole): TenantMembership[] {
  return [{
    restaurantId: 'r-mock',
    slug: 'orderflow',
    name: 'OrderFlow',
    role,
    userId,
  }]
}
