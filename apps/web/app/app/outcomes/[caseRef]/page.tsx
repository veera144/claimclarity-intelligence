/**
 * @file page.tsx
 * @module web/app/outcomes/case
 *
 * Authenticated patient outcome form for Module 9 value measurement.
 *
 * DEPENDENCIES:
 *   - next/navigation
 *   - @claimclarity/db (request and service clients)
 *   - /apps/web/app/app/outcomes/[caseRef]/outcome-form.tsx
 *
 * CALLED BY:
 *   - patient portal links after report delivery
 *
 * CALLS:
 *   - Supabase cases and reports
 */

import type { ReactElement } from 'react'
import { redirect } from 'next/navigation'
import { createServerClient, createServiceClient } from '@claimclarity/db'

import { PatientScaffold, StatusBadge } from '../../../../components/patient-ui'

import { OutcomeForm } from './outcome-form'

type OutcomePageProps = {
  params: {
    caseRef: string
  }
}

export default async function OutcomePage(props: OutcomePageProps): Promise<ReactElement> {
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
      eyebrow="Outcome update"
      title="Share your claim outcome"
      description={`Case ${caseRow.case_ref}. Your update helps measure whether the report was useful in practice.`}
    >
      <div className="max-w-4xl">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge label="Session-protected" tone="navy" />
          <StatusBadge label="Whole-rupee outcome amounts" tone="teal" />
        </div>
        <OutcomeForm caseId={caseRow.id} caseRef={caseRow.case_ref} />
      </div>
    </PatientScaffold>
  )
}
