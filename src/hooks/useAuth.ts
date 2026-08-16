import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { getSession, signIn as apiSignIn, signInWithPin as apiSignInWithPin, signOut as apiSignOut } from '@/lib/api'
import { ROLE_HOME } from '@/lib/constants'
import type { Profile, UserRole } from '@/types/database'

interface AuthContextValue {
  user: Profile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<boolean>
  signInWithPin: (pin: string) => Promise<boolean>
  signOut: () => Promise<void>
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

  const signInWithPin = async (pin: string) => {
    const profile = await apiSignInWithPin(pin)
    if (!profile) return false
    setUser(profile)
    return true
  }

  const signOut = async () => {
    await apiSignOut()
    setUser(null)
  }

  const homePath = user ? ROLE_HOME[user.role as UserRole] : '/login'

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signInWithPin, signOut, homePath }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
