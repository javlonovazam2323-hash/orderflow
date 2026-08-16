import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/format'

const tabs = [
  { to: '/waiter/tables', label: 'Stollar', icon: '🪑' },
  { to: '/waiter/menu', label: 'Menyu', icon: '📋' },
  { to: '/waiter/orders', label: 'Buyurtmalar', icon: '📝' },
  { to: '/waiter/profile', label: 'Profil', icon: '👤' },
]

export function BottomNav() {
  return (
    <nav className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-surface/95 backdrop-blur safe-bottom">
      <div className="grid grid-cols-4 h-16 max-w-lg mx-auto">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center justify-center gap-0.5 text-xs transition-colors',
                isActive ? 'text-brand-600 font-semibold' : 'text-muted',
              )
            }
          >
            <span className="text-xl">{tab.icon}</span>
            {tab.label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
