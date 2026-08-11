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
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800/60">
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">{title}</h1>
        {description && <p className="mt-1.5 text-xs sm:text-sm leading-relaxed text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2.5 shrink-0">{actions}</div>}
    </div>
  )
}

export function Panel({
  children,
  className = '',
  title,
  description,
  actions,
}: {
  children: ReactNode
  className?: string
  title?: string
  description?: string
  actions?: ReactNode
}) {
  return (
    <div className={`rounded-2xl glass-panel p-5 sm:p-6 ${className}`}>
      {(title || description || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            {title && <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">{title}</h2>}
            {description && <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{description}</p>}
          </div>
          {actions && <div>{actions}</div>}
        </div>
      )}
      {children}
    </div>
  )
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300/70 glass-soft p-8 sm:p-10 text-center dark:border-slate-700">
      <p className="font-semibold text-slate-900 dark:text-slate-100">{title}</p>
      {description && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-md mx-auto">{description}</p>}
    </div>
  )
}

const STATUS_META: Record<string, { label: string; tone: string }> = {
  pending_review: { label: '待审核', tone: 'bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-900/50' },
  pending: { label: '待处理', tone: 'bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-900/50' },
  approved: { label: '已批准', tone: 'bg-emerald-100 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-900/50' },
  rejected: { label: '已驳回', tone: 'bg-red-100 text-red-800 border border-red-200 dark:bg-red-950/80 dark:text-red-300 dark:border-red-900/50' },
  succeeded: { label: '成功', tone: 'bg-emerald-100 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/80 dark:text-emerald-300 dark:border-emerald-900/50' },
  failed: { label: '失败', tone: 'bg-red-100 text-red-800 border border-red-200 dark:bg-red-950/80 dark:text-red-300 dark:border-red-900/50' },
  queued: { label: '排队中', tone: 'bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' },
  running: { label: '运行中', tone: 'bg-sky-100 text-sky-800 border border-sky-200 dark:bg-sky-950/80 dark:text-sky-300 dark:border-sky-900/50' },
  retryable_failed: { label: '可重试失败', tone: 'bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-900/50' },
  frozen: { label: '已冻结', tone: 'bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' },
  generating: { label: '生成中', tone: 'bg-sky-100 text-sky-800 border border-sky-200 dark:bg-sky-950/80 dark:text-sky-300 dark:border-sky-900/50' },
  awaiting_review: { label: '待审核', tone: 'bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-950/80 dark:text-amber-300 dark:border-amber-900/50' },
}

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { label: status, tone: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${meta.tone}`}>
      {meta.label}
    </span>
  )
}

export function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl glass-panel">
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
    <article className={`rounded-2xl glass-panel transition-all hover:shadow-md ${compact ? 'p-4' : 'p-5'}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{title}</p>
      <p className={`mt-2.5 font-black tabular-nums tracking-tight text-slate-900 dark:text-white ${compact ? 'text-2xl' : 'text-3xl'}`}>{value}</p>
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{detail}</p>
    </article>
  )
}

export function Notice({ message }: { message: string }) {
  return <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50/90 p-3.5 text-xs sm:text-sm font-medium text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/60 dark:text-amber-200">{message}</p>
}

export function SuccessNotice({ message }: { message: string }) {
  return <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/90 p-3.5 text-xs sm:text-sm font-medium text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-200">{message}</p>
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
      <label className="mb-1.5 block text-xs font-semibold tracking-wide text-slate-600 dark:text-slate-300">{label}</label>
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
    <div className="fixed inset-0 z-50 grid place-items-center glass-overlay p-3 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={`flex max-h-[90vh] w-full flex-col overflow-hidden rounded-2xl glass-panel ${wide ? 'max-w-4xl' : 'max-w-md'}`}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/40 px-5 py-4 dark:border-white/10">
          {title ? <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{title}</h2> : <span />}
          <button type="button" onClick={onClose} className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors" aria-label="关闭">
            ✕ 关闭
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

export const inputClass =
  'w-full min-w-0 rounded-xl border border-white/50 bg-white/70 px-3.5 py-2 text-sm text-slate-900 outline-none transition-all duration-150 focus:border-brand focus:ring-2 focus:ring-brand/25 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-slate-900/60 dark:text-slate-100 dark:placeholder-slate-500 dark:focus:border-brand dark:focus:ring-brand/40'

export const btnPrimary =
  'inline-flex items-center justify-center rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand/25 hover:bg-brand-dark transition-all duration-150 active:scale-[0.98] disabled:opacity-50 cursor-pointer'

export const btnSecondary =
  'inline-flex items-center justify-center rounded-xl glass-soft px-4 py-2.5 text-sm font-medium text-slate-700 hover:text-slate-900 transition-all duration-150 disabled:opacity-50 dark:text-slate-200 dark:hover:text-white cursor-pointer'

export const btnDanger =
  'inline-flex items-center justify-center rounded-xl border border-rose-200/80 bg-rose-50/80 px-4 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-100/80 transition-all duration-150 disabled:opacity-50 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300 dark:hover:bg-rose-900/50 cursor-pointer'

export const btnSuccess =
  'inline-flex items-center justify-center rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-emerald-600/20 hover:bg-emerald-700 transition-all duration-150 active:scale-[0.98] disabled:opacity-50 cursor-pointer'

export const btnWarning =
  'inline-flex items-center justify-center rounded-xl border border-amber-300/80 bg-amber-50/80 px-4 py-2.5 text-sm font-semibold text-amber-800 hover:bg-amber-100/80 transition-all duration-150 disabled:opacity-50 dark:border-amber-800/60 dark:bg-amber-950/50 dark:text-amber-300 dark:hover:bg-amber-900/50 cursor-pointer'
