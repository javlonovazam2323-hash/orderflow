import { getSupabase, USE_MOCK } from '@/lib/supabase'

export type GuestCallAction = 'waiter_call' | 'bill_request'
export type GuestCallStatus = 'pending' | 'acknowledged'

export interface GuestPendingCall {
  id: string
  action: GuestCallAction
  status: GuestCallStatus
}

export interface GuestTableInfo {
  restaurant_name: string
  restaurant_logo_url: string | null
  table_number: number
  has_waiter: boolean
  waiter_name: string | null
  waiter_avatar_url: string | null
  pending_call: GuestPendingCall | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isPublicTableToken(value: string | undefined): value is string {
  return !!value && UUID_RE.test(value)
}

function parseInfo(raw: unknown): GuestTableInfo {
  const row = (raw ?? {}) as Record<string, unknown>
  const pending = row.pending_call as Record<string, unknown> | null
  return {
    restaurant_name: String(row.restaurant_name ?? ''),
    restaurant_logo_url: (row.restaurant_logo_url as string | null) ?? null,
    table_number: Number(row.table_number ?? 0),
    has_waiter: Boolean(row.has_waiter),
    waiter_name: (row.waiter_name as string | null) ?? null,
    waiter_avatar_url: (row.waiter_avatar_url as string | null) ?? null,
    pending_call: pending?.id
      ? {
          id: String(pending.id),
          action: pending.action === 'bill_request' ? 'bill_request' : 'waiter_call',
          status: pending.status === 'acknowledged' ? 'acknowledged' : 'pending',
        }
      : null,
  }
}

function rpcErrorCode(error: { message?: string } | null): string {
  const msg = (error?.message ?? '').toLowerCase()
  if (msg.includes('invalid_token')) return 'invalid_token'
  if (msg.includes('no_waiter')) return 'no_waiter'
  if (msg.includes('rate_limited')) return 'rate_limited'
  if (msg.includes('invalid_action')) return 'invalid_action'
  return 'unknown'
}

export async function fetchGuestTableInfo(slug: string, token: string): Promise<GuestTableInfo> {
  if (USE_MOCK) {
    return {
      restaurant_name: 'Demo',
      restaurant_logo_url: null,
      table_number: 1,
      has_waiter: true,
      waiter_name: 'Ofitsiant Sardor',
      waiter_avatar_url: null,
      pending_call: null,
    }
  }
  const { data, error } = await getSupabase().rpc('guest_table_info', {
    p_slug: slug,
    p_token: token,
  })
  if (error) {
    const err = new Error(rpcErrorCode(error))
    throw err
  }
  return parseInfo(data)
}

export async function submitGuestTableAction(
  slug: string,
  token: string,
  action: GuestCallAction,
): Promise<{ notification_id: string; action: GuestCallAction }> {
  if (USE_MOCK) {
    return { notification_id: 'mock', action }
  }
  const { data, error } = await getSupabase().rpc('guest_table_action', {
    p_slug: slug,
    p_token: token,
    p_action: action,
  })
  if (error) {
    throw new Error(rpcErrorCode(error))
  }
  const row = data as { notification_id?: string; action?: string }
  return {
    notification_id: String(row.notification_id ?? ''),
    action: row.action === 'bill_request' ? 'bill_request' : 'waiter_call',
  }
}
