import type { ReactElement } from 'react'
import { createServerClient } from '@claimclarity/db'

import { requireAdminActor } from '../../../lib/ops/admin'

type CaseSegmentRow = {
  payment_reporting_category: 'paid' | 'waived' | 'test'
  payment_mode: string
}

type PaymentRow = {
  amount_inr: number
  status: string
}

function paise(value: number): string {
  return `Rs ${(value / 100).toLocaleString('en-IN')}`
}

export default async function PaymentSegmentationPage(): Promise<ReactElement> {
  await requireAdminActor()
  const supabase = await createServerClient()
  const [casesResult, paymentsResult] = await Promise.all([
    supabase.from('cases').select('payment_reporting_category, payment_mode'),
    supabase.from('payments').select('amount_inr, status'),
  ])

  if (casesResult.error) throw new Error(casesResult.error.message)
  if (paymentsResult.error) throw new Error(paymentsResult.error.message)

  const caseSegments = (casesResult.data as CaseSegmentRow[]).reduce<Record<string, number>>(
    (accumulator, row) => {
      const key = `${row.payment_reporting_category}:${row.payment_mode}`
      accumulator[key] = (accumulator[key] ?? 0) + 1
      return accumulator
    },
    {}
  )
  const paymentSegments = (paymentsResult.data as PaymentRow[]).reduce<
    Record<string, { count: number; totalPaise: number }>
  >((accumulator, row) => {
    const current = accumulator[row.status] ?? { count: 0, totalPaise: 0 }
    accumulator[row.status] = {
      count: current.count + 1,
      totalPaise: current.totalPaise + row.amount_inr,
    }
    return accumulator
  }, {})

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm uppercase text-emerald-300">Operations</p>
        <h1 className="mt-3 text-3xl font-semibold">Payment segmentation</h1>
        <p className="mt-3 text-neutral-300">
          Case access categories are separate from payment/revenue totals.
        </p>

        <section className="mt-8 border-y border-neutral-800 py-5">
          <h2 className="text-xl font-semibold">Case access categories</h2>
          <div className="mt-4 grid gap-2 text-sm">
            {Object.entries(caseSegments).map(([key, value]) => (
              <div className="flex justify-between gap-6" key={key}>
                <span>{key}</span>
                <span>{value}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-8 border-y border-neutral-800 py-5">
          <h2 className="text-xl font-semibold">Payment revenue</h2>
          <div className="mt-4 grid gap-2 text-sm">
            {Object.entries(paymentSegments).map(([key, value]) => (
              <div className="flex justify-between gap-6" key={key}>
                <span>{key}</span>
                <span>
                  {value.count} payments, {paise(value.totalPaise)}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
