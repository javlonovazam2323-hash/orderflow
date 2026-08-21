import { useAuth } from '@/hooks/useAuth'
import { useThemeStore } from '@/stores/themeStore'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { ROLE_LABELS } from '@/lib/constants'
import { RestaurantSwitcher } from '@/components/layout/RestaurantSwitcher'
import { USE_MOCK } from '@/lib/supabase'
import { mockStore } from '@/lib/mock/store'

export function ProfilePage() {
  const { user, signOut } = useAuth()
  const { theme, setTheme } = useThemeStore()

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold">Profil</h1>

      <Card>
        <CardContent className="pt-4 space-y-2">
          <p className="text-lg font-semibold">{user?.full_name}</p>
          <p className="text-muted">{user?.role ? ROLE_LABELS[user.role] : ''}</p>
          <RestaurantSwitcher className="mt-2 block" />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4 space-y-3">
          <p className="font-medium">Mavzu</p>
          <div className="grid grid-cols-3 gap-2">
            {(['light', 'dark', 'system'] as const).map((t) => (
              <Button
                key={t}
                variant={theme === t ? 'primary' : 'outline'}
                size="sm"
                onClick={() => setTheme(t)}
              >
                {t === 'light' ? '☀️' : t === 'dark' ? '🌙' : '💻'}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {USE_MOCK && (
        <Button variant="outline" className="w-full" onClick={() => mockStore.resetDemo()}>
          Demo ma'lumotlarni tozalash
        </Button>
      )}

      <Button variant="danger" className="w-full" onClick={() => signOut()}>
        Chiqish
      </Button>
    </div>
  )
}
