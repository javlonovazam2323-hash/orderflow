import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''
export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true' || !supabaseUrl || supabaseUrl.includes('your-project')

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (USE_MOCK) {
    throw new Error('Supabase not available in mock mode')
  }
  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
      realtime: { params: { eventsPerSecond: 10 } },
    })
  }
  return client
}

export function isSupabaseConfigured(): boolean {
  return !USE_MOCK
}
