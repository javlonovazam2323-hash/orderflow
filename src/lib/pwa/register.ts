import { registerSW } from 'virtual:pwa-register'

let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined

export function initPwa(onNeedRefresh?: () => void) {
  if (import.meta.env.DEV && import.meta.env.VITE_PWA_DEV !== 'true') return

  updateSW = registerSW({
    onNeedRefresh() {
      onNeedRefresh?.()
    },
    onOfflineReady() {
      console.info('[OrderFlow] PWA offline tayyor')
    },
    onRegistered(registration) {
      // Har 60 daqiqada yangilanishni tekshirish
      if (registration) {
        setInterval(() => registration.update(), 60 * 60 * 1000)
      }
    },
  })
}

export async function applyPwaUpdate() {
  await updateSW?.(true)
}

export function isPwaInstalled(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || ('standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true)
}

export function canInstallPwa(): boolean {
  return 'BeforeInstallPromptEvent' in window || isPwaInstalled()
}
