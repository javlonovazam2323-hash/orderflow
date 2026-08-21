import { Outlet } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { NotificationBanner } from '@/features/waiter/NotificationBanner'
import { RestaurantSwitcher } from '@/components/layout/RestaurantSwitcher'

export function WaiterLayout() {
  return (
    <div className="min-h-full pb-20">
      <RestaurantSwitcher className="block px-4 pt-3" />
      <NotificationBanner />
      <Outlet />
      <BottomNav />
    </div>
  )
}
