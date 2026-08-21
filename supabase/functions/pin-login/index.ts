import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  try {
    const { pin, restaurant_slug } = await req.json()
    if (!pin || String(pin).length < 4) {
      return json({ error: 'PIN 4 raqamdan iborat bo\'lishi kerak' }, 400)
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    let restaurantId: string | null = null
    if (restaurant_slug) {
      const { data: restaurant } = await supabaseAdmin
        .from('restaurants')
        .select('id')
        .eq('slug', String(restaurant_slug))
        .maybeSingle()
      restaurantId = restaurant?.id ?? null
      if (!restaurantId) {
        return json({ error: 'PIN noto\'g\'ri' }, 401)
      }
    } else {
      const { data: restaurants, error: listError } = await supabaseAdmin
        .from('restaurants')
        .select('id')
        .eq('is_active', true)
      if (listError) throw listError
      if (!restaurants || restaurants.length !== 1) {
        return json({ error: 'Restoran context kerak' }, 400)
      }
      restaurantId = restaurants[0].id
    }

    const { data: profileId, error: pinError } = await supabaseAdmin.rpc('verify_pin', {
      p_pin: String(pin),
      p_restaurant_id: restaurantId,
    })
    if (pinError || !profileId) {
      return json({ error: 'PIN noto\'g\'ri' }, 401)
    }

    const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(
      profileId as string,
    )
    if (userError || !userData.user.email) {
      return json({ error: 'Foydalanuvchi topilmadi' }, 404)
    }

    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'magiclink',
      email: userData.user.email,
    })
    if (linkError || !linkData.properties?.hashed_token) {
      throw linkError ?? new Error('Session yaratib bo\'lmadi')
    }

    return json({
      token_hash: linkData.properties.hashed_token,
      email: userData.user.email,
    })
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
