import { useEffect } from 'react'
import { initPwa } from '@/lib/pwa/register'
import { usePwa } from '@/hooks/usePwa'
import { Button } from '@/components/ui/Button'

export function PwaPrompts() {
  const { needRefresh, setNeedRefresh, canInstall, install, refresh } = usePwa()

  useEffect(() => {
    initPwa(() => setNeedRefresh(true))
  }, [setNeedRefresh])

  if (!needRefresh && !canInstall) return null

  return (
    <div className="fixed bottom-20 md:bottom-4 inset-x-4 z-50 flex flex-col gap-2 max-w-sm mx-auto md:ml-auto md:mr-4 md:max-w-xs">
      {needRefresh && (
        <div className="rounded-2xl bg-slate-900 text-white p-4 shadow-xl flex items-center justify-between gap-3">
          <p className="text-sm">Yangi versiya mavjud</p>
          <Button size="sm" onClick={refresh}>Yangilash</Button>
        </div>
      )}
      {canInstall && (
        <div className="rounded-2xl bg-brand-600 text-white p-4 shadow-xl flex items-center justify-between gap-3">
          <p className="text-sm">Ilovani o'rnatish</p>
          <Button size="sm" variant="secondary" onClick={() => install()}>O'rnatish</Button>
        </div>
      )}
    </div>
  )
}
