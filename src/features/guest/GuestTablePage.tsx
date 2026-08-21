import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  fetchGuestTableInfo,
  isPublicTableToken,
  submitGuestTableAction,
  type GuestCallAction,
  type GuestTableInfo,
} from '@/lib/api/guest'
import { Button } from '@/components/ui/Button'

const POLL_MS = 2500
const DISABLE_MS = 45_000

export function GuestTablePage() {
  const { slug, token } = useParams()
  const [info, setInfo] = useState<GuestTableInfo | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState<GuestCallAction | null>(null)
  const [disabledUntil, setDisabledUntil] = useState(0)
  const [now, setNow] = useState(Date.now())

  const valid = isPublicTableToken(token) && !!slug

  const refresh = useCallback(async () => {
    if (!valid || !slug || !token) return
    try {
      const next = await fetchGuestTableInfo(slug, token)
      setInfo(next)
      setError('')
    } catch (e) {
      const code = e instanceof Error ? e.message : 'unknown'
      setError(code === 'invalid_token' ? 'Stol topilmadi' : 'Xatolik yuz berdi')
      if (code === 'invalid_token') setInfo(null)
    } finally {
      setLoading(false)
    }
  }, [slug, token, valid])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!valid) return
    const id = window.setInterval(() => { void refresh() }, POLL_MS)
    return () => window.clearInterval(id)
  }, [valid, refresh])

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [])

  const remaining = Math.max(0, Math.ceil((disabledUntil - now) / 1000))
  const buttonsLocked = remaining > 0 || sending !== null

  const act = async (action: GuestCallAction) => {
    if (!slug || !token || buttonsLocked) return
    setSending(action)
    setError('')
    try {
      await submitGuestTableAction(slug, token, action)
      setDisabledUntil(Date.now() + DISABLE_MS)
      await refresh()
    } catch (e) {
      const code = e instanceof Error ? e.message : 'unknown'
      if (code === 'no_waiter') setError('Bu stolga hali ofitsiant biriktirilmagan')
      else if (code === 'rate_limited') {
        setDisabledUntil(Date.now() + DISABLE_MS)
        setError('Xabar allaqachon yuborilgan. Iltimos kuting.')
      } else if (code === 'invalid_token') setError('Stol topilmadi')
      else setError('Xatolik yuz berdi')
    } finally {
      setSending(null)
    }
  }

  if (!valid) {
    return (
      <Shell>
        <p className="text-center text-slate-300">Noto‘g‘ri QR kod</p>
      </Shell>
    )
  }

  if (loading) {
    return (
      <Shell>
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-white border-t-transparent mx-auto" />
      </Shell>
    )
  }

  if (!info) {
    return (
      <Shell>
        <p className="text-center text-slate-300">{error || 'Stol topilmadi'}</p>
      </Shell>
    )
  }

  const pending = info.pending_call
  const justSent = pending?.status === 'pending'
  const acked = pending?.status === 'acknowledged'

  return (
    <Shell>
      <div className="w-full max-w-sm mx-auto text-center space-y-6">
        {info.restaurant_logo_url ? (
          <img
            src={info.restaurant_logo_url}
            alt=""
            className="mx-auto h-20 w-20 rounded-2xl object-cover bg-white"
          />
        ) : (
          <div className="mx-auto h-20 w-20 rounded-2xl bg-white/10 flex items-center justify-center text-3xl">
            🍽️
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold text-white">{info.restaurant_name}</h1>
          <p className="text-lg text-slate-300 mt-1">Stol №{info.table_number}</p>
        </div>

        {info.has_waiter ? (
          <div className="rounded-2xl bg-white/10 p-4 space-y-2">
            {info.waiter_avatar_url && (
              <img
                src={info.waiter_avatar_url}
                alt=""
                className="mx-auto h-16 w-16 rounded-full object-cover"
              />
            )}
            <p className="text-xs uppercase tracking-wide text-slate-400">Sizning ofitsiantingiz</p>
            <p className="text-lg font-semibold text-white">{info.waiter_name}</p>
          </div>
        ) : (
          <p className="rounded-2xl bg-amber-500/15 text-amber-100 p-4 text-sm">
            Bu stolga hali ofitsiant biriktirilmagan
          </p>
        )}

        {justSent && (
          <p className="rounded-2xl bg-green-600/80 text-white p-3 text-sm font-medium">
            Ofitsiantga xabar yuborildi
          </p>
        )}
        {acked && (
          <p className="rounded-2xl bg-brand-600 text-white p-3 text-sm font-medium">
            Ofitsiant xabaringizni oldi
          </p>
        )}
        {error && <p className="text-sm text-red-300">{error}</p>}

        <div className="space-y-3">
          <Button
            size="xl"
            className="w-full h-16 text-lg"
            disabled={!info.has_waiter || buttonsLocked}
            loading={sending === 'waiter_call'}
            onClick={() => void act('waiter_call')}
          >
            🔔 Ofitsiantni chaqirish
          </Button>
          <Button
            size="xl"
            variant="secondary"
            className="w-full h-16 text-lg"
            disabled={!info.has_waiter || buttonsLocked}
            loading={sending === 'bill_request'}
            onClick={() => void act('bill_request')}
          >
            💳 Hisobni so‘rash
          </Button>
          {remaining > 0 && (
            <p className="text-xs text-slate-400">{remaining}s dan keyin qayta yuborish mumkin</p>
          )}
        </div>
      </div>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full flex items-center justify-center p-6 bg-gradient-to-b from-slate-900 to-slate-800">
      {children}
    </div>
  )
}
