import type { ReactElement } from 'react'
import Link from 'next/link'
import { createServerClient } from '@claimclarity/db'

import { InternalBadge, InternalScaffold } from '../../components/internal-ui'
import { requireAdminActor } from '../../lib/ops/admin'

type CountResult = { count: number | null; error: { message: string } | null }

type PaymentSegment = {
  payment_reporting_category: 'paid' | 'waived' | 'test'
  payment_mode: string
}

const OPS_LINKS = [
  { href: '/admin/stuck-jobs', label: 'Stuck jobs' },
  { href: '/admin/sla-breaches', label: 'SLA breaches' },
  { href: '/admin/failed-reminders', label: 'Failed reminders and emails' },
  { href: '/admin/pending-outcomes', label: 'Pending outcomes' },
  { href: '/admin/manual-followups', label: 'Manual follow-up queue' },
  { href: '/admin/high-value-wins', label: 'High-value self-reported wins' },
  { href: '/admin/payment-segmentation', label: 'Payment segmentation' },
  { href: '/admin/audit', label: 'Audit viewer' },
  { href: '/admin/cases/new', label: 'Create waived pilot case' },
] as const

function countValue(result: CountResult): number {
  if (result.error) throw new Error(result.error.message)
  return result.count ?? 0
}

function metric(label: string, value: number | string, tone: string): ReactElement {
  return (
    <div className={`internal-status-card border-l-4 ${tone}`}>
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-navy-950">{value}</p>
    </div>
  )
}

export default async function AdminOpsPage(): Promise<ReactElement> {
  await requireAdminActor()
  const supabase = await createServerClient()
  const [
    activeCases,
    breachedCases,
    failedJobs,
    pendingOutcomes,
    manualFollowUps,
    highValueWins,
    segmentsResult,
  ] = await Promise.all([
    supabase
      .from('cases')
      .select('id', { count: 'exact', head: true })
      .in('status', ['processing', 'ai_draft_ready', 'under_review', 'escalated']),
    supabase
      .from('cases')
      .select('id', { count: 'exact', head: true })
      .eq('sla_breached', true),
    supabase
      .from('processing_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed'),
    supabase
      .from('outcomes')
      .select('id', { count: 'exact', head: true })
      .eq('outcome_type', 'pending'),
    supabase
      .from('outcomes')
      .select('id', { count: 'exact', head: true })
      .eq('needs_manual_followup', true),
    supabase
      .from('outcomes')
      .select('id', { count: 'exact', head: true })
      .eq('evidence_type', 'self_reported')
      .gt('reversal_amount_inr', 0),
    supabase.from('cases').select('payment_reporting_category, payment_mode'),
  ])

  if (segmentsResult.error) throw new Error(segmentsResult.error.message)
  const segments = segmentsResult.data as PaymentSegment[]
  const segmentSummary = segments.reduce<Record<string, number>>((accumulator, row) => {
    const key = `${row.payment_reporting_category}:${row.payment_mode}`
    accumulator[key] = (accumulator[key] ?? 0) + 1
    return accumulator
  }, {})

  return (
    <InternalScaffold
      eyebrow="Pilot operations"
      title="Case operations overview"
      description="External readiness items are tracked here for launch hygiene. They are not product failures."
    >
      <section className="grid gap-4 md:grid-cols-3">
        {metric('Active SLA cases', countValue(activeCases), 'border-teal-500')}
        {metric('SLA breaches', countValue(breachedCases), 'border-attention-500')}
        {metric('Failed jobs', countValue(failedJobs), 'border-deducted-500')}
        {metric('Pending outcomes', countValue(pendingOutcomes), 'border-navy-500')}
        {metric('Manual follow-ups', countValue(manualFollowUps), 'border-attention-500')}
        {metric('Self-reported wins', countValue(highValueWins), 'border-covered-500')}
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="internal-surface p-6">
          <h2 className="text-xl font-semibold text-navy-950">Readiness</h2>
          <div className="mt-4 flex flex-wrap gap-3">
            <InternalBadge label="Textract live smoke pending" tone="attention" />
            <InternalBadge label="OpenAI live smoke pending" tone="attention" />
          </div>
          <p className="mt-4 internal-copy">
            Keep production-readiness follow-ups visible without conflating them with local pilot failures.
          </p>
        </div>
        <div className="internal-surface p-6">
          <h2 className="text-xl font-semibold text-navy-950">Payment segmentation</h2>
          <div className="mt-4 grid gap-3 text-sm text-slate-600">
            {Object.entries(segmentSummary).map(([key, value]) => (
              <div
                className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 px-4 py-3"
                key={key}
              >
                <span>{key}</span>
                <span className="font-semibold tabular-nums text-navy-950">{value}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-8 grid gap-3 md:grid-cols-3">
        {OPS_LINKS.map((link) => (
          <Link
            className="internal-surface p-4 text-navy-950 no-underline transition hover:-translate-y-0.5 hover:shadow-md"
            href={link.href}
            key={link.href}
          >
            {link.label}
          </Link>
        ))}
      </section>
    </InternalScaffold>
  )
}
