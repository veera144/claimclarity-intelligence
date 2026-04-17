import type { ReactElement } from 'react'
import { redirect } from 'next/navigation'
import { createServerClient } from '@claimclarity/db'

import { requireDashboardActor } from '../../lib/review/session'

import { respondEscalationAction } from './actions'

type EscalationRow = {
  id: string
  case_id: string
  finding_id: string | null
  question_text: string
  confidence_recommendation: string | null
  cases: { case_ref: string } | null
  findings: {
    bill_line_item: string | null
    plain_language_explanation: string | null
    confidence_label: string
  } | null
}

export default async function EscalationsPage(): Promise<ReactElement> {
  const actor = await requireDashboardActor()
  if (actor.role === 'reviewer') redirect('/queue')

  const supabase = await createServerClient()
  let query = supabase
    .from('escalations')
    .select(
      'id, case_id, finding_id, question_text, confidence_recommendation, cases(case_ref), findings(bill_line_item, plain_language_explanation, confidence_label)'
    )
    .eq('status', 'open')
    .order('created_at', { ascending: true })
  if (actor.role === 'expert') query = query.eq('to_expert_id', actor.id)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  const escalations = data as unknown as EscalationRow[]

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm uppercase text-emerald-300">Expert escalations</p>
        <h1 className="mt-3 text-3xl font-semibold">Open questions for response</h1>
        <div className="mt-8 grid gap-5">
          {escalations.length === 0 ? (
            <p className="border-y border-neutral-800 py-6 text-neutral-300">No open escalations.</p>
          ) : null}
          {escalations.map((escalation) => (
            <article className="border border-neutral-800 p-5" key={escalation.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-semibold">{escalation.cases?.case_ref ?? escalation.case_id}</h2>
                <span className="rounded bg-neutral-800 px-2 py-1 text-xs">
                  {escalation.finding_id ? 'Finding' : 'Full case'}
                </span>
              </div>
              <p className="mt-4 text-neutral-200">{escalation.question_text}</p>
              {escalation.findings ? (
                <div className="mt-4 border-y border-neutral-800 py-3 text-sm text-neutral-300">
                  <p>{escalation.findings.bill_line_item ?? 'Finding context'}</p>
                  <p>{escalation.findings.confidence_label}</p>
                  <p>{escalation.findings.plain_language_explanation}</p>
                </div>
              ) : null}
              <form action={respondEscalationAction} className="mt-4 grid gap-3">
                <input name="escalation_id" type="hidden" value={escalation.id} />
                <textarea
                  className="min-h-28 rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
                  name="expert_response"
                  placeholder="Expert response"
                  required
                />
                <select className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2" name="confidence_recommendation" defaultValue="clause_found_matched">
                  <option value="clause_found_matched">Clause found and matched</option>
                  <option value="based_on_typical_policy">Based on typical policy</option>
                  <option value="insufficient_information">Insufficient information</option>
                </select>
                <button className="w-fit rounded bg-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-950">
                  Submit expert response
                </button>
              </form>
            </article>
          ))}
        </div>
      </div>
    </main>
  )
}
