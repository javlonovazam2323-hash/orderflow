import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { bootstrapStaff, needsSetup } from '@/lib/api/staff'
import { isSupabaseConfigured } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'

export function SetupPage() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<Array<{ email: string; role: string; password: string; pin: string | null }>>([])
  const [showSetup, setShowSetup] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      navigate('/login', { replace: true })
      return
    }
    needsSetup().then((needed) => {
      setShowSetup(needed)
      setLoading(false)
      if (!needed) navigate('/login', { replace: true })
    })
  }, [navigate])

  const handleBootstrap = async () => {
    setCreating(true)
    setError('')
    try {
      const staff = await bootstrapStaff()
      setCreated(staff)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xatolik yuz berdi')
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      </div>
    )
  }

  if (!showSetup) return null

  return (
    <div className="min-h-full flex items-center justify-center p-6 bg-gradient-to-b from-slate-900 to-slate-800">
      <div className="w-full max-w-lg space-y-6">
        <div className="text-center text-white space-y-2">
          <div className="text-4xl">🚀</div>
          <h1 className="text-2xl font-bold">OrderFlow sozlash</h1>
          <p className="text-slate-400 text-sm">
            Dastlabki xodimlarni bir bosishda yarating
          </p>
        </div>

        {!created.length ? (
          <Card>
            <CardHeader>
              <h2 className="font-semibold">Standart xodimlar</h2>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="text-sm space-y-2 text-muted">
                <li>admin@orderflow.uz — Admin</li>
                <li>kassir@orderflow.uz — Kassir (PIN: 0000)</li>
                <li>ofitsiant@orderflow.uz — Ofitsiant (PIN: 1234)</li>
                <li>oshxona@orderflow.uz — Oshxona (PIN: 5678)</li>
              </ul>
              <p className="text-xs text-muted">Barcha parollar: demo1234</p>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <Button size="lg" className="w-full" loading={creating} onClick={handleBootstrap}>
                Xodimlarni yaratish
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <h2 className="font-semibold text-green-700">Tayyor! ✓</h2>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm space-y-3">
                {created.map((s) => (
                  <div key={s.email} className="p-3 rounded-xl bg-surface-2">
                    <p className="font-medium">{s.email}</p>
                    <p className="text-muted">Rol: {s.role} · Parol: {s.password}</p>
                    {s.pin && <p className="text-muted">PIN: {s.pin}</p>}
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted">
                Keyinchalik Admin panel → Xodimlar bo&apos;limidan o&apos;zgartirishingiz mumkin.
              </p>
              <Link to="/login">
                <Button size="lg" className="w-full">Login sahifasiga →</Button>
              </Link>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
