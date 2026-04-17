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
    <main className="min-h-screen bg-zinc-50 px-4 py-12 font-['IBM_Plex_Sans',Arial,sans-serif] text-zinc-950">
      <div className="mx-auto max-w-3xl">
        <p className="text-sm font-semibold uppercase text-teal-700">ClaimClarity</p>
        <h1 className="mt-3 text-3xl font-semibold">Share your claim outcome</h1>
        <p className="mt-4 text-zinc-700">
          Case {caseRow.case_ref}. Your update helps measure real patient value.
        </p>
        <OutcomeForm caseId={caseRow.id} caseRef={caseRow.case_ref} />
      </div>
    </main>
  )
}
