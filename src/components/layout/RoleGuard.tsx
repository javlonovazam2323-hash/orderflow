import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/hooks/useAuth'
import type { UserRole } from '@/types/database'

interface RoleGuardProps {
  allowed: UserRole[]
}

export function RoleGuard({ allowed }: RoleGuardProps) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />
  if (!allowed.includes(user.role)) return <Navigate to="/login" replace />

  return <Outlet />
}

export function AuthGuard() {
  const { user, loading } = useAuth()
  if (loading) return null
  if (user) return <Navigate to={`/${user.role === 'waiter' ? 'waiter/tables' : user.role === 'admin' ? 'admin' : user.role}`} replace />
  return <Outlet />
}
