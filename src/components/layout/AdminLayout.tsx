import { NavLink, Outlet, Link } from 'react-router-dom'
import { cn } from '@/lib/format'
import { useAuth } from '@/hooks/useAuth'
import { useTenant } from '@/hooks/useTenant'
import { canCreateRestaurant } from '@/lib/tenant/access'
import { Button } from '@/components/ui/Button'
import { RestaurantSwitcher } from '@/components/layout/RestaurantSwitcher'

const navItems = [
  { to: '/admin', label: 'Dashboard', icon: '📊', end: true },
  { to: '/admin/orders', label: 'Zakazlar', icon: '📦' },
  { to: '/admin/tables', label: 'Stollar', icon: '🪑' },
  { to: '/admin/menu', label: 'Menyu', icon: '📋' },
  { to: '/admin/staff', label: 'Xodimlar', icon: '👤' },
  { to: '/admin/reports', label: 'Hisobot', icon: '📈' },
  { to: '/admin/waiters', label: 'KPI', icon: '📊' },
  { to: '/admin/settings', label: 'Sozlamalar', icon: '⚙️' },
]

export function AdminLayout() {
  const { signOut } = useAuth()
  const { memberships } = useTenant()
  const showNewRestaurant = memberships.length === 1 && canCreateRestaurant(memberships)

  return (
    <div className="min-h-full flex flex-col md:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-56 md:flex-col md:fixed md:inset-y-0 border-r border-border bg-surface">
        <div className="p-5 border-b border-border">
          <p className="font-bold text-lg">OrderFlow</p>
          <p className="text-xs text-muted">Admin panel</p>
          <div className="mt-2">
            <RestaurantSwitcher className="block w-full" />
            {showNewRestaurant && (
              <Link to="/setup" className="mt-2 inline-block text-xs font-medium text-brand-600 hover:underline">
                + Yangi restoran
              </Link>
            )}
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-brand-600 text-white'
                    : 'text-muted hover:bg-surface-2 hover:text-slate-900 dark:hover:text-slate-100',
                )
              }
            >
              <span>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-border">
          <Button variant="ghost" size="sm" className="w-full" onClick={() => signOut()}>
            Chiqish
          </Button>
        </div>
      </aside>

      {/* Mobile header + bottom nav */}
      <div className="md:hidden sticky top-0 z-20 flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-surface/95 backdrop-blur">
        <p className="font-bold">OrderFlow Admin</p>
        <div className="flex items-center gap-2">
          {showNewRestaurant && (
            <Link to="/setup" className="text-xs font-medium text-brand-600">+ Restoran</Link>
          )}
          <Button variant="ghost" size="sm" onClick={() => signOut()}>Chiqish</Button>
        </div>
      </div>

      <main className="flex-1 md:ml-56 pb-20 md:pb-6">
        <Outlet />
      </main>

      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-surface/95 backdrop-blur safe-bottom">
        <div className="grid grid-cols-4 sm:grid-cols-7 h-16 overflow-x-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center justify-center gap-0.5 text-[10px]',
                  isActive ? 'text-brand-600 font-semibold' : 'text-muted',
                )
              }
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
