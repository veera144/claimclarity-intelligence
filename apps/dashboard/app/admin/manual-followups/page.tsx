import type { ReactElement } from 'react'
import Link from 'next/link'
import { createServerClient } from '@claimclarity/db'

import { requireAdminActor } from '../../../lib/ops/admin'

type OutcomeRow = {
  id: string
  case_id: string
  manual_followup_reason: string | null
  evidence_type: string
  reversal_amount_inr: number | null
  user_satisfaction: number | null
  last_updated_at: string | null
}

type CaseRow = {
  id: string
  case_ref: string
  payment_reporting_category: string
}

function rupees(value: number | null): string {
  return typeof value === 'number' ? `Rs ${value.toLocaleString('en-IN')}` : '-'
}

export default async function ManualFollowupsPage(): Promise<ReactElement> {
  await requireAdminActor()
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('outcomes')
    .select(
      'id, case_id, manual_followup_reason, evidence_type, reversal_amount_inr, user_satisfaction, last_updated_at'
    )
    .eq('needs_manual_followup', true)
    .order('last_updated_at', { ascending: true })
    .limit(100)

  if (error) throw new Error(error.message)
  const outcomes = data as OutcomeRow[]
  const caseIds = outcomes.map((outcome) => outcome.case_id)
  const casesResult =
    caseIds.length > 0
      ? await supabase
          .from('cases')
          .select('id, case_ref, payment_reporting_category')
          .in('id', caseIds)
      : { data: [], error: null }
  if (casesResult.error) throw new Error(casesResult.error.message)
  const caseMap = new Map((casesResult.data as CaseRow[]).map((caseRow) => [caseRow.id, caseRow]))

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <div className="mx-auto max-w-7xl">
        <p className="text-sm uppercase text-emerald-300">Operations</p>
        <h1 className="mt-3 text-3xl font-semibold">Manual follow-up queue</h1>
        <div className="mt-8 overflow-x-auto border-y border-neutral-800">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="text-neutral-400">
              <tr>
                <th className="py-3 pr-4">Case</th>
                <th className="py-3 pr-4">Reason</th>
                <th className="py-3 pr-4">Evidence</th>
                <th className="py-3 pr-4">Recovery</th>
                <th className="py-3 pr-4">Satisfaction</th>
                <th className="py-3 pr-4">Segment</th>
              </tr>
            </thead>
            <tbody>
              {outcomes.map((outcome) => {
                const caseRow = caseMap.get(outcome.case_id)
                return (
                  <tr className="border-t border-neutral-900" key={outcome.id}>
                    <td className="py-3 pr-4">
                      <Link href={`/cases/${outcome.case_id}`}>{caseRow?.case_ref ?? 'Case'}</Link>
                    </td>
                    <td className="py-3 pr-4">{outcome.manual_followup_reason ?? '-'}</td>
                    <td className="py-3 pr-4">{outcome.evidence_type}</td>
                    <td className="py-3 pr-4">{rupees(outcome.reversal_amount_inr)}</td>
                    <td className="py-3 pr-4">{outcome.user_satisfaction ?? '-'}</td>
                    <td className="py-3 pr-4">{caseRow?.payment_reporting_category ?? '-'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}
