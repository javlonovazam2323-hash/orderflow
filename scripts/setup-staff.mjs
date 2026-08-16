#!/usr/bin/env node
/**
 * OrderFlow dastlabki xodimlarni yaratish (CLI)
 *
 * .env faylida:
 *   SUPABASE_URL=https://xxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=eyJ...
 *
 * Ishlatish: node scripts/setup-staff.mjs
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

function loadEnv() {
  const envPath = resolve(root, '.env')
  if (!existsSync(envPath)) return
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim()
  }
}

loadEnv()

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('SUPABASE_URL va SUPABASE_SERVICE_ROLE_KEY kerak (.env)')
  process.exit(1)
}

const STAFF = [
  { email: 'admin@orderflow.uz', password: 'demo1234', full_name: 'Admin', role: 'admin', pin: null },
  { email: 'kassir@orderflow.uz', password: 'demo1234', full_name: 'Kassir Ali', role: 'cashier', pin: '0000' },
  { email: 'ofitsiant@orderflow.uz', password: 'demo1234', full_name: 'Ofitsiant Sardor', role: 'waiter', pin: '1234' },
  { email: 'oshxona@orderflow.uz', password: 'demo1234', full_name: 'Oshpaz', role: 'kitchen', pin: '5678' },
]

const supabase = createClient(url, key)

const { data: usersList } = await supabase.auth.admin.listUsers()
const byEmail = new Map((usersList?.users ?? []).filter((u) => u.email).map((u) => [u.email.toLowerCase(), u]))

for (const staff of STAFF) {
  let userId
  const existing = byEmail.get(staff.email.toLowerCase())

  if (existing) {
    userId = existing.id
    await supabase.auth.admin.updateUserById(userId, { password: staff.password, email_confirm: true })
    console.log(`✓ Yangilandi: ${staff.email}`)
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: staff.email,
      password: staff.password,
      email_confirm: true,
    })
    if (error) {
      console.error(`✗ ${staff.email}:`, error.message)
      continue
    }
    userId = data.user.id
    console.log(`✓ Yaratildi: ${staff.email}`)
  }

  await supabase.from('profiles').upsert(
    { id: userId, full_name: staff.full_name, role: staff.role, is_active: true },
    { onConflict: 'id' },
  )

  if (staff.pin) {
    await supabase.rpc('set_profile_pin', { p_profile_id: userId, p_pin: staff.pin })
  }
}

console.log('\nTayyor! Login: demo1234')
