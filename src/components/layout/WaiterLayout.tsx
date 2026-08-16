import { Outlet } from 'react-router-dom'
import { BottomNav } from './BottomNav'
import { NotificationBanner } from '@/features/waiter/NotificationBanner'

export function WaiterLayout() {
  return (
    <div className="min-h-full pb-20">
      <NotificationBanner />
      <Outlet />
      <BottomNav />
    </div>
  )
}
