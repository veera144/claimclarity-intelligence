/**
 * @file documents.queries.ts
 * @module db/queries/documents
 *
 * Document and processing-job helpers for upload, quality checks, and OCR.
 *
 * DEPENDENCIES:
 *   - /packages/db/src/types.ts
 *
 * CALLED BY:
 *   - /apps/web/app/api/cases/[caseId]/documents/route.ts
 *   - /apps/processor/src/jobs/quality-check.ts
 *   - /apps/processor/src/jobs/ocr-job.ts
 *
 * CALLS:
 *   - Supabase documents, cases, and processing_jobs tables
 */

import type { DbClient, Json } from '../types'

export type CaseDocumentStatus = {
  id: string
  case_id: string
  doc_type: string
  is_required: boolean | null
  storage_path: string
  file_size_bytes: number | null
  mime_type: string | null
  page_count: number | null
  quality_status: 'pending' | 'pass' | 'fail' | 'manual_required' | null
  quality_failure_reason: string | null
  uploaded_at: string | null
}

export type QualityCheckJob = {
  id: string
  case_id: string
  document_id: string | null
  attempt_count?: number | null
  max_attempts?: number | null
}

export type OcrJob = Required<Pick<QualityCheckJob, 'id' | 'case_id'>> & {
  document_id: string | null
  attempt_count: number | null
  max_attempts: number | null
}

/**
 * Lists document statuses for a case.
 *
 * SIDE EFFECTS: reads documents
 * THROWS: Error when Supabase rejects the query
 * IDEMPOTENT: yes, read-only
 *
 * @param input - Case id and database client
 * @returns Documents ordered by upload time
 */
export async function listDocumentsForCase(input: {
  caseId: string
  client: DbClient
}): Promise<CaseDocumentStatus[]> {
  const { data, error } = await input.client
    .from('documents')
    .select(
      'id, case_id, doc_type, is_required, storage_path, file_size_bytes, mime_type, page_count, quality_status, quality_failure_reason, uploaded_at'
    )
    .eq('case_id', input.caseId)
    .order('uploaded_at', { ascending: true })

  if (error) {
    throw new Error(error.message)
  }

  return data
}

/**
 * Queues a processing job with a unique idempotency key.
 *
 * SIDE EFFECTS: upserts processing_jobs
 * THROWS: Error when Supabase rejects the mutation
 * IDEMPOTENT: yes, the idempotency key prevents duplicate queued jobs
 *
 * @param input - Job details and database client
 * @returns Nothing
 */
export async function queueProcessingJob(input: {
  client: DbClient
  caseId: string
  documentId?: string | null
  jobType: 'quality_check' | 'ocr' | 'rules_engine' | 'email_delivery'
  idempotencyKey: string
  payload?: Json
}): Promise<void> {
  const { error } = await input.client.from('processing_jobs').upsert(
    {
      case_id: input.caseId,
      document_id: input.documentId ?? null,
      job_type: input.jobType,
      status: 'queued',
      payload: input.payload ?? null,
      idempotency_key: input.idempotencyKey,
    },
    { onConflict: 'idempotency_key', ignoreDuplicates: true }
  )

  if (error) {
    throw new Error(error.message)
  }
}

/**
 * Lists queued quality-check jobs.
 *
 * SIDE EFFECTS: reads processing_jobs
 * THROWS: Error when Supabase rejects the query
 * IDEMPOTENT: yes, read-only
 *
 * @param client - Service-role database client
 * @returns Queued quality-check jobs
 */
export async function listQueuedQualityCheckJobs(input: {
  client: DbClient
  caseId?: string
}): Promise<QualityCheckJob[]> {
  let query = input.client
    .from('processing_jobs')
    .select('id, case_id, document_id')
    .eq('job_type', 'quality_check')
    .eq('status', 'queued')
    .order('queued_at', { ascending: true })

  if (input.caseId) {
    query = query.eq('case_id', input.caseId)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return data
}

/**
 * Lists queued OCR jobs.
 *
 * SIDE EFFECTS: reads processing_jobs
 * THROWS: Error when Supabase rejects the query
 * IDEMPOTENT: yes, read-only
 *
 * @param input - Service-role database client and optional case id
 * @returns Queued OCR jobs
 */
export async function listQueuedOcrJobs(input: {
  client: DbClient
  caseId?: string
}): Promise<OcrJob[]> {
  let query = input.client
    .from('processing_jobs')
    .select('id, case_id, document_id, attempt_count, max_attempts')
    .eq('job_type', 'ocr')
    .eq('status', 'queued')
    .order('queued_at', { ascending: true })

  if (input.caseId) {
    query = query.eq('case_id', input.caseId)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message)
  }

  return data
}
