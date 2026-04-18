import type { ReactElement } from 'react'
import { createServerClient } from '@claimclarity/db'

import { requireAdminActor } from '../../../../lib/ops/admin'

import { createAdminPilotCaseAction } from './actions'

type PartnerRow = {
  id: string
  name: string
}

export default async function NewAdminCasePage(): Promise<ReactElement> {
  await requireAdminActor()
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('partners')
    .select('id, name')
    .eq('status', 'active')
    .order('name')
  if (error) throw new Error(error.message)
  const partners = data as PartnerRow[]

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <div className="mx-auto max-w-3xl">
        <p className="text-sm uppercase text-emerald-300">Pilot admin</p>
        <h1 className="mt-3 text-3xl font-semibold">Create waived pilot case</h1>
        <form action={createAdminPilotCaseAction} className="mt-8 grid gap-4 border-y border-neutral-800 py-6">
          <label className="grid gap-2 text-sm">
            Patient email
            <input className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2" name="patient_email" required type="email" />
          </label>
          <label className="grid gap-2 text-sm">
            Partner
            <select className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2" name="partner_id">
              <option value="">None</option>
              {partners.map((partner) => (
                <option key={partner.id} value={partner.id}>
                  {partner.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            Claim amount, whole rupees
            <input className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2" min="0" name="claim_amount_inr" step="1" type="number" />
          </label>
          <label className="grid gap-2 text-sm">
            Insurer name
            <input className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2" name="insurer_name" />
          </label>
          <label className="grid gap-2 text-sm">
            Procedure category
            <input className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2" name="procedure_category" />
          </label>
          <label className="grid gap-2 text-sm">
            Case type
            <select className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2" name="case_type" required>
              <option value="cashless">Cashless</option>
              <option value="reimbursement">Reimbursement</option>
            </select>
          </label>
          <div className="rounded border border-neutral-800 p-4 text-sm text-neutral-300">
            Payment is waived for pilot case creation. The stored reason is pilot_case, with admin_waived payment mode.
          </div>
          <button className="w-fit rounded bg-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-950">
            Create case
          </button>
        </form>
      </div>
    </main>
  )
}
