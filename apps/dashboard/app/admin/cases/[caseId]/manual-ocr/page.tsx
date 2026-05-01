import type { ReactElement } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServiceClient } from '@claimclarity/db'

import { InternalBadge, InternalScaffold } from '../../../../../components/internal-ui'
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
      .select('id, doc_type, quality_status, quality_failure_reason, ocr_status, uploaded_at')
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
    <InternalScaffold
      eyebrow="Manual OCR fallback"
      title="Structured extraction completion"
      description={`Complete only normalized fields needed by the existing extraction pipeline for case ${caseRow.case_ref}. Do not paste raw OCR text, raw Textract blocks, or full document contents.`}
    >
      <section className="internal-status-card border-l-4 border-attention-500">
        Amount rules: bill line totals use paise. Insurer approved and deducted totals use whole rupees.
      </section>

      <div className="mt-8 grid gap-6">
        {documents.length === 0 ? (
          <div className="internal-status-card border-l-4 border-teal-500">
            <h2 className="font-semibold text-navy-950">No eligible manual extraction documents</h2>
            <p className="mt-2 text-sm leading-7 text-slate-600">
              This page only accepts documents marked failed or manual-required.
            </p>
          </div>
        ) : null}

        {documents.map((document) => {
          const schemaType = schemaForDocument(document.doc_type)
          if (!schemaType) return null

          return (
            <article className="internal-surface border-l-4 border-teal-500 p-6 sm:p-8" key={document.id}>
              <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                <div>
                  <h2 className="text-xl font-semibold text-navy-950">{titleCase(document.doc_type)}</h2>
                  <p className="mt-2 text-sm leading-7 text-slate-600">
                    {document.quality_failure_reason ??
                      'Manual structured extraction is available for this document.'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 text-sm">
                  <InternalBadge label={document.quality_status ?? 'quality pending'} tone="attention" />
                  <InternalBadge label={document.ocr_status ?? 'ocr pending'} tone="teal" />
                </div>
              </div>

              <form action={completeManualOcrAction} className="mt-5 grid gap-3">
                <input name="case_id" type="hidden" value={caseRow.id} />
                <input name="document_id" type="hidden" value={document.id} />
                <input name="schema_type" type="hidden" value={schemaType} />
                <label className="grid gap-2 text-sm font-medium text-navy-800">
                  {schemaType}
                  <textarea
                    className="internal-textarea min-h-72 font-mono text-sm"
                    name="structured_json"
                    placeholder={exampleFor(schemaType)}
                    required
                  />
                </label>
                <div className="flex flex-wrap gap-3">
                  <button className="internal-primary-button">Save structured extraction</button>
                  <Link className="internal-secondary-button" href={`/cases/${caseRow.id}`}>
                    Open review page
                  </Link>
                </div>
              </form>
            </article>
          )
        })}
      </div>
    </InternalScaffold>
  )
}
