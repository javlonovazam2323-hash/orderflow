import { Link } from 'react-router-dom'
import { canCreateRestaurant } from '@/lib/tenant/access'
import { uniqueMemberships } from '@/lib/tenant/pickActive'
import { useTenantStore } from '@/stores/tenantStore'

export function RestaurantSwitcher({ className = '' }: { className?: string }) {
  const userId = useTenantStore((s) => s.userId)
  const memberships = uniqueMemberships(useTenantStore((s) => s.memberships), userId)
  const active = useTenantStore((s) => s.active)
  const selectRestaurant = useTenantStore((s) => s.selectRestaurant)
  const showCreate = canCreateRestaurant(memberships)

  if (memberships.length <= 1) return null

  return (
    <div className={className}>
      <label className="block">
        <span className="sr-only">Restoran</span>
        <select
          value={active?.restaurantId ?? ''}
          onChange={(e) => selectRestaurant(e.target.value)}
          className="max-w-full rounded-lg border border-border bg-surface px-2 py-1 text-sm"
        >
          {!active && <option value="">Restoran tanlang</option>}
          {memberships.map((m) => (
            <option key={m.restaurantId} value={m.restaurantId}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      {showCreate && (
        <Link to="/setup" className="mt-1 inline-block text-xs font-medium text-brand-600 hover:underline">
          + Yangi restoran
        </Link>
      )}
    </div>
  )
}
