import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, type ReactNode } from 'react'
import { AuthProvider } from '@/hooks/useAuth'
import { TenantBootstrap } from '@/hooks/useTenant'
import { useThemeStore } from '@/stores/themeStore'
import { OfflineBanner } from '@/components/shared/OfflineBanner'
import { PwaPrompts } from '@/components/shared/PwaPrompts'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5000, retry: 1 },
  },
})

function ThemeInit({ children }: { children: ReactNode }) {
  const applyTheme = useThemeStore((s) => s.applyTheme)

  useEffect(() => {
    applyTheme()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => applyTheme()
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [applyTheme])

  return <>{children}</>
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TenantBootstrap>
        <ThemeInit>
          <OfflineBanner />
          <PwaPrompts />
          {children}
        </ThemeInit>
        </TenantBootstrap>
      </AuthProvider>
    </QueryClientProvider>
  )
}
