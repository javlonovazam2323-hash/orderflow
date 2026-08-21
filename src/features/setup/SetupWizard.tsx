import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createRestaurant, verifyCreatedRestaurant } from '@/lib/api/onboarding'
import { createCategory, createMenuItem, updateSettings } from '@/lib/api/admin'
import { createStaff } from '@/lib/api/staff'
import { uploadMenuImage, uploadRestaurantLogo } from '@/lib/storage/menuImages'
import { ROLE_HOME, ROLE_LABELS, SERVICE_CHARGE_OPTIONS } from '@/lib/constants'
import { isValidSlug, slugify } from '@/lib/tenant/slug'
import { Button } from '@/components/ui/Button'
import { Card, CardContent } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/hooks/useAuth'
import { useTenantStore } from '@/stores/tenantStore'
import type { UserRole } from '@/types/database'

const STEPS = [
  { key: 'name', label: 'Nomi' },
  { key: 'logo', label: 'Logo' },
  { key: 'phone', label: 'Telefon' },
  { key: 'address', label: 'Manzil' },
  { key: 'tables', label: 'Stollar' },
  { key: 'service', label: 'Xizmat haqi' },
  { key: 'menu', label: 'Menyu' },
  { key: 'staff', label: 'Xodimlar' },
  { key: 'done', label: 'Tayyor' },
] as const

const STAFF_ROLES: UserRole[] = ['admin', 'cashier', 'waiter', 'kitchen']

interface WizardDraft {
  name: string
  slug: string
  slugTouched: boolean
  logoFile: File | null
  logoPreview: string | null
  phone: string
  address: string
  tableCount: number
  serviceCharge: number
}

export function SetupWizard() {
  const { user, signIn, signUp, signOut } = useAuth()
  const navigate = useNavigate()
  const memberships = useTenantStore((s) => s.memberships)
  const active = useTenantStore((s) => s.active)

  const [step, setStep] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [createdId, setCreatedId] = useState<string | null>(null)
  const [createdSlug, setCreatedSlug] = useState('')
  const [logoWarning, setLogoWarning] = useState('')
  const [menuNote, setMenuNote] = useState('')
  const [staffNote, setStaffNote] = useState('')

  const [draft, setDraft] = useState<WizardDraft>({
    name: '',
    slug: '',
    slugTouched: false,
    logoFile: null,
    logoPreview: null,
    phone: '',
    address: '',
    tableCount: 10,
    serviceCharge: 10,
  })

  const createdLocked = Boolean(createdId)

  useEffect(() => {
    return () => {
      if (draft.logoPreview) URL.revokeObjectURL(draft.logoPreview)
    }
  }, [draft.logoPreview])

  const patch = (next: Partial<WizardDraft>) => setDraft((d) => ({ ...d, ...next }))

  const goNext = async () => {
    setError('')
    if (!user) return
    if (step === 0 && !draft.name.trim()) {
      setError('Restoran nomini kiriting')
      return
    }
    if (step === 0 && !isValidSlug(draft.slug)) {
      setError('Slug faqat lotin harflar, raqam va chiziqcha (bella-pizza)')
      return
    }
    if (step === 4 && (!Number.isFinite(draft.tableCount) || draft.tableCount < 1)) {
      setError('Stol soni kamida 1 bo\'lishi kerak')
      return
    }
    if (step === 5 && !createdLocked) {
      await provisionRestaurant()
      return
    }
    if (step < STEPS.length - 1) setStep((s) => s + 1)
  }

  const goBack = () => {
    setError('')
    if (createdLocked && step <= 6) return
    if (step > 0) setStep((s) => s - 1)
  }

  const provisionRestaurant = async () => {
    if (!user) {
      setError('Avval hisobga kiring')
      return
    }
    setBusy(true)
    setError('')
    setLogoWarning('')
    try {
      const created = await createRestaurant({
        name: draft.name.trim(),
        slug: draft.slug,
        phone: draft.phone.trim() || null,
        address: draft.address.trim() || null,
        logo_url: null,
        service_charge_percent: draft.serviceCharge,
        table_count: draft.tableCount,
      })
      await verifyCreatedRestaurant(created.id, draft.tableCount)
      await useTenantStore.getState().loadForUser(user.id, 'admin')
      const selected = useTenantStore.getState().selectRestaurant(created.id)
      if (!selected) throw new Error('Yangi restoran tanlanmadi')

      if (draft.logoFile) {
        try {
          const url = await uploadRestaurantLogo(draft.logoFile)
          await updateSettings({ logo_url: url })
        } catch (e) {
          setLogoWarning(e instanceof Error ? e.message : 'Logo yuklanmadi — keyin Sozlamalardan qo\'shishingiz mumkin')
        }
      }

      setCreatedId(created.id)
      setCreatedSlug(created.slug)
      setStep(6)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restoran yaratilmadi')
    } finally {
      setBusy(false)
    }
  }

  const finish = () => {
    const role = (useTenantStore.getState().active?.role ?? user?.role ?? 'admin') as UserRole
    navigate(ROLE_HOME[role], { replace: true })
  }

  return (
    <div className="min-h-full flex flex-col bg-gradient-to-b from-slate-900 to-slate-800">
      <header className="px-4 pt-5 pb-3 sm:px-6">
        <div className="mx-auto max-w-2xl flex items-start justify-between gap-3">
          <div>
            <p className="text-brand-500 text-xs font-semibold uppercase tracking-wide">OrderFlow</p>
            <h1 className="text-white text-xl sm:text-2xl font-bold">Restoran sozlash</h1>
          </div>
          {memberships.length > 0 ? (
            <Link to={ROLE_HOME[(active?.role ?? 'admin') as UserRole]} className="text-xs text-slate-400 hover:text-white">
              Bekor
            </Link>
          ) : user ? (
            <button type="button" className="text-xs text-slate-400 hover:text-white" onClick={() => void signOut()}>
              Chiqish
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex-1 px-4 pb-8 sm:px-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {!user ? (
            <AccountStep signIn={signIn} signUp={signUp} />
          ) : (
            <>
              <Stepper current={step} />
              <Card>
                <CardContent className="pt-5 space-y-4">
                  {step === 0 && (
                    <NameStep
                      name={draft.name}
                      slug={draft.slug}
                      onName={(name) => patch({
                        name,
                        slug: draft.slugTouched ? draft.slug : slugify(name),
                      })}
                      onSlug={(slug) => patch({ slug: slugify(slug), slugTouched: true })}
                    />
                  )}
                  {step === 1 && (
                    <LogoStep
                      preview={draft.logoPreview}
                      onFile={(file) => {
                        if (draft.logoPreview) URL.revokeObjectURL(draft.logoPreview)
                        patch({
                          logoFile: file,
                          logoPreview: file ? URL.createObjectURL(file) : null,
                        })
                      }}
                    />
                  )}
                  {step === 2 && (
                    <Input
                      label="Telefon"
                      type="tel"
                      value={draft.phone}
                      onChange={(e) => patch({ phone: e.target.value })}
                      placeholder="+998 90 123 45 67"
                    />
                  )}
                  {step === 3 && (
                    <Input
                      label="Manzil"
                      value={draft.address}
                      onChange={(e) => patch({ address: e.target.value })}
                      placeholder="Toshkent, ..."
                    />
                  )}
                  {step === 4 && (
                    <Input
                      label="Stol soni"
                      type="number"
                      min={1}
                      max={200}
                      value={String(draft.tableCount)}
                      onChange={(e) => patch({ tableCount: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                    />
                  )}
                  {step === 5 && (
                    <ServiceStep
                      value={draft.serviceCharge}
                      onChange={(serviceCharge) => patch({ serviceCharge })}
                    />
                  )}
                  {step === 6 && (
                    <MenuStep
                      note={menuNote}
                      busy={busy}
                      onSkip={() => { setError(''); setStep(7) }}
                      onAdded={(msg) => setMenuNote(msg)}
                      setBusy={setBusy}
                      setError={setError}
                    />
                  )}
                  {step === 7 && (
                    <StaffStep
                      note={staffNote}
                      busy={busy}
                      onSkip={() => { setError(''); setStep(8) }}
                      onAdded={(msg) => setStaffNote(msg)}
                      setBusy={setBusy}
                      setError={setError}
                    />
                  )}
                  {step === 8 && (
                    <DoneStep
                      name={draft.name}
                      slug={createdSlug}
                      tableCount={draft.tableCount}
                      logoWarning={logoWarning}
                      menuNote={menuNote}
                      staffNote={staffNote}
                    />
                  )}

                  {error && <p className="text-sm text-red-600">{error}</p>}
                  {logoWarning && step >= 6 && <p className="text-xs text-amber-700">{logoWarning}</p>}

                  {step < 6 && (
                    <div className="flex gap-2 pt-1">
                      {step > 0 && (
                        <Button type="button" variant="ghost" className="flex-1" onClick={goBack} disabled={busy || createdLocked}>
                          Orqaga
                        </Button>
                      )}
                      <Button type="button" className="flex-1" loading={busy} onClick={() => void goNext()}>
                        {step === 5 ? 'Restoranni yaratish' : 'Davom etish'}
                      </Button>
                    </div>
                  )}

                  {step === 8 && (
                    <Button type="button" size="lg" className="w-full" onClick={finish}>
                      Ishni boshlash →
                    </Button>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Stepper({ current }: { current: number }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-slate-300">
        <p className="text-sm font-medium">{STEPS[current].label}</p>
        <p className="text-xs text-slate-400">{current + 1} / {STEPS.length}</p>
      </div>
      <div className="h-1.5 rounded-full bg-slate-700 overflow-hidden">
        <div
          className="h-full rounded-full bg-brand-500 transition-all"
          style={{ width: `${((current + 1) / STEPS.length) * 100}%` }}
        />
      </div>
      <div className="hidden md:flex gap-1 overflow-x-auto scrollbar-hide">
        {STEPS.map((s, i) => (
          <span
            key={s.key}
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${
              i === current
                ? 'bg-brand-600 text-white'
                : i < current
                  ? 'bg-brand-900/40 text-brand-300'
                  : 'bg-slate-800 text-slate-500'
            }`}
          >
            {i + 1}. {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function AccountStep({
  signIn,
  signUp,
}: {
  signIn: (email: string, password: string) => Promise<boolean>
  signUp: (email: string, password: string) => Promise<{ ok: boolean; needsEmailConfirm: boolean; error?: string }>
}) {
  const [mode, setMode] = useState<'login' | 'signup'>('signup')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    if (mode === 'signup' && password !== confirm) {
      setError('Parollar mos emas')
      return
    }
    if (password.length < 6) {
      setError('Parol kamida 6 belgidan iborat bo\'lsin')
      return
    }
    setLoading(true)
    try {
      if (mode === 'login') {
        const ok = await signIn(email, password)
        if (!ok) setError('Login yoki parol noto\'g\'ri')
      } else {
        const result = await signUp(email, password)
        if (result.needsEmailConfirm) {
          setInfo('Emailingizga tasdiqlash xati yuborildi. Tasdiqlang, keyin shu yerdan kiring.')
        } else if (!result.ok) {
          setError(result.error ?? 'Ro\'yxatdan o\'tish muvaffaqiyatsiz')
        }
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardContent className="pt-5 space-y-4">
        <div>
          <h2 className="font-semibold text-lg">Hisob</h2>
          <p className="text-sm text-muted">Yangi restoran ochish uchun avval hisob yarating yoki kiring.</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant={mode === 'signup' ? 'primary' : 'outline'} onClick={() => setMode('signup')}>
            Ro‘yxat
          </Button>
          <Button type="button" variant={mode === 'login' ? 'primary' : 'outline'} onClick={() => setMode('login')}>
            Kirish
          </Button>
        </div>
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
          <Input label="Parol" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
          {mode === 'signup' && (
            <Input label="Parolni tasdiqlang" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
          )}
          {error && <p className="text-sm text-red-600">{error}</p>}
          {info && <p className="text-sm text-amber-700 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-3 py-2">{info}</p>}
          <Button type="submit" className="w-full" size="lg" loading={loading}>
            {mode === 'signup' ? 'Hisob yaratish' : 'Kirish'}
          </Button>
        </form>
        <Link to="/login" className="block text-center text-sm text-brand-600 hover:underline">
          Login sahifasiga
        </Link>
      </CardContent>
    </Card>
  )
}

function NameStep({
  name,
  slug,
  onName,
  onSlug,
}: {
  name: string
  slug: string
  onName: (v: string) => void
  onSlug: (v: string) => void
}) {
  return (
    <div className="space-y-4">
      <Input label="Restoran nomi" value={name} onChange={(e) => onName(e.target.value)} placeholder="Bella Pizza" autoFocus />
      <Input label="Slug (havola)" value={slug} onChange={(e) => onSlug(e.target.value)} placeholder="bella-pizza" />
      <p className="text-xs text-muted">Slug avtomatik hosil bo‘ladi. Band bo‘lsa, tizim bella-pizza-2 qo‘shadi.</p>
    </div>
  )
}

function LogoStep({
  preview,
  onFile,
}: {
  preview: string | null
  onFile: (file: File | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Logo (ixtiyoriy)</p>
      <div className="flex items-center gap-4">
        <div className="h-20 w-20 rounded-2xl bg-surface-2 overflow-hidden flex items-center justify-center text-3xl">
          {preview ? <img src={preview} alt="" className="h-full w-full object-cover" /> : '🍽️'}
        </div>
        <div className="space-y-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/webp"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
            Rasm tanlash
          </Button>
          {preview && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onFile(null)}>Olib tashlash</Button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted">Keyin ham Sozlamalardan qo‘shish mumkin.</p>
    </div>
  )
}

function ServiceStep({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">Xizmat haqi %</p>
      <div className="flex flex-wrap gap-2">
        {SERVICE_CHARGE_OPTIONS.map((pct) => (
          <button
            key={pct}
            type="button"
            onClick={() => onChange(pct)}
            className={`px-4 py-2 rounded-xl text-sm font-medium border-2 ${
              value === pct ? 'border-brand-600 bg-brand-50 dark:bg-brand-900/20 text-brand-700' : 'border-border'
            }`}
          >
            {pct}%
          </button>
        ))}
      </div>
      <Input
        label="Yoki boshqa %"
        type="number"
        min={0}
        max={100}
        value={String(value)}
        onChange={(e) => onChange(Math.min(100, Math.max(0, Number(e.target.value) || 0)))}
      />
    </div>
  )
}

function MenuStep({
  note,
  busy,
  onSkip,
  onAdded,
  setBusy,
  setError,
}: {
  note: string
  busy: boolean
  onSkip: () => void
  onAdded: (msg: string) => void
  setBusy: (v: boolean) => void
  setError: (v: string) => void
}) {
  const [category, setCategory] = useState('')
  const [itemName, setItemName] = useState('')
  const [price, setPrice] = useState('')
  const [file, setFile] = useState<File | null>(null)

  const add = async () => {
    if (!category.trim() || !itemName.trim()) {
      setError('Kategoriya va mahsulot nomini kiriting')
      return
    }
    const parsed = parseInt(price, 10)
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError('Narxni kiriting')
      return
    }
    setBusy(true)
    setError('')
    try {
      const cat = await createCategory({ name: category.trim() })
      let imageUrl: string | null = null
      if (file) imageUrl = await uploadMenuImage(file)
      await createMenuItem({
        category_id: cat.id,
        name: itemName.trim(),
        price: parsed,
        description: null,
        prep_time_minutes: 15,
        is_available: true,
        image_url: imageUrl,
      })
      onAdded(`Qo\'shildi: ${category.trim()} / ${itemName.trim()}`)
      setCategory('')
      setItemName('')
      setPrice('')
      setFile(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Menyu qo\'shilmadi')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold">Menyu</h2>
        <p className="text-sm text-muted">Ixtiyoriy. Keyin Admin → Menyu orqali to‘ldirasiz.</p>
      </div>
      {note && <p className="text-sm text-green-700 bg-green-50 dark:bg-green-900/20 rounded-xl px-3 py-2">{note}</p>}
      <Input label="Kategoriya" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Ichimliklar" />
      <Input label="Mahsulot" value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="Coca-Cola" />
      <Input label="Narx (so‘m)" type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
      <input type="file" accept="image/jpeg,image/jpg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={onSkip} disabled={busy}>O‘tkazib yuborish</Button>
        <Button type="button" className="flex-1" loading={busy} onClick={() => void add()}>Qo‘shish</Button>
      </div>
      {note && (
        <Button type="button" variant="outline" className="w-full" onClick={onSkip} disabled={busy}>
          Davom etish
        </Button>
      )}
    </div>
  )
}

function StaffStep({
  note,
  busy,
  onSkip,
  onAdded,
  setBusy,
  setError,
}: {
  note: string
  busy: boolean
  onSkip: () => void
  onAdded: (msg: string) => void
  setBusy: (v: boolean) => void
  setError: (v: string) => void
}) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('waiter')
  const [pin, setPin] = useState('')

  const add = async () => {
    if (!fullName.trim() || !email.trim() || password.length < 6) {
      setError('Ism, email va kamida 6 belgilik parol kiriting')
      return
    }
    setBusy(true)
    setError('')
    try {
      await createStaff({
        email: email.trim(),
        password,
        full_name: fullName.trim(),
        role,
        pin: pin || null,
      })
      onAdded(`Qo\'shildi: ${fullName.trim()} (${ROLE_LABELS[role]})`)
      setFullName('')
      setEmail('')
      setPassword('')
      setPin('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Xodim qo\'shilmadi')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold">Xodimlar</h2>
        <p className="text-sm text-muted">Siz allaqachon admin ekansiz. Qo‘shimcha xodim ixtiyoriy.</p>
      </div>
      {note && <p className="text-sm text-green-700 bg-green-50 dark:bg-green-900/20 rounded-xl px-3 py-2">{note}</p>}
      <Input label="Ism familiya" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <Input label="Parol" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <div>
        <p className="text-sm font-medium mb-2">Rol</p>
        <div className="flex flex-wrap gap-2">
          {STAFF_ROLES.map((r) => (
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
        label="PIN (ixtiyoriy, shu restoran uchun)"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
        placeholder="4 raqam"
        maxLength={4}
      />
      <div className="flex gap-2">
        <Button type="button" variant="ghost" className="flex-1" onClick={onSkip} disabled={busy}>O‘tkazib yuborish</Button>
        <Button type="button" className="flex-1" loading={busy} onClick={() => void add()}>Qo‘shish</Button>
      </div>
      <Button type="button" variant="outline" className="w-full" onClick={onSkip} disabled={busy}>
        Tayyor sahifasiga
      </Button>
    </div>
  )
}

function DoneStep({
  name,
  slug,
  tableCount,
  logoWarning,
  menuNote,
  staffNote,
}: {
  name: string
  slug: string
  tableCount: number
  logoWarning: string
  menuNote: string
  staffNote: string
}) {
  return (
    <div className="space-y-3 text-center">
      <div className="text-4xl">✅</div>
      <h2 className="text-xl font-bold">Tayyor!</h2>
      <p className="text-sm text-muted">
        <span className="font-medium text-slate-800 dark:text-slate-100">{name}</span>
        {slug ? ` · ${slug}` : ''} · {tableCount} ta stol
      </p>
      {logoWarning && <p className="text-xs text-amber-700">{logoWarning}</p>}
      {menuNote && <p className="text-xs text-muted">{menuNote}</p>}
      {staffNote && <p className="text-xs text-muted">{staffNote}</p>}
      <p className="text-xs text-muted">Siz ushbu restoran adminisiz. Savat va oflayn navbat yangi tenant uchun tozalandi.</p>
    </div>
  )
}
