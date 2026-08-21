import { Navigate } from 'react-router-dom'
import { isSupabaseConfigured } from '@/lib/supabase'
import { ROLE_HOME } from '@/lib/constants'
import { canCreateRestaurant } from '@/lib/tenant/access'
import { useAuth } from '@/hooks/useAuth'
import { useTenant, useTenantReady } from '@/hooks/useTenant'
import { SetupWizard } from '@/features/setup/SetupWizard'
import type { UserRole } from '@/types/database'

export function SetupPage() {
  const { user, loading } = useAuth()
  const { memberships, active } = useTenant()
  const tenantReady = useTenantReady(user?.id)

  if (!isSupabaseConfigured()) {
    return <Navigate to="/login" replace />
  }

  if (loading || (user && !tenantReady)) {
    return (
      <div className="min-h-full flex items-center justify-center bg-slate-900">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      </div>
    )
  }

  if (user && memberships.length > 0 && !canCreateRestaurant(memberships)) {
    const role = (active?.role ?? user.role) as UserRole
    return <Navigate to={ROLE_HOME[role]} replace />
  }

  return <SetupWizard />
}
