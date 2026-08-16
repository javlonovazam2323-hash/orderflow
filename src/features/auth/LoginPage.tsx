import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card, CardContent } from '@/components/ui/Card'
import { useAuth } from '@/hooks/useAuth'
import { DEMO_USERS } from '@/lib/constants'
import { USE_MOCK } from '@/lib/supabase'

export function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const ok = await signIn(email, password)
    setLoading(false)
    if (!ok) {
      setError('Login yoki parol noto\'g\'ri')
      return
    }
    navigate('/')
  }

  const quickLogin = async (demoEmail: string, demoPassword: string) => {
    setEmail(demoEmail)
    setPassword(demoPassword)
    setLoading(true)
    const ok = await signIn(demoEmail, demoPassword)
    setLoading(false)
    if (ok) navigate('/')
  }

  return (
    <div className="min-h-full flex flex-col items-center justify-center p-6 bg-gradient-to-b from-slate-900 to-slate-800">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center text-white space-y-2">
          <div className="text-5xl mb-4">🍽️</div>
          <h1 className="text-3xl font-bold tracking-tight">OrderFlow</h1>
          <p className="text-slate-400 text-sm">Restoran buyurtma boshqaruv tizimi</p>
          {USE_MOCK && (
            <span className="inline-block mt-2 text-xs bg-amber-500/20 text-amber-300 px-3 py-1 rounded-full">
              Demo rejim (mock data)
            </span>
          )}
        </div>

        <Card>
          <CardContent className="pt-5 space-y-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ofitsiant@orderflow.uz"
                autoComplete="email"
                required
              />
              <Input
                label="Parol"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button type="submit" className="w-full" size="lg" loading={loading}>
                Kirish
              </Button>
            </form>

            <Link
              to="/login/pin"
              className="block text-center text-sm text-brand-600 font-medium hover:underline"
            >
              🔐 PIN bilan tez kirish (ofitsiant)
            </Link>
          </CardContent>
        </Card>

        {USE_MOCK && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500 text-center">Tez kirish (demo)</p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_USERS.map((u) => (
                <Button
                  key={u.email}
                  variant="outline"
                  size="sm"
                  className="text-white border-slate-600 hover:bg-slate-700"
                  onClick={() => quickLogin(u.email, u.password)}
                  disabled={loading}
                >
                  {u.name}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
