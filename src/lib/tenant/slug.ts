const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', ғ: 'g', қ: 'q', ў: 'o', ҳ: 'h',
}

/** Bella Pizza → bella-pizza. Matches create_restaurant slug CHECK. */
export function slugify(input: string): string {
  let out = ''
  for (const ch of input.trim().toLowerCase()) {
    out += CYRILLIC[ch] ?? ch
  }
  out = out
    .replace(/[''`ʻʼ‘’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return out || 'restoran'
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
}

export function nextSlugAttempt(base: string, attempt: number): string {
  if (attempt <= 1) return base
  return `${base}-${attempt}`
}
