import type { TenantMembership } from '@/types/tenant'

/** New owner (no memberships) or an existing restaurant admin. Waiter/cashier/kitchen cannot create. */
export function canCreateRestaurant(memberships: TenantMembership[]): boolean {
  return memberships.length === 0 || memberships.some((m) => m.role === 'admin')
}
