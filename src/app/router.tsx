import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { needsSetup } from '@/lib/api/staff'
import { isSupabaseConfigured } from '@/lib/supabase'
import { AuthGuard, RoleGuard } from '@/components/layout/RoleGuard'
import { WaiterLayout } from '@/components/layout/WaiterLayout'
import { AdminLayout } from '@/components/layout/AdminLayout'
import { LoginPage } from '@/features/auth/LoginPage'
import { PinLoginPage } from '@/features/auth/PinLoginPage'
import { TablesPage as AdminTablesPage } from '@/features/admin/TablesPage'
import { DashboardPage } from '@/features/admin/DashboardPage'
import { MenuManagementPage } from '@/features/admin/MenuManagementPage'
import { ReportsPage } from '@/features/admin/ReportsPage'
import { WaitersStatsPage } from '@/features/admin/WaitersStatsPage'
import { SetupPage } from '@/features/setup/SetupPage'
import { StaffPage } from '@/features/admin/StaffPage'
import { SettingsPage } from '@/features/admin/SettingsPage'
import { OrdersPage as AdminOrdersPage } from '@/features/orders/OrdersPage'
import { CashierPage } from '@/features/cashier/CashierPage'
import { PaymentPage } from '@/features/cashier/PaymentPage'
import { OrdersPage as StaffOrdersPage } from '@/features/orders/OrdersPage'
import { KitchenPage } from '@/features/kitchen/KitchenPage'
import { TablesPage } from '@/features/waiter/TablesPage'
import { MenuPage } from '@/features/waiter/MenuPage'
import { OrdersPage } from '@/features/waiter/OrdersPage'
import { ProfilePage } from '@/features/waiter/ProfilePage'
import { useAuth } from '@/hooks/useAuth'

function HomeRedirect() {
  const { user, loading, homePath } = useAuth()
  const [setupNeeded, setSetupNeeded] = useState<boolean | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setSetupNeeded(false)
      return
    }
    needsSetup().then(setSetupNeeded)
  }, [])

  if (loading || setupNeeded === null) return null
  if (!user && setupNeeded) return <Navigate to="/setup" replace />
  return <Navigate to={user ? homePath : '/login'} replace />
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />

        <Route path="/setup" element={<SetupPage />} />

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
          <Route path="/cashier/orders" element={<StaffOrdersPage title="Zakazlar" payBasePath="/cashier/pay" />} />
          <Route path="/cashier/pay/:orderId" element={<PaymentPage />} />
        </Route>

        <Route element={<RoleGuard allowed={['admin']} />}>
          <Route element={<AdminLayout />}>
            <Route path="/admin" element={<DashboardPage />} />
            <Route path="/admin/orders" element={<AdminOrdersPage title="Zakazlar" payBasePath="/cashier/pay" />} />
            <Route path="/admin/tables" element={<AdminTablesPage />} />
            <Route path="/admin/menu" element={<MenuManagementPage />} />
            <Route path="/admin/reports" element={<ReportsPage />} />
            <Route path="/admin/waiters" element={<WaitersStatsPage />} />
            <Route path="/admin/staff" element={<StaffPage />} />
            <Route path="/admin/settings" element={<SettingsPage />} />
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
