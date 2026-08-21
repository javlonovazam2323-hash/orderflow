import { getActiveRestaurantId } from '@/stores/tenantStore'

export function withRestaurantId<Q>(query: Q): Q {
  const restaurantId = getActiveRestaurantId()
  if (!restaurantId) return query
  return (query as Q & { eq: (column: string, value: string) => Q }).eq('restaurant_id', restaurantId)
}

export function requireRestaurantId(): string {
  const restaurantId = getActiveRestaurantId()
  if (!restaurantId) throw new Error('No active restaurant')
  return restaurantId
}
