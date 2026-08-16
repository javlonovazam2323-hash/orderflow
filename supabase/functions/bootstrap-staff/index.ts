import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

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
    const body = await req.json().catch(() => ({}))
    const setupSecret = String(body.setupSecret ?? '')
    const expectedSecret = Deno.env.get('SETUP_SECRET') ?? ''

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const { data: usersList, error: listError } = await supabaseAdmin.auth.admin.listUsers()
    if (listError) throw listError

    const byEmail = new Map(
      (usersList.users ?? []).filter((u) => u.email).map((u) => [u.email!.toLowerCase(), u]),
    )

    const { data: existingProfiles } = await supabaseAdmin
      .from('profiles')
      .select('id, role')

    const profileByRole = new Map((existingProfiles ?? []).map((p) => [p.role, p.id]))
    const staffToCreate = DEFAULT_STAFF.filter((staff) => {
      const hasEmail = byEmail.has(staff.email.toLowerCase())
      const hasRole = profileByRole.has(staff.role)
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
        await supabaseAdmin.auth.admin.updateUserById(userId, {
          password: staff.password,
          email_confirm: true,
        })
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

      if (staff.pin) {
        const { error: pinError } = await supabaseAdmin.rpc('set_profile_pin', {
          p_profile_id: userId,
          p_pin: staff.pin,
        })
        if (pinError) throw pinError
      } else {
        await supabaseAdmin.from('profiles').update({ pin_hash: null }).eq('id', userId)
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
