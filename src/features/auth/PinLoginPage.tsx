import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { cn } from '@/lib/format'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/Button'
import { useTenantStore } from '@/stores/tenantStore'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'] as const

export function PinLoginPage() {
  const { signInWithPin } = useAuth()
  const navigate = useNavigate()
  const { slug } = useParams()
  const setHintedSlug = useTenantStore((s) => s.setHintedSlug)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (slug) setHintedSlug(slug)
  }, [slug, setHintedSlug])

  const handleKey = (key: string) => {
    setError('')
    if (key === '⌫') {
      setPin((p) => p.slice(0, -1))
    } else if (key && pin.length < 4) {
      setPin((p) => p + key)
    }
  }

  const handleSubmit = async () => {
    if (pin.length < 4) {
      setError('PIN 4 raqamdan iborat')
      return
    }
    setLoading(true)
    const ok = await signInWithPin(pin, slug ?? null)
    setLoading(false)
    if (!ok) {
      setError('PIN noto\'g\'ri')
      setPin('')
      return
    }
    navigate('/')
  }

  return (
    <div className="min-h-full flex flex-col items-center justify-center p-6 bg-gradient-to-b from-slate-900 to-slate-800">
      <div className="w-full max-w-xs space-y-8">
        <div className="text-center text-white space-y-2">
          <div className="text-4xl">🔐</div>
          <h1 className="text-2xl font-bold">PIN kirish</h1>
          <p className="text-slate-400 text-sm">Ofitsiant tez kirish</p>
        </div>

        {/* PIN dots */}
        <div className="flex justify-center gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={cn(
                'h-4 w-4 rounded-full border-2 transition-all',
                pin.length > i ? 'bg-brand-500 border-brand-500 scale-110' : 'border-slate-500',
              )}
            />
          ))}
        </div>

        {error && <p className="text-center text-red-400 text-sm">{error}</p>}

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-3">
          {KEYS.map((key, i) => (
            <button
              key={i}
              disabled={!key || loading}
              onClick={() => key && handleKey(key)}
              className={cn(
                'h-16 rounded-2xl text-2xl font-bold transition-all active:scale-95',
                key
                  ? 'bg-slate-700 text-white hover:bg-slate-600'
                  : 'invisible',
                key === '⌫' && 'text-lg bg-slate-800',
              )}
            >
              {key}
            </button>
          ))}
        </div>

        <Button
          size="xl"
          className="w-full"
          loading={loading}
          disabled={pin.length < 4}
          onClick={handleSubmit}
        >
          Kirish
        </Button>

        <button
          onClick={() => navigate('/login')}
          className="w-full text-center text-sm text-slate-400 hover:text-white"
        >
          Email bilan kirish →
        </button>

        <p className="text-center text-xs text-slate-600">Demo PIN: 1234</p>
      </div>
    </div>
  )
}
