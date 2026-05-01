import type { ReactElement, ReactNode } from 'react'

type InternalScaffoldProps = {
  eyebrow: string
  title: string
  description: string
  actions?: ReactNode
  children: ReactNode
}

type InternalBadgeProps = {
  label: string
  tone: 'navy' | 'teal' | 'covered' | 'attention' | 'deducted' | 'neutral'
}

function dotTone(tone: InternalBadgeProps['tone']): string {
  if (tone === 'covered') return 'bg-covered-500'
  if (tone === 'attention') return 'bg-attention-500'
  if (tone === 'deducted') return 'bg-deducted-500'
  if (tone === 'teal') return 'bg-teal-500'
  if (tone === 'neutral') return 'bg-slate-400'
  return 'bg-navy-500'
}

export function InternalScaffold({
  eyebrow,
  title,
  description,
  actions,
  children,
}: InternalScaffoldProps): ReactElement {
  return (
    <main className="internal-page">
      <div className="internal-shell">
        <section className="flex flex-col gap-5 border-b border-slate-200 pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-4xl">
            <p className="internal-eyebrow">{eyebrow}</p>
            <h1 className="internal-title">{title}</h1>
            <p className="mt-4 internal-copy">{description}</p>
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
        </section>
        <section className="mt-8">{children}</section>
      </div>
    </main>
  )
}

export function InternalBadge({ label, tone }: InternalBadgeProps): ReactElement {
  return (
    <span className="internal-badge">
      <span className={`internal-dot ${dotTone(tone)}`} />
      {label}
    </span>
  )
}
