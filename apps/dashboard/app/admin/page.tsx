import type { ReactElement } from 'react'
import Link from 'next/link'
import { createServerClient } from '@claimclarity/db'

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

function metric(label: string, value: number | string): ReactElement {
  return (
    <div className="border border-neutral-800 p-4">
      <p className="text-sm text-neutral-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
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
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <div className="mx-auto max-w-7xl">
        <p className="text-sm uppercase text-emerald-300">Pilot operations</p>
        <h1 className="mt-3 text-3xl font-semibold">Case operations overview</h1>
        <p className="mt-3 max-w-3xl text-neutral-300">
          External readiness items are tracked here for launch hygiene. They are not product failures.
        </p>

        <section className="mt-8 grid gap-4 md:grid-cols-3">
          {metric('Active SLA cases', countValue(activeCases))}
          {metric('SLA breaches', countValue(breachedCases))}
          {metric('Failed jobs', countValue(failedJobs))}
          {metric('Pending outcomes', countValue(pendingOutcomes))}
          {metric('Manual follow-ups', countValue(manualFollowUps))}
          {metric('Self-reported wins', countValue(highValueWins))}
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-[1fr_1fr]">
          <div className="border-y border-neutral-800 py-5">
            <h2 className="text-xl font-semibold">Readiness</h2>
            <ul className="mt-4 space-y-3 text-sm text-neutral-300">
              <li>Textract live smoke: pending AWS activation</li>
              <li>OpenAI live smoke: pending live key activation</li>
            </ul>
          </div>
          <div className="border-y border-neutral-800 py-5">
            <h2 className="text-xl font-semibold">Payment segmentation</h2>
            <div className="mt-4 grid gap-2 text-sm text-neutral-300">
              {Object.entries(segmentSummary).map(([key, value]) => (
                <div className="flex justify-between gap-4" key={key}>
                  <span>{key}</span>
                  <span>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-3 md:grid-cols-3">
          {OPS_LINKS.map((link) => (
            <Link className="rounded border border-neutral-800 p-4 text-neutral-100 no-underline" href={link.href} key={link.href}>
              {link.label}
            </Link>
          ))}
        </section>
      </div>
    </main>
  )
}
