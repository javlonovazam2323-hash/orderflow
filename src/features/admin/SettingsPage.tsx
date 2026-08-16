import { useCallback, useEffect, useState } from 'react'
import { getSettings, updateSettings } from '@/lib/api/admin'
import { SERVICE_CHARGE_OPTIONS } from '@/lib/constants'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardHeader } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import type { RestaurantSettings, SettingsInput } from '@/types/database'

export function SettingsPage() {
  const [settings, setSettings] = useState<RestaurantSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    setSettings(await getSettings())
  }, [])

  useEffect(() => { load() }, [load])

  const update = (patch: Partial<SettingsInput>) => {
    if (!settings) return
    setSettings({ ...settings, ...patch } as RestaurantSettings)
    setSaved(false)
  }

  const handleSave = async () => {
    if (!settings) return
    setSaving(true)
    try {
      await updateSettings({
        name: settings.name,
        phone: settings.phone,
        address: settings.address,
        table_count: settings.table_count,
        service_charge_percent: settings.service_charge_percent,
        tax_percent: settings.tax_percent,
        currency: settings.currency,
        receipt_footer: settings.receipt_footer,
      })
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  if (!settings) return <div className="p-6 text-muted">Yuklanmoqda...</div>

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-2xl mx-auto">
      <header>
        <h1 className="text-2xl font-bold">Sozlamalar</h1>
        <p className="text-sm text-muted">Restoran va chek sozlamalari</p>
      </header>

      <Card>
        <CardHeader><h2 className="font-semibold">Restoran</h2></CardHeader>
        <CardContent className="space-y-4">
          <Input label="Restoran nomi" value={settings.name} onChange={(e) => update({ name: e.target.value })} />
          <Input label="Telefon" value={settings.phone ?? ''} onChange={(e) => update({ phone: e.target.value })} />
          <Input label="Manzil" value={settings.address ?? ''} onChange={(e) => update({ address: e.target.value })} />
          <Input label="Stol soni" type="number" value={String(settings.table_count ?? 30)} onChange={(e) => update({ table_count: parseInt(e.target.value, 10) })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2 className="font-semibold">Moliya</h2></CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-sm font-medium mb-2">Xizmat haqi %</p>
            <div className="flex flex-wrap gap-2">
              {SERVICE_CHARGE_OPTIONS.map((pct) => (
                <button
                  key={pct}
                  onClick={() => update({ service_charge_percent: pct })}
                  className={`px-4 py-2 rounded-xl text-sm font-medium border-2 ${
                    settings.service_charge_percent === pct
                      ? 'border-brand-600 bg-brand-50 dark:bg-brand-900/20 text-brand-700'
                      : 'border-border'
                  }`}
                >
                  {pct}%
                </button>
              ))}
              <Input
                type="number"
                value={String(settings.service_charge_percent)}
                onChange={(e) => update({ service_charge_percent: parseFloat(e.target.value) || 0 })}
                className="w-24"
              />
            </div>
          </div>
          <Input label="Soliq %" type="number" value={String(settings.tax_percent ?? 0)} onChange={(e) => update({ tax_percent: parseFloat(e.target.value) || 0 })} />
          <Input label="Valyuta" value={settings.currency} onChange={(e) => update({ currency: e.target.value })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader><h2 className="font-semibold">Chek</h2></CardHeader>
        <CardContent>
          <Input label="Chek pastki qismi" value={settings.receipt_footer ?? ''} onChange={(e) => update({ receipt_footer: e.target.value })} placeholder="Rahmat!" />
        </CardContent>
      </Card>

      <Button size="lg" className="w-full" loading={saving} onClick={handleSave}>
        Saqlash
      </Button>
      {saved && <p className="text-center text-sm text-green-600">Saqlandi ✓</p>}
    </div>
  )
}
