import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type Action = 'list' | 'create' | 'update' | 'reset_password'

interface StaffPayload {
  action: Action
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
    })
    const supabaseAdmin = createClient(supabaseUrl, serviceKey)

    const { data: { user }, error: userError } = await supabaseUser.auth.getUser()
    if (userError || !user) return json({ error: 'Unauthorized' }, 401)

    const { data: adminProfile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single()

    if (adminProfile?.role !== 'admin') {
      return json({ error: 'Admin ruxsati kerak' }, 403)
    }

    const body: StaffPayload = await req.json()
    const action = body.action

    if (action === 'list') {
      const { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('id, full_name, role, is_active, pin_hash')
        .order('role')
      if (error) throw error

      const { data: usersList } = await supabaseAdmin.auth.admin.listUsers()
      const emailById = new Map(
        (usersList?.users ?? []).map((u) => [u.id, u.email ?? '']),
      )

      const staff = (profiles ?? []).map((p) => ({
        id: p.id,
        full_name: p.full_name,
        role: p.role,
        is_active: p.is_active,
        email: emailById.get(p.id) ?? '',
        has_pin: Boolean(p.pin_hash),
      }))

      return json({ staff })
    }

    if (action === 'create') {
      if (!body.email || !body.password || !body.full_name || !body.role) {
        return json({ error: 'email, password, full_name, role kerak' }, 400)
      }

      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: body.email,
        password: body.password,
        email_confirm: true,
      })
      if (createError) throw createError

      const userId = newUser.user.id
      const { error: profileError } = await supabaseAdmin.from('profiles').insert({
        id: userId,
        full_name: body.full_name,
        role: body.role,
        is_active: body.is_active ?? true,
      })
      if (profileError) throw profileError

      if (body.pin) {
        await supabaseAdmin.rpc('set_profile_pin', { p_profile_id: userId, p_pin: body.pin })
      }

      return json({ success: true, id: userId })
    }

    if (action === 'update') {
      if (!body.profile_id) return json({ error: 'profile_id kerak' }, 400)

      const updates: Record<string, unknown> = {}
      if (body.full_name !== undefined) updates.full_name = body.full_name
      if (body.role !== undefined) updates.role = body.role
      if (body.is_active !== undefined) updates.is_active = body.is_active

      if (Object.keys(updates).length > 0) {
        const { error } = await supabaseAdmin
          .from('profiles')
          .update(updates)
          .eq('id', body.profile_id)
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

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
