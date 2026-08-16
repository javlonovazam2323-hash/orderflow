import { useCallback, useState } from 'react'
import {
  createStaff,
  listStaff,
  resetStaffPassword,
  updateStaff,
  type CreateStaffInput,
  type StaffMember,
} from '@/lib/api/staff'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import type { UserRole } from '@/types/database'

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  cashier: 'Kassir',
  waiter: 'Ofitsiant',
  kitchen: 'Oshxona',
}

const ROLES: UserRole[] = ['admin', 'cashier', 'waiter', 'kitchen']

export function StaffPage() {
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [modal, setModal] = useState<'new' | StaffMember | null>(null)
  const [passwordModal, setPasswordModal] = useState<StaffMember | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const refresh = useCallback(async () => {
    setStaff(await listStaff())
  }, [])

  useRealtimeRefresh(refresh, [refresh])

  const handleCreate = async (data: CreateStaffInput) => {
    setSaving(true)
    setError('')
    try {
      await createStaff(data)
      setModal(null)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xatolik')
    } finally {
      setSaving(false)
    }
  }

  const handleUpdate = async (
    member: StaffMember,
    patch: { full_name?: string; role?: UserRole; is_active?: boolean; pin?: string | null },
  ) => {
    setSaving(true)
    setError('')
    try {
      await updateStaff({ profile_id: member.id, ...patch })
      setModal(null)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xatolik')
    } finally {
      setSaving(false)
    }
  }

  const handleResetPassword = async (member: StaffMember, password: string) => {
    setSaving(true)
    setError('')
    try {
      await resetStaffPassword(member.id, password)
      setPasswordModal(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xatolik')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-4xl mx-auto">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Xodimlar</h1>
          <p className="text-sm text-muted">Login, rol va PIN boshqaruvi</p>
        </div>
        <Button onClick={() => { setError(''); setModal('new') }}>+ Yangi xodim</Button>
      </header>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-4 py-2 rounded-xl">{error}</p>
      )}

      <div className="space-y-3">
        {staff.map((member) => (
          <Card key={member.id}>
            <CardContent className="pt-4 flex flex-wrap items-center gap-3 justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold">{member.full_name}</p>
                  <Badge className={member.is_active ? 'bg-green-100 text-green-800' : 'bg-slate-200 text-slate-600'}>
                    {member.is_active ? 'Faol' : 'Nofaol'}
                  </Badge>
                  {member.has_pin && <Badge className="bg-blue-100 text-blue-800">PIN ✓</Badge>}
                </div>
                <p className="text-sm text-muted">{member.email}</p>
                <p className="text-xs text-muted">{ROLE_LABELS[member.role]}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => { setError(''); setModal(member) }}>
                  Tahrirlash
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setError(''); setPasswordModal(member) }}>
                  Parol
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {modal === 'new' && (
        <StaffFormModal
          title="Yangi xodim"
          saving={saving}
          onClose={() => setModal(null)}
          onSubmit={(data) => handleCreate(data as CreateStaffInput)}
        />
      )}

      {modal && modal !== 'new' && (
        <StaffFormModal
          title="Xodimni tahrirlash"
          member={modal}
          saving={saving}
          onClose={() => setModal(null)}
          onSubmit={(data) => handleUpdate(modal, data)}
        />
      )}

      {passwordModal && (
        <PasswordModal
          member={passwordModal}
          saving={saving}
          onClose={() => setPasswordModal(null)}
          onSubmit={(password) => handleResetPassword(passwordModal, password)}
        />
      )}
    </div>
  )
}

function StaffFormModal({
  title,
  member,
  saving,
  onClose,
  onSubmit,
}: {
  title: string
  member?: StaffMember
  saving: boolean
  onClose: () => void
  onSubmit: (data: Record<string, unknown>) => void
}) {
  const [fullName, setFullName] = useState(member?.full_name ?? '')
  const [email, setEmail] = useState(member?.email ?? '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>(member?.role ?? 'waiter')
  const [pin, setPin] = useState('')
  const [isActive, setIsActive] = useState(member?.is_active ?? true)

  const handleSave = () => {
    if (member) {
      const data: Record<string, unknown> = {
        full_name: fullName,
        role,
        is_active: isActive,
      }
      if (pin.length > 0) data.pin = pin
      onSubmit(data)
    } else {
      if (!email || !password || !fullName) return
      onSubmit({
        email,
        password,
        full_name: fullName,
        role,
        pin: pin || null,
        is_active: isActive,
      })
    }
  }

  return (
    <Modal open onClose={onClose} title={title}>
      <div className="p-4 space-y-4">
        <Input label="Ism familiya" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        {!member && (
          <>
            <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Input label="Parol" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </>
        )}
        <div>
          <p className="text-sm font-medium mb-2">Rol</p>
          <div className="flex flex-wrap gap-2">
            {ROLES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRole(r)}
                className={`px-3 py-1.5 rounded-lg text-sm border-2 ${
                  role === r ? 'border-brand-600 bg-brand-50 dark:bg-brand-900/20' : 'border-border'
                }`}
              >
                {ROLE_LABELS[r]}
              </button>
            ))}
          </div>
        </div>
        <Input
          label={member ? 'Yangi PIN (bo\'sh = o\'zgarmaydi)' : 'PIN (ixtiyoriy)'}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="4 raqam"
          maxLength={4}
        />
        {member && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Faol xodim
          </label>
        )}
        <div className="flex gap-2 pt-2">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Bekor</Button>
          <Button className="flex-1" loading={saving} onClick={handleSave}>Saqlash</Button>
        </div>
      </div>
    </Modal>
  )
}

function PasswordModal({
  member,
  saving,
  onClose,
  onSubmit,
}: {
  member: StaffMember
  saving: boolean
  onClose: () => void
  onSubmit: (password: string) => void
}) {
  const [password, setPassword] = useState('')

  return (
    <Modal open onClose={onClose} title={`Parol: ${member.full_name}`}>
      <div className="p-4 space-y-4">
        <Input
          label="Yangi parol"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="flex gap-2 pt-2">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Bekor</Button>
          <Button className="flex-1" loading={saving} disabled={password.length < 6} onClick={() => onSubmit(password)}>
            Saqlash
          </Button>
        </div>
      </div>
    </Modal>
  )
}
