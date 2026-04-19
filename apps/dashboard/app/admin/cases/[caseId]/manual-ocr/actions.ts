'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createServiceClient, logAudit } from '@claimclarity/db'

import { requireDashboardActor } from '../../../../../lib/review/session'
import { completeManualOcrExtraction } from '../../../../../../processor/src/jobs/ocr-job'

const billLineSchema = z
  .object({
    line_item: z.string().min(1),
    total_inr: z.number().int().nonnegative(),
    bill_category: z.string().min(1),
    page_number: z.number().int().positive().nullable(),
  })
  .strict()

const policyChunkSchema = z
  .object({
    heading: z.string().min(1),
    clause_category: z.string().min(1),
    text: z.string().min(1),
    page_number: z.number().int().positive().nullable(),
  })
  .strict()

const insurerDeductionSchema = z
  .object({
    item_description: z.string().min(1),
    deducted_amount_inr: z.number().int().nonnegative().nullable(),
    stated_reason: z.string().min(1),
  })
  .strict()

const insurerLetterSchema = z
  .object({
    claim_number: z.string().nullable(),
    policy_number: z.string().nullable(),
    approved_amount_inr: z.number().int().nonnegative().nullable(),
    deducted_amount_inr: z.number().int().nonnegative().nullable(),
    deductions: z.array(insurerDeductionSchema),
    stated_reason_summary: z.string().nullable(),
  })
  .strict()

type SchemaType = 'bill_lines' | 'policy_chunks' | 'insurer_letter'

type ManualDocumentRow = {
  id: string
  case_id: string
  doc_type: string
  quality_status: 'pending' | 'pass' | 'fail' | 'manual_required' | null
  ocr_status: 'pending' | 'running' | 'completed' | 'failed' | null
}

type AssignmentRow = {
  assigned_reviewer_id: string | null
}

function formText(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

function parseJsonPayload(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new Error('Structured extraction JSON is invalid')
  }
}

function schemaForDocument(docType: string): SchemaType | null {
  if (docType === 'hospital_bill') return 'bill_lines'
  if (docType === 'policy' || docType === 'cis') return 'policy_chunks'
  if (docType === 'insurer_response') return 'insurer_letter'
  return null
}

function assertCompletionAllowed(document: ManualDocumentRow): void {
  const statusAllowed =
    document.quality_status === 'manual_required' ||
    document.quality_status === 'fail' ||
    document.ocr_status === 'failed'

  if (!statusAllowed) {
    throw new Error('Manual extraction is only allowed for failed or manual-required documents')
  }
}

function parseStructuredData(schemaType: SchemaType, raw: string): {
  bill_lines?: z.infer<typeof billLineSchema>[]
  policy_chunks?: z.infer<typeof policyChunkSchema>[]
  insurer_letter?: z.infer<typeof insurerLetterSchema>
} {
  const payload = parseJsonPayload(raw)

  if (schemaType === 'bill_lines') {
    return { bill_lines: z.array(billLineSchema).min(1).parse(payload) }
  }

  if (schemaType === 'policy_chunks') {
    return { policy_chunks: z.array(policyChunkSchema).min(1).parse(payload) }
  }

  return { insurer_letter: insurerLetterSchema.parse(payload) }
}

export async function completeManualOcrAction(formData: FormData): Promise<void> {
  const actor = await requireDashboardActor()
  const caseId = formText(formData, 'case_id')
  const documentId = formText(formData, 'document_id')
  const submittedSchemaType = formText(formData, 'schema_type') as SchemaType
  const structuredJson = formText(formData, 'structured_json')

  if (!caseId || !documentId || !structuredJson) {
    throw new Error('Case, document, and structured extraction are required')
  }

  const serviceClient = createServiceClient()
  const [documentResult, assignmentResult] = await Promise.all([
    serviceClient
      .from('documents')
      .select('id, case_id, doc_type, quality_status, ocr_status')
      .eq('id', documentId)
      .maybeSingle(),
    serviceClient
      .from('cases')
      .select('assigned_reviewer_id')
      .eq('id', caseId)
      .maybeSingle(),
  ])

  if (documentResult.error) throw new Error(documentResult.error.message)
  if (assignmentResult.error) throw new Error(assignmentResult.error.message)
  if (!documentResult.data || !assignmentResult.data) throw new Error('Case or document not found')

  const document = documentResult.data as ManualDocumentRow
  const assignment = assignmentResult.data as AssignmentRow

  if (document.case_id !== caseId) {
    throw new Error('Document does not belong to this case')
  }

  if (actor.role !== 'admin' && assignment.assigned_reviewer_id !== actor.id) {
    throw new Error('Manual extraction is limited to admins or the assigned reviewer')
  }

  assertCompletionAllowed(document)

  const expectedSchemaType = schemaForDocument(document.doc_type)
  if (!expectedSchemaType || expectedSchemaType !== submittedSchemaType) {
    throw new Error('Structured extraction type does not match the document type')
  }

  const data = parseStructuredData(expectedSchemaType, structuredJson)
  await completeManualOcrExtraction({
    client: serviceClient,
    documentId,
    data,
  })

  await logAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'manual_ocr_completed',
    entityType: 'document',
    entityId: documentId,
    metadata: {
      case_id: caseId,
      document_id: documentId,
      schema_type: expectedSchemaType,
      completed: true,
    },
  })

  revalidatePath(`/admin/cases/${caseId}/manual-ocr`)
  revalidatePath(`/cases/${caseId}`)
}
