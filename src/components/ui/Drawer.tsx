import { cn } from '@/lib/format'
import { useEffect } from 'react'

interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  className?: string
}

export function Drawer({ open, onClose, title, children, className }: DrawerProps) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          'relative w-full max-w-lg h-full overflow-y-auto bg-surface border-l border-border shadow-2xl safe-bottom',
          className,
        )}
      >
        {title && (
          <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-border bg-surface">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button
              onClick={onClose}
              className="h-9 w-9 rounded-xl hover:bg-surface-2 flex items-center justify-center text-muted"
            >
              ✕
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
