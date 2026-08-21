import type { UserRole } from '@/types/database'

export interface TenantMembership {
  restaurantId: string
  slug: string
  name: string
  role: UserRole
  userId?: string
}

export interface PinLoginOptions {
  restaurantSlug?: string | null
}
