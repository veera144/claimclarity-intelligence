import type { ReactElement } from 'react'
import Link from 'next/link'
import { createServerClient } from '@claimclarity/db'

import { requireAdminActor } from '../../../lib/ops/admin'

type OutcomeRow = {
  id: string
  case_id: string
  outcome_type: string | null
  patient_action_type: string
  collected_at: string | null
  last_updated_at: string | null
}

type CaseRow = {
  id: string
  case_ref: string
  payment_reporting_category: string
}

export default async function PendingOutcomesPage(): Promise<ReactElement> {
  await requireAdminActor()
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('outcomes')
    .select('id, case_id, outcome_type, patient_action_type, collected_at, last_updated_at')
    .eq('outcome_type', 'pending')
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
        <h1 className="mt-3 text-3xl font-semibold">Pending outcomes</h1>
        <div className="mt-8 overflow-x-auto border-y border-neutral-800">
          <table className="w-full min-w-[850px] text-left text-sm">
            <thead className="text-neutral-400">
              <tr>
                <th className="py-3 pr-4">Case</th>
                <th className="py-3 pr-4">Action</th>
                <th className="py-3 pr-4">Outcome</th>
                <th className="py-3 pr-4">Segment</th>
                <th className="py-3 pr-4">Collected</th>
                <th className="py-3 pr-4">Updated</th>
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
                    <td className="py-3 pr-4">{outcome.patient_action_type}</td>
                    <td className="py-3 pr-4">{outcome.outcome_type ?? 'pending'}</td>
                    <td className="py-3 pr-4">{caseRow?.payment_reporting_category ?? '-'}</td>
                    <td className="py-3 pr-4">{outcome.collected_at ?? '-'}</td>
                    <td className="py-3 pr-4">{outcome.last_updated_at ?? '-'}</td>
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
