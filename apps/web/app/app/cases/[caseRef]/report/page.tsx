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

import { PatientScaffold, StatusBadge } from '../../../../../components/patient-ui'

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
    <PatientScaffold
      eyebrow="Delivered report"
      title="Your claim analysis report is ready"
      description="Your report stays behind login. A short-lived download link is created only when you request it."
    >
      <div className="max-w-4xl">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge label="Report ready" tone="covered" />
          <StatusBadge label="One-hour download link" tone="teal" />
        </div>
        <div className="patient-surface mt-6 p-8 sm:p-10">
          <dl className="grid gap-5 border-b border-navy-200 pb-6 sm:grid-cols-2">
          <div>
            <dt className="text-sm font-semibold text-navy-500">Case ref</dt>
            <dd className="mt-1 text-lg font-semibold text-navy-950">{caseRow.case_ref}</dd>
          </div>
          <div>
            <dt className="text-sm font-semibold text-navy-500">Delivered</dt>
            <dd className="mt-1 text-lg font-semibold text-navy-950">{formatDate(report.delivered_at)}</dd>
          </div>
          </dl>
          <p className="mt-6 max-w-2xl text-sm leading-7 text-navy-700">
            The download button asks the app for a fresh link when you need it. The link is not shown or stored on this page.
          </p>
          <ReportDownloadButton caseId={caseRow.id} />
        </div>
      </div>
    </PatientScaffold>
  )
}
