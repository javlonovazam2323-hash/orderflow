import type { UserRole } from '@/types/database'

export const DEMO_PINS: Record<string, string> = {
  waiter: '1234',
  kitchen: '5678',
  cashier: '0000',
}

export const DEMO_USERS = [
  { email: 'admin@orderflow.uz', password: 'demo1234', pin: null, role: 'admin' as UserRole, name: 'Admin' },
  { email: 'kassir@orderflow.uz', password: 'demo1234', pin: '0000', role: 'cashier' as UserRole, name: 'Kassir Ali' },
  { email: 'ofitsiant@orderflow.uz', password: 'demo1234', pin: '1234', role: 'waiter' as UserRole, name: 'Ofitsiant Sardor' },
  { email: 'oshxona@orderflow.uz', password: 'demo1234', pin: '5678', role: 'kitchen' as UserRole, name: 'Oshpaz' },
] as const

export const ROLE_HOME: Record<UserRole, string> = {
  admin: '/admin',
  cashier: '/cashier',
  waiter: '/waiter/tables',
  kitchen: '/kitchen',
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  cashier: 'Kassir',
  waiter: 'Ofitsiant',
  kitchen: 'Oshxona',
}

export const SERVICE_CHARGE_OPTIONS = [0, 5, 10, 15] as const
