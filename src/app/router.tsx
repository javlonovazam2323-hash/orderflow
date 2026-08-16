import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthGuard, RoleGuard } from '@/components/layout/RoleGuard'
import { WaiterLayout } from '@/components/layout/WaiterLayout'
import { AdminLayout } from '@/components/layout/AdminLayout'
import { LoginPage } from '@/features/auth/LoginPage'
import { PinLoginPage } from '@/features/auth/PinLoginPage'
import { DashboardPage } from '@/features/admin/DashboardPage'
import { MenuManagementPage } from '@/features/admin/MenuManagementPage'
import { ReportsPage } from '@/features/admin/ReportsPage'
import { WaitersStatsPage } from '@/features/admin/WaitersStatsPage'
import { SettingsPage } from '@/features/admin/SettingsPage'
import { CashierPage } from '@/features/cashier/CashierPage'
import { PaymentPage } from '@/features/cashier/PaymentPage'
import { KitchenPage } from '@/features/kitchen/KitchenPage'
import { TablesPage } from '@/features/waiter/TablesPage'
import { MenuPage } from '@/features/waiter/MenuPage'
import { OrdersPage } from '@/features/waiter/OrdersPage'
import { ProfilePage } from '@/features/waiter/ProfilePage'
import { useAuth } from '@/hooks/useAuth'

function HomeRedirect() {
  const { user, loading, homePath } = useAuth()
  if (loading) return null
  return <Navigate to={user ? homePath : '/login'} replace />
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />

        <Route element={<AuthGuard />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/login/pin" element={<PinLoginPage />} />
        </Route>

        <Route element={<RoleGuard allowed={['waiter']} />}>
          <Route element={<WaiterLayout />}>
            <Route path="/waiter/tables" element={<TablesPage />} />
            <Route path="/waiter/menu" element={<Navigate to="/waiter/tables" replace />} />
            <Route path="/waiter/menu/:tableId" element={<MenuPage />} />
            <Route path="/waiter/orders" element={<OrdersPage />} />
            <Route path="/waiter/profile" element={<ProfilePage />} />
          </Route>
        </Route>

        <Route element={<RoleGuard allowed={['kitchen']} />}>
          <Route path="/kitchen" element={<KitchenPage />} />
        </Route>

        <Route element={<RoleGuard allowed={['cashier', 'admin']} />}>
          <Route path="/cashier" element={<CashierPage />} />
          <Route path="/cashier/pay/:orderId" element={<PaymentPage />} />
        </Route>

        <Route element={<RoleGuard allowed={['admin']} />}>
          <Route element={<AdminLayout />}>
            <Route path="/admin" element={<DashboardPage />} />
            <Route path="/admin/menu" element={<MenuManagementPage />} />
            <Route path="/admin/reports" element={<ReportsPage />} />
            <Route path="/admin/waiters" element={<WaitersStatsPage />} />
            <Route path="/admin/settings" element={<SettingsPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
