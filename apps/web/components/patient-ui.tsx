import type { ReactElement, ReactNode } from 'react'
import Link from 'next/link'

type PatientLink = {
  href: string
  label: string
}

type PatientTopbarProps = {
  links?: PatientLink[] | undefined
}

type PatientScaffoldProps = {
  eyebrow: string
  title: string
  description: string
  actions?: ReactNode
  children: ReactNode
  links?: PatientLink[] | undefined
}

type PatientAuthShellProps = {
  eyebrow: string
  title: string
  description: string
  asideTitle: string
  asideBody: string
  asidePoints: string[]
  actions?: ReactNode
  children: ReactNode
}

type StatusBadgeProps = {
  label: string
  tone: 'navy' | 'teal' | 'covered' | 'attention' | 'deducted' | 'neutral'
}

const DEFAULT_PATIENT_LINKS: PatientLink[] = [
  { href: '/app/dashboard', label: 'Your cases' },
  { href: '/app/consent', label: 'Consent' },
]

function dotTone(tone: StatusBadgeProps['tone']): string {
  if (tone === 'covered') return 'bg-covered-500'
  if (tone === 'attention') return 'bg-attention-500'
  if (tone === 'deducted') return 'bg-deducted-500'
  if (tone === 'teal') return 'bg-teal-500'
  if (tone === 'neutral') return 'bg-slate-400'
  return 'bg-navy-500'
}

export function PatientTopbar({
  links = DEFAULT_PATIENT_LINKS,
}: PatientTopbarProps): ReactElement {
  return (
    <header className="patient-topbar">
      <div className="patient-shell flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link className="text-lg font-semibold text-navy-950 no-underline" href="/">
            ClaimClarity
          </Link>
          <p className="mt-1 text-sm text-navy-600">Human-reviewed claim clarity for the local pilot.</p>
        </div>
        <nav className="flex flex-wrap items-center gap-4">
          {links.map((link) => (
            <Link className="patient-topbar-link" href={link.href} key={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  )
}

export function PatientScaffold({
  eyebrow,
  title,
  description,
  actions,
  children,
  links,
}: PatientScaffoldProps): ReactElement {
  return (
    <main className="patient-page">
      <PatientTopbar links={links} />
      <div className="patient-shell py-8 sm:py-10">
        <section className="flex flex-col gap-5 border-b border-navy-200 pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="patient-eyebrow">{eyebrow}</p>
            <h1 className="patient-title">{title}</h1>
            <p className="mt-4 patient-copy">{description}</p>
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
        </section>
        <section className="mt-8">{children}</section>
      </div>
    </main>
  )
}

export function PatientAuthShell({
  eyebrow,
  title,
  description,
  asideTitle,
  asideBody,
  asidePoints,
  actions,
  children,
}: PatientAuthShellProps): ReactElement {
  return (
    <main className="patient-page">
      <PatientTopbar links={[{ href: '/login', label: 'Sign in' }, { href: '/signup', label: 'Create account' }]} />
      <div className="patient-shell py-8 sm:py-12">
        <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr] lg:items-stretch">
          <section className="patient-surface flex flex-col justify-between p-8 sm:p-10">
            <div>
              <p className="patient-eyebrow">{eyebrow}</p>
              <h1 className="patient-title">{title}</h1>
              <p className="mt-4 patient-copy">{description}</p>
            </div>
            <div className="mt-8 rounded-3xl bg-navy-900 p-6 text-navy-50">
              <p className="text-lg font-semibold">{asideTitle}</p>
              <p className="mt-3 text-sm leading-7 text-navy-100">{asideBody}</p>
              <ul className="mt-5 grid gap-3 text-sm text-navy-100">
                {asidePoints.map((point) => (
                  <li className="flex gap-3" key={point}>
                    <span className="mt-1 h-2.5 w-2.5 rounded-full bg-teal-400" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>
          <section className="patient-surface p-8 sm:p-10">
            {children}
            {actions ? <div className="mt-6">{actions}</div> : null}
          </section>
        </div>
      </div>
    </main>
  )
}

export function StatusBadge({ label, tone }: StatusBadgeProps): ReactElement {
  return (
    <span className="patient-badge">
      <span className={`patient-dot ${dotTone(tone)}`} />
      {label}
    </span>
  )
}
