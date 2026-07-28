import type { ReactNode } from 'react'

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

export function Panel({
  children,
  className = '',
  title,
  description,
}: {
  children: ReactNode
  className?: string
  title?: string
  description?: string
}) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      {(title || description) && (
        <div className="mb-4">
          {title && <h2 className="font-semibold text-ink">{title}</h2>}
          {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
        </div>
      )}
      {children}
    </div>
  )
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <p className="font-medium text-ink">{title}</p>
      {description && <p className="mt-2 text-sm text-slate-500">{description}</p>}
    </div>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'pending_review' || status === 'pending'
      ? 'bg-amber-100 text-amber-800'
      : status === 'approved' || status === 'succeeded'
        ? 'bg-emerald-100 text-emerald-800'
        : status === 'rejected' || status === 'failed'
          ? 'bg-red-100 text-red-800'
          : 'bg-slate-100 text-slate-700'
  const label =
    status === 'pending_review' ? '待审核'
      : status === 'approved' ? '已批准'
        : status === 'rejected' ? '已驳回'
          : status
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone}`}>
      {label}
    </span>
  )
}

export function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      {children}
    </div>
  )
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="mt-5 flex flex-wrap items-end gap-3">{children}</div>
}

export function StatCard({
  title,
  value,
  detail,
  compact = false,
}: {
  title: string
  value: string | number
  detail: string
  compact?: boolean
}) {
  return (
    <article className={`rounded-xl border border-slate-200 bg-white shadow-sm ${compact ? 'p-4' : 'p-5'}`}>
      <p className="text-sm text-slate-500">{title}</p>
      <p className={`mt-2 font-bold tabular-nums ${compact ? 'text-2xl' : 'text-3xl'}`}>{value}</p>
      <p className="mt-2 text-xs text-slate-500 leading-relaxed">{detail}</p>
    </article>
  )
}

export function Notice({ message }: { message: string }) {
  return <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{message}</p>
}

export function SuccessNotice({ message }: { message: string }) {
  return <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{message}</p>
}

export function Field({
  label,
  children,
  className = '',
}: {
  label: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <label className="mb-1 block text-xs font-medium text-slate-500">{label}</label>
      {children}
    </div>
  )
}

export const inputClass =
  'w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50'

export const btnPrimary =
  'inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand/90 disabled:opacity-50'

export const btnSecondary =
  'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50'

export const btnDanger =
  'inline-flex items-center justify-center rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50'

export const btnSuccess =
  'inline-flex items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50'
