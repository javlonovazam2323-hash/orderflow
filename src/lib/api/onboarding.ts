import { getSupabase } from '@/lib/supabase'
import { isValidSlug, nextSlugAttempt, slugify } from '@/lib/tenant/slug'

export interface CreateRestaurantInput {
  name: string
  slug: string
  phone?: string | null
  address?: string | null
  logo_url?: string | null
  service_charge_percent?: number
  table_count?: number
}

export interface CreatedRestaurant {
  id: string
  slug: string
}

interface RpcError {
  code?: string
  message?: string
  details?: string
}

function isSlugUniqueViolation(error: RpcError): boolean {
  const blob = `${error.code ?? ''} ${error.message ?? ''} ${error.details ?? ''}`.toLowerCase()
  return blob.includes('restaurants_slug_unique') || (blob.includes('23505') && blob.includes('slug'))
}

/**
 * Wraps create_restaurant RPC. Unique slug: bella-pizza, then bella-pizza-2, bella-pizza-3.
 * Does not trust a client-supplied restaurant id.
 */
export async function createRestaurant(input: CreateRestaurantInput): Promise<CreatedRestaurant> {
  const base = slugify(input.slug || input.name)
  if (!isValidSlug(base)) {
    throw new Error('Slug formati noto\'g\'ri')
  }

  const sb = getSupabase()
  const maxAttempts = 20

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const slug = nextSlugAttempt(base, attempt)
    const { data, error } = await sb.rpc('create_restaurant', {
      p_name: input.name,
      p_slug: slug,
      p_phone: input.phone ?? null,
      p_address: input.address ?? null,
      p_logo_url: input.logo_url ?? null,
      p_service_charge_percent: input.service_charge_percent ?? 0,
      p_table_count: input.table_count ?? 1,
    })
    if (!error) return { id: data as string, slug }
    if (isSlugUniqueViolation(error) && attempt < maxAttempts) continue
    throw error
  }

  throw new Error('Slug band. Boshqa nom yoki slug tanlang.')
}

export interface VerifyCreatedResult {
  restaurant: { id: string; name: string; slug: string }
  membershipRole: string
  settingsOk: boolean
  tableCount: number
  tablesOk: boolean
}

/** Read-only tenant-scoped checks after create_restaurant. Counters table is not readable by authenticated. */
export async function verifyCreatedRestaurant(
  restaurantId: string,
  expectedTableCount: number,
): Promise<VerifyCreatedResult> {
  const sb = getSupabase()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) throw new Error('Sessiya yo\'q')

  const { data: restaurant, error: restaurantError } = await sb
    .from('restaurants')
    .select('id, name, slug')
    .eq('id', restaurantId)
    .maybeSingle()
  if (restaurantError) throw restaurantError
  if (!restaurant) throw new Error('Restoran topilmadi')

  const { data: membership, error: membershipError } = await sb
    .from('restaurant_members')
    .select('role')
    .eq('restaurant_id', restaurantId)
    .eq('user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()
  if (membershipError) throw membershipError
  if (!membership || membership.role !== 'admin') {
    throw new Error('Admin a\'zolik topilmadi')
  }

  const { data: settings, error: settingsError } = await sb
    .from('restaurant_settings')
    .select('id, table_count')
    .eq('restaurant_id', restaurantId)
    .maybeSingle()
  if (settingsError) throw settingsError
  if (!settings) throw new Error('Sozlamalar topilmadi')

  const { data: tables, error: tablesError } = await sb
    .from('restaurant_tables')
    .select('number')
    .eq('restaurant_id', restaurantId)
    .order('number')
  if (tablesError) throw tablesError

  const numbers = new Set((tables ?? []).map((t) => t.number))
  const tablesOk = Array.from({ length: expectedTableCount }, (_, i) => i + 1).every((n) => numbers.has(n))
  if (!tablesOk) throw new Error('Stollar to\'liq yaratilmadi')

  return {
    restaurant,
    membershipRole: membership.role,
    settingsOk: true,
    tableCount: tables?.length ?? 0,
    tablesOk,
  }
}
