import { useEffect, useState } from 'react'
import { applyPwaUpdate, isPwaInstalled } from '@/lib/pwa/register'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function usePwa() {
  const [needRefresh, setNeedRefresh] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(isPwaInstalled())

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault()
      setInstallPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    window.addEventListener('appinstalled', () => {
      setInstalled(true)
      setInstallPrompt(null)
    })
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const install = async () => {
    if (!installPrompt) return false
    await installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    setInstallPrompt(null)
    return outcome === 'accepted'
  }

  const refresh = () => applyPwaUpdate()

  return {
    needRefresh,
    setNeedRefresh,
    canInstall: !!installPrompt && !installed,
    installed,
    install,
    refresh,
  }
}
