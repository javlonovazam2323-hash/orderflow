import { cn } from '@/lib/format'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'

export function OfflineBanner() {
  const { online, pendingCount, syncing, syncQueue } = useOnlineStatus()

  if (online && pendingCount === 0) return null

  return (
    <div
      className={cn(
        'sticky top-0 z-50 px-4 py-2 text-sm font-medium flex items-center justify-between gap-2',
        online ? 'bg-amber-500 text-white' : 'bg-red-600 text-white',
      )}
    >
      <span>
        {!online && '📡 Internet yo\'q — buyurtmalar navbatda saqlanadi'}
        {online && pendingCount > 0 && `⏳ ${pendingCount} ta navbatdagi amal`}
      </span>
      {online && pendingCount > 0 && (
        <button
          onClick={() => syncQueue()}
          disabled={syncing}
          className="shrink-0 px-3 py-1 rounded-lg bg-white/20 text-xs font-bold"
        >
          {syncing ? '...' : 'Yuborish'}
        </button>
      )}
    </div>
  )
}
