import { useLayoutEffect } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import { useTenant, useTenantReady } from '@/hooks/useTenant'
import { RestaurantSwitcher } from '@/components/layout/RestaurantSwitcher'
import { ROLE_HOME } from '@/lib/constants'
import { shouldShowRestaurantPicker, uniqueMemberships } from '@/lib/tenant/pickActive'
import type { UserRole } from '@/types/database'

interface RoleGuardProps {
  allowed: UserRole[]
}

export function RoleGuard({ allowed }: RoleGuardProps) {
  const { user, loading } = useAuth()
  const { active, memberships, selectRestaurant } = useTenant()
  const tenantReady = useTenantReady(user?.id)
  const restaurants = uniqueMemberships(memberships, user?.id, user?.role)

  useLayoutEffect(() => {
    const unique = uniqueMemberships(memberships, user?.id, user?.role)
    if (unique.length === 1 && !active) {
      selectRestaurant(unique[0].restaurantId)
    }
  }, [memberships, active, selectRestaurant, user?.id, user?.role])

  if (loading || (user && !tenantReady)) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  if (restaurants.length === 0) return <Navigate to="/setup" replace />

  if (shouldShowRestaurantPicker(memberships, active, user.id, user.role)) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 p-6">
        <p className="text-lg font-semibold">Restoran tanlang</p>
        <RestaurantSwitcher />
      </div>
    )
  }

  const role = (active?.role ?? user.role) as UserRole
  if (!allowed.includes(role)) return <Navigate to={ROLE_HOME[role]} replace />

  return <Outlet />
}

export function AuthGuard() {
  const { user, loading } = useAuth()
  const { active, memberships } = useTenant()
  const tenantReady = useTenantReady(user?.id)
  if (loading || (user && !tenantReady)) return null
  if (user) {
    if (uniqueMemberships(memberships, user.id, user.role).length === 0) return <Navigate to="/setup" replace />
    const role = (active?.role ?? user.role) as UserRole
    const path = role === 'waiter' ? 'waiter/tables' : role === 'admin' ? 'admin' : role
    return <Navigate to={`/${path}`} replace />
  }
  return <Outlet />
}
