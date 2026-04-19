import type { ReactElement } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient, createServiceClient } from '@claimclarity/db'

import { hasCompleteConsent } from '../../../lib/consent'

import { StartNewCaseButton } from './start-new-case-button'

type PatientCaseRow = {
  id: string
  case_ref: string
  status:
    | 'consent_pending'
    | 'documents_pending'
    | 'payment_pending'
    | 'processing'
    | 'ai_draft_ready'
    | 'under_review'
    | 'escalated'
    | 'approved'
    | 'generating_report'
    | 'delivered'
    | 'closed'
  current_step:
    | 'quality_check'
    | 'ocr'
    | 'rules_engine'
    | 'ai_draft'
    | 'awaiting_review'
    | 'report_generation'
    | 'complete'
    | 'failed'
    | null
  insurer_name: string | null
  claim_amount_inr: number | null
  case_type: 'cashless' | 'reimbursement' | null
  created_at: string | null
}

function formatDate(value: string | null): string {
  if (!value) return 'Date not captured'
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value))
}

function formatWholeRupees(value: number | null): string {
  return typeof value === 'number' ? `Rs ${value.toLocaleString('en-IN')}` : 'Not captured'
}

function statusTone(status: PatientCaseRow['status']): string {
  if (status === 'delivered') return 'border-covered-500'
  if (status === 'closed') return 'border-slate-400'
  if (status === 'payment_pending' || status === 'processing') return 'border-teal-500'
  if (status === 'documents_pending') return 'border-attention-500'
  return 'border-navy-500'
}

function statusLabel(caseRow: PatientCaseRow): string {
  if (caseRow.status === 'documents_pending') return 'Documents needed'
  if (caseRow.status === 'payment_pending') return 'Payment step'
  if (caseRow.status === 'processing') return 'Processing'
  if (caseRow.status === 'ai_draft_ready') return 'Ready for review'
  if (caseRow.status === 'under_review') return 'Reviewer check'
  if (caseRow.status === 'escalated') return 'Expert input'
  if (caseRow.status === 'approved' || caseRow.status === 'generating_report') {
    return 'Report preparation'
  }
  if (caseRow.status === 'delivered') return 'Report ready'
  if (caseRow.status === 'closed') return 'Closed'
  return 'In progress'
}

function nextAction(caseRow: PatientCaseRow): { href: string; label: string; note: string } {
  if (caseRow.status === 'documents_pending') {
    return {
      href: `/app/upload?caseId=${encodeURIComponent(caseRow.id)}`,
      label: 'Resume upload',
      note: 'Upload or replace required documents.',
    }
  }

  if (caseRow.status === 'payment_pending') {
    return {
      href: `/app/cases/${encodeURIComponent(caseRow.case_ref)}/pay`,
      label: 'Continue to payment',
      note: 'Payment is needed before processing starts.',
    }
  }

  if (caseRow.status === 'delivered') {
    return {
      href: `/app/cases/${encodeURIComponent(caseRow.case_ref)}/report`,
      label: 'Open report',
      note: 'Your report is available after login.',
    }
  }

  if (caseRow.status === 'closed') {
    return {
      href: `/app/cases/${encodeURIComponent(caseRow.case_ref)}/status`,
      label: 'View status',
      note: 'This case is closed.',
    }
  }

  return {
    href: `/app/cases/${encodeURIComponent(caseRow.case_ref)}/status`,
    label: 'View status',
    note: 'See the current step and what happens next.',
  }
}

export default async function PatientDashboardPage(): Promise<ReactElement> {
  const sessionClient = await createServerClient()
  const {
    data: { user },
  } = await sessionClient.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const consentComplete = await hasCompleteConsent({
    client: sessionClient,
    userId: user.id,
  })
  const serviceClient = createServiceClient()
  const { data, error } = await serviceClient
    .from('cases')
    .select(
      'id, case_ref, status, current_step, insurer_name, claim_amount_inr, case_type, created_at'
    )
    .eq('patient_id', user.id)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message)
  }

  const cases = data as PatientCaseRow[]

  return (
    <main className="min-h-screen bg-navy-50 px-4 py-10 font-['IBM_Plex_Sans',Arial,sans-serif] text-navy-950">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-col gap-5 border-b border-navy-200 pb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase text-teal-700">ClaimClarity</p>
            <h1 className="mt-3 text-3xl font-semibold">Your cases</h1>
            <p className="mt-3 max-w-2xl text-navy-700">
              Resume a case, check progress, or start a new claim analysis when you are ready.
            </p>
          </div>
          {consentComplete ? (
            <StartNewCaseButton />
          ) : (
            <Link
              className="w-fit rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white"
              href="/app/consent"
            >
              Review consent
            </Link>
          )}
        </div>

        {!consentComplete ? (
          <section className="mt-6 border-l-4 border-attention-500 bg-white p-5">
            <h2 className="font-semibold">Consent is needed before a new case starts</h2>
            <p className="mt-2 text-sm text-navy-700">
              Existing cases remain visible. New upload or case creation starts only after consent.
            </p>
          </section>
        ) : null}

        <section className="mt-8 grid gap-4">
          {cases.length === 0 ? (
            <div className="border-l-4 border-teal-500 bg-white p-5">
              <h2 className="font-semibold">No cases yet</h2>
              <p className="mt-2 text-sm text-navy-700">
                Start a case only when you are ready to upload claim documents.
              </p>
            </div>
          ) : null}

          {cases.map((caseRow) => {
            const action = nextAction(caseRow)
            return (
              <article
                className={`border-l-4 bg-white p-5 shadow-sm ${statusTone(caseRow.status)}`}
                key={caseRow.id}
              >
                <div className="grid gap-5 md:grid-cols-[1fr_auto]">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-lg font-semibold">{caseRow.case_ref}</h2>
                      <span className="inline-flex items-center gap-2 rounded-lg border border-navy-200 px-2 py-1 text-xs font-medium text-navy-700">
                        <span className="h-2 w-2 rounded-full bg-teal-500" />
                        {statusLabel(caseRow)}
                      </span>
                    </div>
                    <dl className="mt-4 grid gap-3 text-sm text-navy-700 sm:grid-cols-3">
                      <div>
                        <dt className="font-medium text-navy-500">Insurer</dt>
                        <dd className="mt-1">{caseRow.insurer_name ?? 'Not captured'}</dd>
                      </div>
                      <div>
                        <dt className="font-medium text-navy-500">Claim amount</dt>
                        <dd className="mt-1 font-medium tabular-nums">
                          {formatWholeRupees(caseRow.claim_amount_inr)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-navy-500">Started</dt>
                        <dd className="mt-1">{formatDate(caseRow.created_at)}</dd>
                      </div>
                    </dl>
                    <p className="mt-4 text-sm text-navy-700">{action.note}</p>
                  </div>
                  <div className="flex items-start gap-3">
                    <Link
                      className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white"
                      href={action.href}
                    >
                      {action.label}
                    </Link>
                    <Link
                      className="rounded-lg border border-navy-300 px-4 py-2 text-sm font-semibold text-navy-800"
                      href={`/app/cases/${encodeURIComponent(caseRow.case_ref)}/status`}
                    >
                      Status
                    </Link>
                  </div>
                </div>
              </article>
            )
          })}
        </section>
      </div>
    </main>
  )
}
