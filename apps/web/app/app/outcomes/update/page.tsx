/**
 * @file page.tsx
 * @module web/app/outcomes/update
 *
 * Non-mutating token confirmation page for Module 9 email outcome links.
 *
 * DEPENDENCIES:
 *   - @claimclarity/db (service-role token inspection)
 *   - /apps/web/app/app/outcomes/update/quick-update-confirmation.tsx
 *   - /apps/web/app/app/outcomes/[caseRef]/outcome-form.tsx
 *
 * CALLED BY:
 *   - follow-up reminder emails
 *
 * CALLS:
 *   - Supabase outcome_tokens, cases, reports
 */

import type { ReactElement } from 'react'
import { createServiceClient } from '@claimclarity/db'
import { inspectOutcomeToken } from '@claimclarity/db/outcome-tokens'

import { OutcomeForm } from '../[caseRef]/outcome-form'

import { QuickUpdateConfirmation } from './quick-update-confirmation'

type UpdatePageProps = {
  searchParams: {
    token?: string
    action?: string
  }
}

const ACTION_LABELS: Record<string, string> = {
  submitted_appeal: 'I submitted an appeal',
  not_yet: 'Not yet',
  no_appeal: 'I decided not to appeal',
  paid_more: 'The insurer paid more',
  rejected: 'The insurer rejected it',
  waiting: 'Still waiting',
  resolved: 'Resolved favorably',
  no_change: 'No change',
  moved_on: 'I moved on',
}

function invalidLink(): ReactElement {
  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-12 font-['IBM_Plex_Sans',Arial,sans-serif] text-zinc-950">
      <div className="mx-auto max-w-2xl">
        <p className="text-sm font-semibold uppercase text-teal-700">ClaimClarity</p>
        <h1 className="mt-3 text-3xl font-semibold">This link is not available</h1>
        <p className="mt-4 text-zinc-700">
          It may have expired or already been used. Please log in to update your case.
        </p>
      </div>
    </main>
  )
}

export default async function OutcomeUpdatePage(props: UpdatePageProps): Promise<ReactElement> {
  const token = props.searchParams.token ?? ''
  const serviceClient = createServiceClient()
  const inspected = await inspectOutcomeToken(token, serviceClient)

  if (!inspected) {
    await serviceClient.from('audit_log').insert({
      actor_role: 'system',
      action: 'outcome_token_rejected',
      entity_type: 'outcome_token',
      metadata: {
        reason: 'invalid_expired_or_used_on_get',
      },
    })
    return invalidLink()
  }

  const { data: caseRow } = await serviceClient
    .from('cases')
    .select('id, case_ref')
    .eq('id', inspected.caseId)
    .maybeSingle()
  const { data: report } = await serviceClient
    .from('reports')
    .select('delivered_at')
    .eq('case_id', inspected.caseId)
    .maybeSingle()

  if (!caseRow || !report?.delivered_at) {
    return invalidLink()
  }

  const action = props.searchParams.action ?? 'submitted_appeal'
  const label = ACTION_LABELS[action] ?? 'Update my outcome'

  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-12 font-['IBM_Plex_Sans',Arial,sans-serif] text-zinc-950">
      <div className="mx-auto max-w-3xl">
        <p className="text-sm font-semibold uppercase text-teal-700">ClaimClarity</p>
        <h1 className="mt-3 text-3xl font-semibold">Confirm your update</h1>
        <p className="mt-4 text-zinc-700">Case {caseRow.case_ref}</p>
        {inspected.tokenType === 'quick_update' ? (
          <>
            <p className="mt-6 rounded border border-zinc-300 p-4 text-lg font-medium">
              {label}
            </p>
            <QuickUpdateConfirmation token={token} action={action} />
          </>
        ) : (
          <OutcomeForm caseId={caseRow.id} caseRef={caseRow.case_ref} token={token} />
        )}
      </div>
    </main>
  )
}
