export function guestTablePath(slug: string, publicToken: string): string {
  return `/guest/${encodeURIComponent(slug)}/${publicToken}`
}

export function guestTableAbsoluteUrl(slug: string, publicToken: string): string {
  const path = guestTablePath(slug, publicToken)
  if (typeof window === 'undefined') return path
  return `${window.location.origin}${path}`
}

export async function renderQrDataUrl(text: string, size = 512): Promise<string> {
  const QRCode = (await import('qrcode')).default
  return QRCode.toDataURL(text, {
    width: size,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#0f172a', light: '#ffffff' },
  })
}
