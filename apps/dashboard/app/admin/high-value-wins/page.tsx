import type { ReactElement } from 'react'
import Link from 'next/link'
import { createServerClient } from '@claimclarity/db'
import { HIGH_VALUE_CLAIM_INR } from '@claimclarity/shared/constants'

import { requireAdminActor } from '../../../lib/ops/admin'

type OutcomeRow = {
  id: string
  case_id: string
  reversal_amount_inr: number | null
  evidence_type: string
  outcome_type: string | null
  user_satisfaction: number | null
}

type CaseRow = {
  id: string
  case_ref: string
  claim_amount_inr: number | null
  payment_reporting_category: string
}

function rupees(value: number | null): string {
  return typeof value === 'number' ? `Rs ${value.toLocaleString('en-IN')}` : '-'
}

export default async function HighValueWinsPage(): Promise<ReactElement> {
  await requireAdminActor()
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('outcomes')
    .select('id, case_id, reversal_amount_inr, evidence_type, outcome_type, user_satisfaction')
    .eq('evidence_type', 'self_reported')
    .gt('reversal_amount_inr', 0)
    .order('reversal_amount_inr', { ascending: false })
    .limit(100)

  if (error) throw new Error(error.message)
  const outcomes = data as OutcomeRow[]
  const caseIds = outcomes.map((outcome) => outcome.case_id)
  const casesResult =
    caseIds.length > 0
      ? await supabase
          .from('cases')
          .select('id, case_ref, claim_amount_inr, payment_reporting_category')
          .in('id', caseIds)
      : { data: [], error: null }
  if (casesResult.error) throw new Error(casesResult.error.message)
  const caseMap = new Map((casesResult.data as CaseRow[]).map((caseRow) => [caseRow.id, caseRow]))
  const highValueOutcomes = outcomes.filter(
    (outcome) => (caseMap.get(outcome.case_id)?.claim_amount_inr ?? 0) > HIGH_VALUE_CLAIM_INR
  )

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <div className="mx-auto max-w-7xl">
        <p className="text-sm uppercase text-emerald-300">Operations</p>
        <h1 className="mt-3 text-3xl font-semibold">High-value self-reported wins</h1>
        <div className="mt-8 overflow-x-auto border-y border-neutral-800">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="text-neutral-400">
              <tr>
                <th className="py-3 pr-4">Case</th>
                <th className="py-3 pr-4">Claim</th>
                <th className="py-3 pr-4">Recovery</th>
                <th className="py-3 pr-4">Outcome</th>
                <th className="py-3 pr-4">Satisfaction</th>
                <th className="py-3 pr-4">Segment</th>
              </tr>
            </thead>
            <tbody>
              {highValueOutcomes.map((outcome) => {
                const caseRow = caseMap.get(outcome.case_id)
                return (
                  <tr className="border-t border-neutral-900" key={outcome.id}>
                    <td className="py-3 pr-4">
                      <Link href={`/cases/${outcome.case_id}`}>{caseRow?.case_ref ?? 'Case'}</Link>
                    </td>
                    <td className="py-3 pr-4">{rupees(caseRow?.claim_amount_inr ?? null)}</td>
                    <td className="py-3 pr-4">{rupees(outcome.reversal_amount_inr)}</td>
                    <td className="py-3 pr-4">{outcome.outcome_type ?? '-'}</td>
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
