import type { ReactElement } from 'react'
import { redirect } from 'next/navigation'
import { createServerClient } from '@claimclarity/db'

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
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <div className="mx-auto max-w-6xl">
        <p className="text-sm uppercase text-emerald-300">Reviewer queue</p>
        <h1 className="mt-3 text-3xl font-semibold">Cases ready for human review</h1>
        <p className="mt-3 max-w-3xl text-neutral-300">
          AI drafts stay internal until a reviewer confirms every finding, clears escalations, and signs off.
        </p>
        <div className="mt-8">
          <QueueTable actorId={actor.id} actorRole={actor.role} cases={data} />
        </div>
      </div>
    </main>
  )
}
