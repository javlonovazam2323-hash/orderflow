import { cn } from '@/lib/format'
import type { InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
}

export function Input({ label, className, ...props }: InputProps) {
  return (
    <label className="block space-y-1.5">
      {label && <span className="text-sm font-medium text-slate-600 dark:text-slate-300">{label}</span>}
      <input
        className={cn(
          'w-full h-12 px-4 rounded-xl border border-border bg-surface text-slate-900 dark:text-slate-100',
          'placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand-500/40',
          className,
        )}
        {...props}
      />
    </label>
  )
}
