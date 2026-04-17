/**
 * @file page.tsx
 * @module web/app/cases/report
 *
 * Login-gated patient page for delivered Module 8 report access.
 *
 * DEPENDENCIES:
 *   - next/navigation
 *   - /packages/db/src/client.server.ts
 *   - /apps/web/app/app/cases/[caseRef]/report/report-download-button.tsx
 *
 * CALLED BY:
 *   - report-ready notification emails
 *
 * CALLS:
 *   - Supabase auth, cases, reports
 */

import type { ReactElement } from 'react'
import { redirect } from 'next/navigation'
import { createServerClient, createServiceClient } from '@claimclarity/db'

import { ReportDownloadButton } from './report-download-button'

type ReportPageProps = {
  params: {
    caseRef: string
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value))
}

export default async function ReportPage(props: ReportPageProps): Promise<ReactElement> {
  const sessionClient = await createServerClient()
  const {
    data: { user },
  } = await sessionClient.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const caseRef = decodeURIComponent(props.params.caseRef)
  const serviceClient = createServiceClient()
  const { data: caseRow, error: caseError } = await serviceClient
    .from('cases')
    .select('id, case_ref, patient_id')
    .eq('case_ref', caseRef)
    .maybeSingle()

  if (caseError || !caseRow || caseRow.patient_id !== user.id) {
    redirect('/app/dashboard')
  }

  const { data: report, error: reportError } = await serviceClient
    .from('reports')
    .select('delivered_at')
    .eq('case_id', caseRow.id)
    .maybeSingle()

  if (reportError || !report?.delivered_at) {
    redirect('/app/dashboard')
  }

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-12 font-['IBM_Plex_Sans',Arial,sans-serif] text-zinc-950">
      <div className="mx-auto max-w-3xl">
        <p className="text-sm font-semibold uppercase text-teal-700">ClaimClarity</p>
        <h1 className="mt-3 text-3xl font-semibold">Your claim analysis report is ready</h1>
        <dl className="mt-8 grid gap-4 border-y border-zinc-300 py-6 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-semibold text-zinc-600">Case ref</dt>
            <dd className="mt-1 text-lg">{caseRow.case_ref}</dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-zinc-600">Delivered</dt>
            <dd className="mt-1 text-lg">{formatDate(report.delivered_at)}</dd>
          </div>
        </dl>
        <p className="mt-6 max-w-2xl text-zinc-700">
          You will receive a one-hour download link after you press the button. The link is not
          displayed or saved here.
        </p>
        <ReportDownloadButton caseId={caseRow.id} />
      </div>
    </main>
  )
}
