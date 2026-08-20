import { getSupabase } from '@/lib/supabase'

export async function getCurrentRestaurantId(): Promise<string> {
  const { data, error } = await getSupabase().rpc('get_current_restaurant_id')
  if (error) throw error
  if (!data) throw new Error('No restaurant membership')
  return data as string
}
