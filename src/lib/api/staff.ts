import { getSupabase, USE_MOCK } from '@/lib/supabase'
import { mockStore } from '@/lib/mock/store'
import type { Profile, UserRole } from '@/types/database'

export interface StaffMember extends Profile {
  email: string
  has_pin: boolean
}

export interface CreateStaffInput {
  email: string
  password: string
  full_name: string
  role: UserRole
  pin?: string | null
  is_active?: boolean
}

export interface UpdateStaffInput {
  profile_id: string
  full_name?: string
  role?: UserRole
  pin?: string | null
  is_active?: boolean
}

export interface BootstrapResult {
  email: string
  role: string
  password: string
  pin: string | null
}

async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke(name, { body })
  if (error) throw error
  if (data?.error) throw new Error(data.error as string)
  return data as T
}

export async function needsSetup(): Promise<boolean> {
  if (USE_MOCK) return false
  const { data, error } = await getSupabase().rpc('needs_setup')
  if (error) return false
  return Boolean(data)
}

export async function bootstrapStaff(setupSecret?: string): Promise<BootstrapResult[]> {
  if (USE_MOCK) {
    return mockStore.bootstrapStaff()
  }
  const data = await invokeFunction<{ staff: BootstrapResult[] }>('bootstrap-staff', {
    setupSecret: setupSecret ?? '',
  })
  return data.staff
}

export async function listStaff(): Promise<StaffMember[]> {
  if (USE_MOCK) return mockStore.listStaff()
  const data = await invokeFunction<{ staff: StaffMember[] }>('manage-staff', { action: 'list' })
  return data.staff
}

export async function createStaff(input: CreateStaffInput): Promise<string> {
  if (USE_MOCK) return mockStore.createStaff(input)
  const data = await invokeFunction<{ id: string }>('manage-staff', {
    action: 'create',
    ...input,
  })
  return data.id
}

export async function updateStaff(input: UpdateStaffInput): Promise<void> {
  if (USE_MOCK) {
    mockStore.updateStaff(input)
    return
  }
  await invokeFunction('manage-staff', { action: 'update', ...input })
}

export async function resetStaffPassword(profileId: string, password: string): Promise<void> {
  if (USE_MOCK) {
    mockStore.resetStaffPassword(profileId, password)
    return
  }
  await invokeFunction('manage-staff', {
    action: 'reset_password',
    profile_id: profileId,
    password,
  })
}

export async function setStaffPin(profileId: string, pin: string | null): Promise<void> {
  if (USE_MOCK) {
    mockStore.setStaffPin(profileId, pin)
    return
  }
  const { error } = await getSupabase().rpc('admin_set_profile_pin', {
    p_profile_id: profileId,
    p_pin: pin ?? '',
  })
  if (error) throw error
}
