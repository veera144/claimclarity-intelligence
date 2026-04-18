import type { ReactElement } from 'react'
import Link from 'next/link'
import { createServerClient } from '@claimclarity/db'

import { requireAdminActor } from '../../../lib/ops/admin'

type SlaCaseRow = {
  id: string
  case_ref: string
  status: string
  assigned_reviewer_id: string | null
  sla_deadline: string | null
  sla_warning_sent: boolean | null
  sla_breached: boolean | null
  payment_reporting_category: string
}

export default async function SlaBreachesPage(): Promise<ReactElement> {
  await requireAdminActor()
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('cases')
    .select(
      'id, case_ref, status, assigned_reviewer_id, sla_deadline, sla_warning_sent, sla_breached, payment_reporting_category'
    )
    .or('sla_breached.eq.true,sla_warning_sent.eq.true')
    .order('sla_deadline', { ascending: true })
    .limit(100)

  if (error) throw new Error(error.message)
  const cases = data as SlaCaseRow[]

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <div className="mx-auto max-w-7xl">
        <p className="text-sm uppercase text-emerald-300">Operations</p>
        <h1 className="mt-3 text-3xl font-semibold">SLA breaches</h1>
        <div className="mt-8 overflow-x-auto border-y border-neutral-800">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="text-neutral-400">
              <tr>
                <th className="py-3 pr-4">Case</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">SLA deadline</th>
                <th className="py-3 pr-4">Warning</th>
                <th className="py-3 pr-4">Breached</th>
                <th className="py-3 pr-4">Segment</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((caseRow) => (
                <tr className="border-t border-neutral-900" key={caseRow.id}>
                  <td className="py-3 pr-4">
                    <Link href={`/cases/${caseRow.id}`}>{caseRow.case_ref}</Link>
                  </td>
                  <td className="py-3 pr-4">{caseRow.status}</td>
                  <td className="py-3 pr-4">{caseRow.sla_deadline ?? '-'}</td>
                  <td className="py-3 pr-4">{caseRow.sla_warning_sent ? 'sent' : '-'}</td>
                  <td className="py-3 pr-4">{caseRow.sla_breached ? 'yes' : '-'}</td>
                  <td className="py-3 pr-4">{caseRow.payment_reporting_category}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}
