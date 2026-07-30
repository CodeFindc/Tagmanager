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
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
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
    <div className={`rounded-xl border border-slate-200 bg-white p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900/90 ${className}`}>
      {(title || description) && (
        <div className="mb-4">
          {title && <h2 className="font-semibold text-slate-900 dark:text-slate-100">{title}</h2>}
          {description && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{description}</p>}
        </div>
      )}
      {children}
    </div>
  )
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900/50">
      <p className="font-medium text-slate-900 dark:text-slate-100">{title}</p>
      {description && <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
    </div>
  )
}

const STATUS_META: Record<string, { label: string; tone: string }> = {
  pending_review: { label: '待审核', tone: 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300' },
  pending: { label: '待处理', tone: 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300' },
  approved: { label: '已批准', tone: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300' },
  rejected: { label: '已驳回', tone: 'bg-red-100 text-red-800 dark:bg-red-950/80 dark:text-red-300' },
  succeeded: { label: '成功', tone: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300' },
  failed: { label: '失败', tone: 'bg-red-100 text-red-800 dark:bg-red-950/80 dark:text-red-300' },
  queued: { label: '排队中', tone: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  running: { label: '运行中', tone: 'bg-sky-100 text-sky-800 dark:bg-sky-950/80 dark:text-sky-300' },
  retryable_failed: { label: '可重试失败', tone: 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300' },
  frozen: { label: '已冻结', tone: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  generating: { label: '生成中', tone: 'bg-sky-100 text-sky-800 dark:bg-sky-950/80 dark:text-sky-300' },
  awaiting_review: { label: '待审核', tone: 'bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300' },
}

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, tone: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.tone}`}>
      {meta.label}
    </span>
  )
}

export function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900/90">
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
    <article className={`rounded-xl border border-slate-200 bg-white shadow-xs dark:border-slate-800 dark:bg-slate-900/90 ${compact ? 'p-4' : 'p-5'}`}>
      <p className="text-sm text-slate-500 dark:text-slate-400">{title}</p>
      <p className={`mt-2 font-bold tabular-nums text-slate-900 dark:text-slate-100 ${compact ? 'text-2xl' : 'text-3xl'}`}>{value}</p>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{detail}</p>
    </article>
  )
}

export function Notice({ message }: { message: string }) {
  return <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/60 dark:text-amber-200">{message}</p>
}

export function SuccessNotice({ message }: { message: string }) {
  return <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-200">{message}</p>
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
      <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>
      {children}
    </div>
  )
}

export function Modal({
  children,
  onClose,
  wide = false,
  title,
}: {
  children: ReactNode
  onClose: () => void
  wide?: boolean
  title?: string
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-xs p-3 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-xl dark:bg-slate-900 dark:border dark:border-slate-800 ${wide ? 'max-w-4xl' : 'max-w-md'}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          {title ? <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">{title}</h2> : <span />}
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200" aria-label="关闭">
            关闭
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

export const inputClass =
  'w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100 dark:placeholder-slate-500'

export const btnPrimary =
  'inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50'

export const btnSecondary =
  'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:bg-slate-800'

export const btnDanger =
  'inline-flex items-center justify-center rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/60 dark:bg-red-950/60 dark:text-red-300 dark:hover:bg-red-900/50'

export const btnSuccess =
  'inline-flex items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50'

export const btnWarning =
  'inline-flex items-center justify-center rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800/60 dark:bg-amber-950/60 dark:text-amber-300 dark:hover:bg-amber-900/50'
