import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { getSession, signIn as apiSignIn, signInWithPin as apiSignInWithPin, signOut as apiSignOut, signUp as apiSignUp } from '@/lib/api'
import { ROLE_HOME } from '@/lib/constants'
import { readHintedRestaurantSlug } from '@/lib/tenant/resolve'
import { useTenantStore } from '@/stores/tenantStore'
import type { Profile, UserRole } from '@/types/database'

interface AuthContextValue {
  user: Profile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<boolean>
  signUp: (email: string, password: string) => Promise<{ ok: boolean; needsEmailConfirm: boolean; error?: string }>
  signInWithPin: (pin: string, restaurantSlug?: string | null) => Promise<boolean>
  signOut: () => Promise<void>
  refreshUser: () => Promise<void>
  homePath: string
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSession().then((profile) => {
      setUser(profile)
      setLoading(false)
    })
  }, [])

  const signIn = async (email: string, password: string) => {
    const profile = await apiSignIn(email, password)
    if (!profile) return false
    setUser(profile)
    return true
  }

  const signUp = async (email: string, password: string) => {
    try {
      const result = await apiSignUp(email, password)
      if (result.needsEmailConfirm) {
        return { ok: false, needsEmailConfirm: true }
      }
      if (!result.profile) return { ok: false, needsEmailConfirm: false, error: 'Ro\'yxatdan o\'tish muvaffaqiyatsiz' }
      setUser(result.profile)
      return { ok: true, needsEmailConfirm: false }
    } catch (e) {
      return {
        ok: false,
        needsEmailConfirm: false,
        error: e instanceof Error ? e.message : 'Ro\'yxatdan o\'tish xatoligi',
      }
    }
  }

  const signInWithPin = async (pin: string, restaurantSlug?: string | null) => {
    const profile = await apiSignInWithPin(pin, restaurantSlug ?? readHintedRestaurantSlug())
    if (!profile) return false
    setUser(profile)
    return true
  }

  const signOut = async () => {
    useTenantStore.getState().reset()
    await apiSignOut()
    setUser(null)
  }

  const refreshUser = async () => {
    const profile = await getSession()
    setUser(profile)
  }

  const tenantRole = useTenantStore((s) => s.active?.role)
  const homePath = user ? ROLE_HOME[(tenantRole ?? user.role) as UserRole] : '/login'

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signUp, signInWithPin, signOut, refreshUser, homePath }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
