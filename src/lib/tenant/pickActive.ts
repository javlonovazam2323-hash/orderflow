import type { UserRole } from '@/types/database'
import type { TenantMembership } from '@/types/tenant'

const ROLE_RANK: Record<string, number> = {
  admin: 0,
  cashier: 1,
  waiter: 2,
  kitchen: 3,
}

function pickRoleRow(
  a: TenantMembership,
  b: TenantMembership,
  preferredRole?: UserRole,
): TenantMembership {
  if (preferredRole) {
    if (a.role === preferredRole && b.role !== preferredRole) return a
    if (b.role === preferredRole && a.role !== preferredRole) return b
  }
  const ra = ROLE_RANK[a.role] ?? 99
  const rb = ROLE_RANK[b.role] ?? 99
  return rb < ra ? b : a
}

/**
 * One row per restaurant_id, from THIS user's memberships only.
 * Never build the tenant picker from another staff member's role row.
 */
export function uniqueMemberships(
  memberships: TenantMembership[],
  authUserId?: string | null,
  preferredRole?: UserRole,
): TenantMembership[] {
  const own = authUserId
    ? memberships.filter((m) => !m.userId || m.userId === authUserId)
    : memberships
  const byId = new Map<string, TenantMembership>()
  for (const m of own) {
    if (!m.restaurantId) continue
    const prev = byId.get(m.restaurantId)
    if (!prev) {
      byId.set(m.restaurantId, m)
      continue
    }
    byId.set(m.restaurantId, pickRoleRow(prev, m, preferredRole))
  }
  return [...byId.values()]
}

/**
 * Pick the active restaurant from the user's own memberships.
 * - 1 unique restaurant → that membership (auto-select)
 * - 0 → null
 * - >1 → slug or stored id only if it matches a membership; never a forged id
 */
export function pickActive(
  memberships: TenantMembership[],
  userId: string,
  hintedSlug: string | null,
  storedRestaurantId: string | null,
  preferredRole?: UserRole,
): TenantMembership | null {
  const unique = uniqueMemberships(memberships, userId, preferredRole)
  if (unique.length === 1) return unique[0]
  if (unique.length === 0) return null

  if (hintedSlug) {
    const bySlug = unique.find((m) => m.slug === hintedSlug)
    if (bySlug) return bySlug
  }

  if (storedRestaurantId) {
    const byStored = unique.find((m) => m.restaurantId === storedRestaurantId)
    if (byStored) return byStored
  }

  return null
}

export function shouldShowRestaurantPicker(
  memberships: TenantMembership[],
  active: TenantMembership | null,
  authUserId?: string | null,
  preferredRole?: UserRole,
): boolean {
  return uniqueMemberships(memberships, authUserId, preferredRole).length > 1 && !active
}
