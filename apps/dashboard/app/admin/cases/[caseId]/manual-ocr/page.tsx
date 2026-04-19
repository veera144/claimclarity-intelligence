import type { ReactElement } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServiceClient } from '@claimclarity/db'

import { requireDashboardActor } from '../../../../../lib/review/session'

import { completeManualOcrAction } from './actions'

type PageProps = {
  params: {
    caseId: string
  }
}

type CaseRow = {
  id: string
  case_ref: string
  assigned_reviewer_id: string | null
}

type DocumentRow = {
  id: string
  doc_type: string
  quality_status: 'pending' | 'pass' | 'fail' | 'manual_required' | null
  quality_failure_reason: string | null
  ocr_status: 'pending' | 'running' | 'completed' | 'failed' | null
  uploaded_at: string | null
}

type ManualSchemaType = 'bill_lines' | 'policy_chunks' | 'insurer_letter'

function titleCase(value: string): string {
  return value
    .split('_')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function schemaForDocument(docType: string): ManualSchemaType | null {
  if (docType === 'hospital_bill') return 'bill_lines'
  if (docType === 'policy' || docType === 'cis') return 'policy_chunks'
  if (docType === 'insurer_response') return 'insurer_letter'
  return null
}

function isEligible(document: DocumentRow): boolean {
  return (
    document.quality_status === 'manual_required' ||
    document.quality_status === 'fail' ||
    document.ocr_status === 'failed'
  )
}

function exampleFor(schemaType: ManualSchemaType): string {
  if (schemaType === 'bill_lines') {
    return JSON.stringify(
      [
        {
          line_item: 'Room rent',
          total_inr: 250000,
          bill_category: 'room_charges',
          page_number: 1,
        },
      ],
      null,
      2
    )
  }

  if (schemaType === 'policy_chunks') {
    return JSON.stringify(
      [
        {
          heading: 'Room rent limit',
          clause_category: 'room_charges',
          text: 'Room rent is covered up to the policy limit.',
          page_number: 4,
        },
      ],
      null,
      2
    )
  }

  return JSON.stringify(
    {
      claim_number: null,
      policy_number: null,
      approved_amount_inr: 50000,
      deducted_amount_inr: 12000,
      deductions: [
        {
          item_description: 'Room rent deduction',
          deducted_amount_inr: 12000,
          stated_reason: 'Above room rent limit',
        },
      ],
      stated_reason_summary: 'Deduction applied against room rent limit.',
    },
    null,
    2
  )
}

export default async function ManualOcrPage({ params }: PageProps): Promise<ReactElement> {
  const actor = await requireDashboardActor()
  const serviceClient = createServiceClient()
  const [caseResult, documentsResult] = await Promise.all([
    serviceClient
      .from('cases')
      .select('id, case_ref, assigned_reviewer_id')
      .eq('id', params.caseId)
      .maybeSingle(),
    serviceClient
      .from('documents')
      .select(
        'id, doc_type, quality_status, quality_failure_reason, ocr_status, uploaded_at'
      )
      .eq('case_id', params.caseId)
      .order('uploaded_at', { ascending: true }),
  ])

  if (caseResult.error) throw new Error(caseResult.error.message)
  if (documentsResult.error) throw new Error(documentsResult.error.message)
  if (!caseResult.data) throw new Error('Case not found')

  const caseRow = caseResult.data as CaseRow
  if (actor.role !== 'admin' && caseRow.assigned_reviewer_id !== actor.id) {
    redirect('/access-denied')
  }

  const documents = (documentsResult.data as DocumentRow[]).filter((document) => {
    const schemaType = schemaForDocument(document.doc_type)
    return Boolean(schemaType) && isEligible(document)
  })

  return (
    <main className="min-h-screen bg-navy-950 px-6 py-10 text-navy-50">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm font-semibold uppercase text-teal-300">Manual OCR fallback</p>
        <h1 className="mt-3 text-3xl font-semibold">Structured extraction completion</h1>
        <p className="mt-3 max-w-3xl text-navy-100">
          Complete only normalized fields needed by the existing extraction pipeline for case{' '}
          {caseRow.case_ref}. Do not paste raw OCR text, raw Textract blocks, or full document
          contents.
        </p>

        <section className="mt-8 border-l-4 border-attention-500 bg-navy-900 p-5 text-sm text-navy-100">
          Amount rules: bill line totals use paise. Insurer approved and deducted totals use whole
          rupees.
        </section>

        <div className="mt-8 grid gap-6">
          {documents.length === 0 ? (
            <div className="border-l-4 border-teal-500 bg-navy-900 p-5">
              <h2 className="font-semibold">No eligible manual extraction documents</h2>
              <p className="mt-2 text-sm text-navy-100">
                This page only accepts documents marked failed or manual-required.
              </p>
            </div>
          ) : null}

          {documents.map((document) => {
            const schemaType = schemaForDocument(document.doc_type)
            if (!schemaType) return null

            return (
              <article className="border-l-4 border-teal-500 bg-navy-900 p-5" key={document.id}>
                <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                  <div>
                    <h2 className="text-xl font-semibold">{titleCase(document.doc_type)}</h2>
                    <p className="mt-2 text-sm text-navy-100">
                      {document.quality_failure_reason ??
                        'Manual structured extraction is available for this document.'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <span className="inline-flex items-center gap-2 rounded-lg border border-navy-700 px-2 py-1">
                      <span className="h-2 w-2 rounded-full bg-attention-500" />
                      {document.quality_status ?? 'quality pending'}
                    </span>
                    <span className="inline-flex items-center gap-2 rounded-lg border border-navy-700 px-2 py-1">
                      <span className="h-2 w-2 rounded-full bg-teal-500" />
                      {document.ocr_status ?? 'ocr pending'}
                    </span>
                  </div>
                </div>

                <form action={completeManualOcrAction} className="mt-5 grid gap-3">
                  <input name="case_id" type="hidden" value={caseRow.id} />
                  <input name="document_id" type="hidden" value={document.id} />
                  <input name="schema_type" type="hidden" value={schemaType} />
                  <label className="grid gap-2 text-sm">
                    {schemaType}
                    <textarea
                      className="min-h-72 rounded-lg border border-navy-700 bg-navy-950 px-3 py-2 font-mono text-sm text-navy-50"
                      name="structured_json"
                      placeholder={exampleFor(schemaType)}
                      required
                    />
                  </label>
                  <div className="flex flex-wrap gap-3">
                    <button className="rounded-lg bg-teal-500 px-4 py-2 text-sm font-semibold text-navy-950">
                      Save structured extraction
                    </button>
                    <Link
                      className="rounded-lg border border-navy-700 px-4 py-2 text-sm font-semibold text-navy-100"
                      href={`/cases/${caseRow.id}`}
                    >
                      Open review page
                    </Link>
                  </div>
                </form>
              </article>
            )
          })}
        </div>
      </div>
    </main>
  )
}
