import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type Action = 'list' | 'create' | 'update' | 'reset_password'
const STAFF_ROLES = ['admin', 'cashier', 'waiter', 'kitchen'] as const
type StaffRole = (typeof STAFF_ROLES)[number]

interface StaffPayload {
  action: Action
  restaurant_id?: string | null
  email?: string
  password?: string
  full_name?: string
  role?: string
  pin?: string | null
  is_active?: boolean
  profile_id?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: `Bearer ${serviceKey}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser()
    if (userError || !user) return json({ error: 'Unauthorized' }, 401)

    const body: StaffPayload = await req.json()
    const restaurantIdOrErr = await requireRestaurantAdmin(
      supabaseAdmin,
      user.id,
      body.restaurant_id,
    )
    if (typeof restaurantIdOrErr !== 'string') {
      return json({ error: restaurantIdOrErr.error }, restaurantIdOrErr.status)
    }
    const restaurantId = restaurantIdOrErr

    const action = body.action

    if (action === 'list') {
      const { data: members, error } = await supabaseAdmin
        .from('restaurant_members')
        .select('user_id, role, is_active')
        .eq('restaurant_id', restaurantId)
        .order('role')
      if (error) throw error

      const ids = (members ?? []).map((m) => m.user_id)
      const { data: profiles } = ids.length
        ? await supabaseAdmin.from('profiles').select('id, full_name, pin_hash').in('id', ids)
        : { data: [] as Array<{ id: string; full_name: string; pin_hash: string | null }> }

      const { data: usersList } = await supabaseAdmin.auth.admin.listUsers()
      const emailById = new Map((usersList?.users ?? []).map((u) => [u.id, u.email ?? '']))
      const profileById = new Map((profiles ?? []).map((p) => [p.id, p]))

      const staff = (members ?? []).map((m) => {
        const p = profileById.get(m.user_id)
        return {
          id: m.user_id,
          full_name: p?.full_name ?? '',
          role: m.role,
          is_active: m.is_active,
          email: emailById.get(m.user_id) ?? '',
          has_pin: Boolean(p?.pin_hash),
        }
      })

      return json({ staff })
    }

    if (action === 'create') {
      if (!body.email || !body.password || !body.full_name || !body.role) {
        return json({ error: 'email, password, full_name, role kerak' }, 400)
      }
      if (!isStaffRole(body.role)) {
        return json({ error: 'Noto\'g\'ri role' }, 400)
      }

      let userId: string
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: body.email,
        password: body.password,
        email_confirm: true,
      })
      if (createError) {
        const existing = await findUserByEmail(supabaseAdmin, body.email)
        if (!existing) throw createError
        userId = existing
      } else {
        userId = newUser.user.id
      }

      const { error: profileError } = await supabaseAdmin.from('profiles').upsert(
        {
          id: userId,
          full_name: body.full_name,
          role: body.role,
          is_active: true,
        },
        { onConflict: 'id' },
      )
      if (profileError) throw profileError

      const { error: memberError } = await supabaseAdmin.from('restaurant_members').upsert(
        {
          restaurant_id: restaurantId,
          user_id: userId,
          role: body.role,
          is_active: body.is_active ?? true,
        },
        { onConflict: 'restaurant_id,user_id' },
      )
      if (memberError) throw memberError

      if (body.pin) {
        await supabaseAdmin.rpc('set_profile_pin', { p_profile_id: userId, p_pin: body.pin })
      }

      return json({ success: true, id: userId })
    }

    if (action === 'update') {
      if (!body.profile_id) return json({ error: 'profile_id kerak' }, 400)
      const memberOk = await isMemberOfRestaurant(supabaseAdmin, restaurantId, body.profile_id)
      if (!memberOk) return json({ error: 'Xodim bu restoranda emas' }, 403)

      if (body.role !== undefined && !isStaffRole(body.role)) {
        return json({ error: 'Noto\'g\'ri role' }, 400)
      }

      const profileUpdates: Record<string, unknown> = {}
      if (body.full_name !== undefined) profileUpdates.full_name = body.full_name

      if (Object.keys(profileUpdates).length > 0) {
        const { error } = await supabaseAdmin
          .from('profiles')
          .update(profileUpdates)
          .eq('id', body.profile_id)
        if (error) throw error
      }

      const memberUpdates: Record<string, unknown> = {}
      if (body.role !== undefined) memberUpdates.role = body.role
      if (body.is_active !== undefined) memberUpdates.is_active = body.is_active
      if (Object.keys(memberUpdates).length > 0) {
        const { error } = await supabaseAdmin
          .from('restaurant_members')
          .update(memberUpdates)
          .eq('restaurant_id', restaurantId)
          .eq('user_id', body.profile_id)
        if (error) throw error
      }

      if (body.pin !== undefined) {
        if (body.pin) {
          await supabaseAdmin.rpc('set_profile_pin', {
            p_profile_id: body.profile_id,
            p_pin: body.pin,
          })
        } else {
          await supabaseAdmin.from('profiles').update({ pin_hash: null }).eq('id', body.profile_id)
        }
      }

      return json({ success: true })
    }

    if (action === 'reset_password') {
      if (!body.profile_id || !body.password) {
        return json({ error: 'profile_id va password kerak' }, 400)
      }
      const memberOk = await isMemberOfRestaurant(supabaseAdmin, restaurantId, body.profile_id)
      if (!memberOk) return json({ error: 'Xodim bu restoranda emas' }, 403)
      const { error } = await supabaseAdmin.auth.admin.updateUserById(body.profile_id, {
        password: body.password,
      })
      if (error) throw error
      return json({ success: true })
    }

    return json({ error: 'Noto\'g\'ri action' }, 400)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return json({ error: message }, 500)
  }
})

function isStaffRole(role: string): role is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(role)
}

async function requireRestaurantAdmin(
  supabaseAdmin: SupabaseClient,
  userId: string,
  hintedRestaurantId?: string | null,
): Promise<string | { error: string; status: number }> {
  // restaurant_id from the client is a context hint only — membership is verified here.
  let query = supabaseAdmin
    .from('restaurant_members')
    .select('restaurant_id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('role', 'admin')

  if (hintedRestaurantId) {
    query = query.eq('restaurant_id', hintedRestaurantId)
  }

  const { data, error } = await query
  if (error) throw error
  const rows = data ?? []

  if (hintedRestaurantId) {
    if (rows.length === 0) return { error: 'Admin ruxsati kerak', status: 403 }
    return hintedRestaurantId
  }
  if (rows.length === 0) return { error: 'Admin ruxsati kerak', status: 403 }
  if (rows.length > 1) return { error: 'Restoran context kerak', status: 400 }
  return rows[0].restaurant_id as string
}

async function isMemberOfRestaurant(
  supabaseAdmin: SupabaseClient,
  restaurantId: string,
  profileId: string,
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('restaurant_members')
    .select('user_id')
    .eq('restaurant_id', restaurantId)
    .eq('user_id', profileId)
    .maybeSingle()
  return Boolean(data)
}

async function findUserByEmail(
  supabaseAdmin: SupabaseClient,
  email: string,
): Promise<string | null> {
  const { data } = await supabaseAdmin.auth.admin.listUsers()
  const match = (data?.users ?? []).find((u) => u.email?.toLowerCase() === email.toLowerCase())
  return match?.id ?? null
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
