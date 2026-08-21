import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DEFAULT_STAFF = [
  { email: 'admin@orderflow.uz', password: 'demo1234', full_name: 'Admin', role: 'admin', pin: null },
  { email: 'kassir@orderflow.uz', password: 'demo1234', full_name: 'Kassir Ali', role: 'cashier', pin: '0000' },
  { email: 'ofitsiant@orderflow.uz', password: 'demo1234', full_name: 'Ofitsiant Sardor', role: 'waiter', pin: '1234' },
  { email: 'oshxona@orderflow.uz', password: 'demo1234', full_name: 'Oshpaz', role: 'kitchen', pin: '5678' },
] as const

function formatError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as { message: unknown }).message)
  }
  return JSON.stringify(err)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    const body = await req.json().catch(() => ({})) as {
      setupSecret?: string
      restaurant_slug?: string
    }
    const setupSecret = String(body.setupSecret ?? '')
    const expectedSecret = Deno.env.get('SETUP_SECRET') ?? ''

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: needsSetup, error: setupError } = await supabaseAdmin.rpc('needs_setup')
    if (setupError) throw setupError

    if (expectedSecret) {
      if (setupSecret !== expectedSecret) {
        return json({ error: 'Forbidden' }, 403)
      }
    } else if (!needsSetup) {
      // Open bootstrap is only allowed while no restaurant admin exists.
      return json({ error: 'Forbidden' }, 403)
    }

    const restaurantId = await resolveRestaurantId(supabaseAdmin, body.restaurant_slug)
    if (!restaurantId) {
      return json({ error: 'Restoran topilmadi' }, 400)
    }

    const { data: usersList, error: listError } = await supabaseAdmin.auth.admin.listUsers()
    if (listError) throw listError

    const byEmail = new Map(
      (usersList.users ?? []).filter((u) => u.email).map((u) => [u.email!.toLowerCase(), u]),
    )

    const { data: existingMembers } = await supabaseAdmin
      .from('restaurant_members')
      .select('user_id, role')
      .eq('restaurant_id', restaurantId)

    const memberByRole = new Map((existingMembers ?? []).map((m) => [m.role, m.user_id]))
    const staffToCreate = DEFAULT_STAFF.filter((staff) => {
      const hasEmail = byEmail.has(staff.email.toLowerCase())
      const hasRole = memberByRole.has(staff.role)
      return !hasEmail || !hasRole
    })

    if (staffToCreate.length === 0) {
      return json({ success: true, staff: [], message: 'Barcha xodimlar mavjud' })
    }

    const created: Array<{ email: string; role: string; password: string; pin: string | null }> = []
    const errors: Array<{ email: string; error: string }> = []

    for (const staff of staffToCreate) {
      try {
        let userId: string
        const existing = byEmail.get(staff.email.toLowerCase())

        if (existing) {
          userId = existing.id
        } else {
          const { data: newUser, error } = await supabaseAdmin.auth.admin.createUser({
            email: staff.email,
            password: staff.password,
            email_confirm: true,
          })
          if (error) throw error
          userId = newUser.user.id
        }

        const { error: profileError } = await supabaseAdmin.from('profiles').upsert(
          {
            id: userId,
            full_name: staff.full_name,
            role: staff.role,
            is_active: true,
          },
          { onConflict: 'id' },
        )
        if (profileError) throw profileError

        const { error: memberError } = await supabaseAdmin.from('restaurant_members').upsert(
          {
            restaurant_id: restaurantId,
            user_id: userId,
            role: staff.role,
            is_active: true,
          },
          { onConflict: 'restaurant_id,user_id' },
        )
        if (memberError) throw memberError

        if (staff.pin) {
          const { error: pinError } = await supabaseAdmin.rpc('set_profile_pin', {
            p_profile_id: userId,
            p_pin: staff.pin,
          })
          if (pinError) throw pinError
        }

        created.push({
          email: staff.email,
          role: staff.role,
          password: staff.password,
          pin: staff.pin,
        })
      } catch (err) {
        errors.push({ email: staff.email, error: formatError(err) })
      }
    }

    if (created.length === 0 && errors.length > 0) {
      return json({ error: errors[0].error, errors }, 500)
    }

    return json({ success: true, staff: created, errors })
  } catch (err) {
    const message = formatError(err)
    console.error('bootstrap-staff error:', message, err)
    return json({ error: message }, 500)
  }
})

async function resolveRestaurantId(
  supabaseAdmin: SupabaseClient,
  slug?: string,
): Promise<string | null> {
  if (slug) {
    const { data } = await supabaseAdmin
      .from('restaurants')
      .select('id')
      .eq('slug', String(slug))
      .maybeSingle()
    return data?.id ?? null
  }

  const { data: restaurants } = await supabaseAdmin.from('restaurants').select('id')
  if (!restaurants || restaurants.length !== 1) return null
  return restaurants[0].id
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
