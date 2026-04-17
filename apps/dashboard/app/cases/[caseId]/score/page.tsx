import type { ReactElement } from 'react'
import { redirect } from 'next/navigation'
import { createServerClient } from '@claimclarity/db'

import { requireDashboardActor } from '../../../../lib/review/session'

import { submitQualityScoreAction } from './actions'

type PageProps = {
  params: {
    caseId: string
  }
}

export default async function QualityScorePage({ params }: PageProps): Promise<ReactElement> {
  const actor = await requireDashboardActor()
  if (actor.role === 'reviewer') redirect('/queue')

  const supabase = await createServerClient()
  const { data: caseRow, error } = await supabase
    .from('cases')
    .select('case_ref, status')
    .eq('id', params.caseId)
    .single()
  if (error) throw new Error(error.message)

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <div className="mx-auto max-w-3xl">
        <p className="text-sm uppercase text-emerald-300">Quality scoring</p>
        <h1 className="mt-3 text-3xl font-semibold">{caseRow.case_ref}</h1>
        {caseRow.status !== 'delivered' ? (
          <p className="mt-5 rounded bg-amber-200 px-3 py-2 text-sm text-amber-950">
            Quality scores can be submitted only after delivery.
          </p>
        ) : null}
        <form action={submitQualityScoreAction} className="mt-8 grid gap-4 border-y border-neutral-800 py-6">
          <input name="case_id" type="hidden" value={params.caseId} />
          <select className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2" name="scoring_type" defaultValue="post_delivery_expert_review">
            <option value="post_delivery_expert_review">Post-delivery expert review</option>
            <option value="calibration_check">Calibration check</option>
          </select>
          <input className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2" max="1" min="0" name="clause_extraction_accuracy" placeholder="Clause extraction accuracy 0-1" step="0.01" type="number" />
          <input className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2" max="1" min="0" name="deduction_reason_accuracy" placeholder="Deduction reason accuracy 0-1" step="0.01" type="number" />
          <input className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2" max="1" min="0" name="missing_doc_identification" placeholder="Missing doc identification 0-1" step="0.01" type="number" />
          <input className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2" max="5" min="1" name="next_step_question_usefulness" placeholder="Question usefulness 1-5" step="0.1" type="number" />
          <input className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2" max="1" min="0" name="appeal_point_validity" placeholder="Appeal point validity 0-1" step="0.01" type="number" />
          <select className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2" name="harmful_output" defaultValue="false">
            <option value="false">No harmful output</option>
            <option value="true">Harmful output found</option>
          </select>
          <textarea className="min-h-20 rounded border border-neutral-700 bg-neutral-900 px-3 py-2" name="harmful_output_description" placeholder="Harmful output description, if any" />
          <textarea className="min-h-28 rounded border border-neutral-700 bg-neutral-900 px-3 py-2" name="notes" placeholder="Notes" />
          <button className="w-fit rounded bg-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-950" disabled={caseRow.status !== 'delivered'}>
            Submit score
          </button>
        </form>
      </div>
    </main>
  )
}
