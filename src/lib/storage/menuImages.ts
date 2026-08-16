import { getSupabase } from '@/lib/supabase'

const BUCKET = 'menu-images'
const MAX_DIM = 1200
const MAX_BYTES = 800_000

export async function compressImage(file: File): Promise<Blob> {
  if (file.size <= MAX_BYTES && !file.type.includes('webp')) {
    return maybeResize(file)
  }
  return maybeResize(file, 0.85)
}

async function maybeResize(file: File, quality = 0.88): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Compress failed'))),
      'image/webp',
      quality,
    )
  })
}

export async function uploadMenuImage(file: File, itemId?: string): Promise<string> {
  const compressed = await compressImage(file)
  const ext = 'webp'
  const path = itemId ? `${itemId}/${Date.now()}.${ext}` : `new/${crypto.randomUUID()}.${ext}`

  const sb = getSupabase()
  const { error } = await sb.storage.from(BUCKET).upload(path, compressed, {
    contentType: 'image/webp',
    upsert: true,
  })
  if (error) throw error

  const { data } = sb.storage.from(BUCKET).getPublicUrl(path)
  return data.publicUrl
}

export async function deleteMenuImageFromUrl(url: string): Promise<void> {
  const marker = `/storage/v1/object/public/${BUCKET}/`
  const idx = url.indexOf(marker)
  if (idx === -1) return
  const path = url.slice(idx + marker.length)
  await getSupabase().storage.from(BUCKET).remove([path])
}
