import { useEffect, useState } from 'react'
import { guestTableAbsoluteUrl, renderQrDataUrl } from '@/lib/qr/tableQr'
import { Button } from '@/components/ui/Button'

export function TableQrModal({
  restaurantName,
  slug,
  tableNumber,
  publicToken,
  onClose,
}: {
  restaurantName: string
  slug: string
  tableNumber: number
  publicToken: string
  onClose: () => void
}) {
  const url = guestTableAbsoluteUrl(slug, publicToken)
  const [dataUrl, setDataUrl] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    renderQrDataUrl(url)
      .then((next) => { if (!cancelled) setDataUrl(next) })
      .catch(() => { if (!cancelled) setError('QR yaratilmadi') })
    return () => { cancelled = true }
  }, [url])

  const download = () => {
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `orderflow-stol-${tableNumber}.png`
    a.click()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl bg-surface p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div id="qr-print-root" className="space-y-3 text-center">
          <p className="text-xs font-semibold tracking-widest uppercase text-muted">OrderFlow</p>
          <p className="font-bold text-lg">{restaurantName}</p>
          <p className="text-xl font-bold">Stol №{tableNumber}</p>
          {dataUrl ? (
            <img src={dataUrl} alt={`Stol ${tableNumber} QR`} className="mx-auto w-56 h-56 bg-white rounded-xl" />
          ) : (
            <div className="mx-auto w-56 h-56 rounded-xl bg-surface-2 animate-pulse" />
          )}
          <p className="text-sm text-muted">Ofitsiantni chaqirish uchun skaner qiling</p>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button className="flex-1" variant="outline" onClick={download} disabled={!dataUrl}>Yuklab olish</Button>
          <Button className="flex-1" onClick={() => window.print()}>Chop etish</Button>
        </div>
        <Button variant="ghost" className="w-full" onClick={onClose}>Yopish</Button>
      </div>
    </div>
  )
}
