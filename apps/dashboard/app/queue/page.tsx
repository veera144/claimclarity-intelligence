import type { ReactElement } from 'react'
import { redirect } from 'next/navigation'
import { createServerClient } from '@claimclarity/db'

import { InternalScaffold } from '../../components/internal-ui'
import { requireDashboardActor } from '../../lib/review/session'

import { QueueTable } from './queue-table'

export default async function QueuePage(): Promise<ReactElement> {
  const actor = await requireDashboardActor()
  if (actor.role === 'expert') redirect('/escalations')

  const supabase = await createServerClient()
  let query = supabase
    .from('cases')
    .select(
      'id, case_ref, insurer_name, claim_amount_inr, confidence_overall, status, sla_deadline, sla_breached'
    )
    .in('status', ['ai_draft_ready', 'under_review', 'escalated'])
    .order('sla_deadline', { ascending: true })

  if (actor.role === 'reviewer') query = query.eq('assigned_reviewer_id', actor.id)
  const { data, error } = await query
  if (error) throw new Error(error.message)

  return (
    <InternalScaffold
      eyebrow="Reviewer queue"
      title="Cases ready for human review"
      description="AI drafts stay internal until a reviewer confirms every finding, clears escalations, and signs off."
    >
      <div className="grid gap-4 md:grid-cols-3">
        <div className="internal-status-card border-l-4 border-teal-500">
          <p className="text-sm font-medium text-slate-500">Open cases</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums">{data.length}</p>
        </div>
        <div className="internal-status-card border-l-4 border-attention-500">
          <p className="text-sm font-medium text-slate-500">Escalated</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums">
            {data.filter((caseRow) => caseRow.status === 'escalated').length}
          </p>
        </div>
        <div className="internal-status-card border-l-4 border-navy-500">
          <p className="text-sm font-medium text-slate-500">Ready to start</p>
          <p className="mt-2 text-3xl font-semibold tabular-nums">
            {data.filter((caseRow) => caseRow.status === 'ai_draft_ready').length}
          </p>
        </div>
      </div>
      <div className="mt-8">
        <p className="mb-4 max-w-3xl internal-copy">
          Keep the queue tight, finish findings before sign-off, and use escalation only when the reviewer needs expert input.
        </p>
        <QueueTable actorId={actor.id} actorRole={actor.role} cases={data} />
      </div>
    </InternalScaffold>
  )
}
