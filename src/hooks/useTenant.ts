import { useEffect, type ReactNode } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { useTenantStore } from '@/stores/tenantStore'

export function useTenant() {
  return useTenantStore()
}

/** True when there is no user, or memberships have been loaded for this user. */
export function useTenantReady(userId: string | null | undefined): boolean {
  const storeUserId = useTenantStore((s) => s.userId)
  const loading = useTenantStore((s) => s.loading)
  if (!userId) return true
  return !loading && storeUserId === userId
}

export function TenantBootstrap({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const loadForUser = useTenantStore((s) => s.loadForUser)
  const reset = useTenantStore((s) => s.reset)

  useEffect(() => {
    if (!user) {
      reset()
      return
    }
    void loadForUser(user.id, user.role)
  }, [user, loadForUser, reset])

  return children
}
