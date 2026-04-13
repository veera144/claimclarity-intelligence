/**
 * @file page.tsx
 * @module web/app/app/cases/pay
 *
 * Authenticated patient payment page for Module 3 report payments.
 *
 * DEPENDENCIES:
 *   - next/navigation
 *   - /packages/db/src/client.server.ts
 *   - /packages/db/src/queries/payments.queries.ts
 *
 * CALLED BY:
 *   - /apps/web/app/app/upload/page.tsx
 *
 * CALLS:
 *   - Supabase auth and cases table
 */

import type { ReactElement } from 'react'
import { redirect } from 'next/navigation'
import { createServerClient, createServiceClient, getPaymentCaseByRef } from '@claimclarity/db'

import { PaymentCheckout } from './payment-checkout'

type PaymentPageProps = {
  params: {
    caseRef: string
  }
}

const REPORT_SECTIONS = [
  'Scope',
  'Likely covered table',
  'Likely deducted table',
  'Why these deductions',
  'What to ask the hospital',
  'What to ask the insurer/TPA',
  'Missing documents',
  'Appeal points table',
  'Draft appeal letter',
  'What this report cannot tell you',
] as const

export default async function PaymentPage(props: PaymentPageProps): Promise<ReactElement> {
  const sessionClient = await createServerClient()
  const {
    data: { user },
  } = await sessionClient.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const caseRef = decodeURIComponent(props.params.caseRef)
  const caseRow = await getPaymentCaseByRef({
    client: createServiceClient(),
    caseRef,
  })

  if (!caseRow || caseRow.patient_id !== user.id) {
    redirect('/app/dashboard')
  }

  if (caseRow.status !== 'payment_pending') {
    redirect(`/app/cases/${caseRow.case_ref}/status`)
  }

  return (
    <main className="min-h-screen bg-[#f7f8f5] px-4 py-10 font-['IBM_Plex_Sans',Arial,sans-serif] text-slate-900">
      <div className="mx-auto max-w-4xl">
        <p className="text-sm font-semibold uppercase text-teal-700">ClaimClarity</p>
        <h1 className="mt-3 text-3xl font-semibold">Claim Analysis Report payment</h1>
        <p className="mt-3 max-w-2xl text-slate-700">Case {caseRow.case_ref}</p>

        <section className="mt-8 border-t border-slate-300 pt-6">
          <h2 className="text-xl font-semibold">What you will receive</h2>
          <ol className="mt-4 grid gap-2 text-slate-800 sm:grid-cols-2">
            {REPORT_SECTIONS.map((section) => (
              <li key={section} className="rounded-lg border border-slate-300 bg-white p-3">
                {section}
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-8 border-t border-slate-300 pt-6">
          <h2 className="text-xl font-semibold">What is not included</h2>
          <ul className="mt-4 grid gap-2 text-slate-800">
            <li>Approval guarantee</li>
            <li>Legal advice</li>
            <li>Medical advice</li>
          </ul>
        </section>

        <section className="mt-8 border-t border-slate-300 pt-6">
          <h2 className="text-xl font-semibold">Refund policy</h2>
          <ul className="mt-4 grid gap-2 text-slate-800">
            <li>Refunds are processed to the original payment method.</li>
            <li>SLA breach refunds can be processed by the support team.</li>
          </ul>
        </section>

        <PaymentCheckout caseId={caseRow.id} caseRef={caseRow.case_ref} />
      </div>
    </main>
  )
}
