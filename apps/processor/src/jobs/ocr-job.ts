/**
 * @file ocr-job.ts
 * @module processor/jobs
 *
 * Processes Module 4 OCR jobs and persists normalized extraction JSON only.
 *
 * DEPENDENCIES:
 *   - /packages/db/src/client.server.ts
 *   - /packages/db/src/queries/documents.queries.ts
 *   - /apps/processor/src/ocr/textract-client.ts
 *   - /apps/processor/src/extraction/*.ts
 *
 * CALLED BY:
 *   - Module 4 checkpoint tests
 *   - future processor job runner loop
 *
 * CALLS:
 *   - Supabase documents, cases, outcomes, reviewer_notifications, and processing_jobs tables
 *   - Textract adapter through injectable boundaries
 */

import {
  createServiceClient,
  listDocumentsForCase,
  listQueuedOcrJobs,
  queueProcessingJob,
  type DbClient,
  type Json,
  type OcrJob,
} from '@claimclarity/db'
import { JOB_RETRY_BASE_MINUTES } from '@claimclarity/shared/constants'
import { err, ok, type Result } from '@claimclarity/shared/result'

import { normalizeBillLines } from '../extraction/bill-normalizer'
import { parseInsurerLetter, type InsurerLetterData } from '../extraction/insurer-letter-parser'
import { chunkPolicy } from '../extraction/policy-chunker'
import {
  createLiveTextractDependencies,
  createSupabaseStorageReader,
  extractDocument,
} from '../ocr/textract-client'
import type {
  ExtractionResult,
  NormalizedExtractionJson,
  NormalizedExtractionValue,
  TextractBlock,
} from '../ocr/textract-types'

type DocumentForOcr = {
  id: string
  case_id: string
  doc_type: string
  is_required: boolean | null
  storage_path: string
  file_size_bytes: number | null
  mime_type: string | null
  page_count: number | null
  ocr_status: 'pending' | 'running' | 'completed' | 'failed' | null
  extracted_json: Json | null
}

type ExtractorInput = {
  document: DocumentForOcr
  jobId: string
}

export type OcrProcessorDeps = {
  extractDocument?: (input: ExtractorInput) => Promise<ExtractionResult>
}

function toJson(value: NormalizedExtractionJson): Json {
  return value as Json
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasUsableNormalizedExtraction(value: Json | null): boolean {
  if (!isRecord(value)) {
    return false
  }

  const data = value.data
  return (
    value.schema_version === 'module4.v1' &&
    isRecord(data) &&
    Object.keys(data).length > 0 &&
    value.extraction_source !== undefined
  )
}

function createNormalizedExtraction(input: {
  source: 'textract' | 'manual'
  docType: string
  confidence: number | null
  hasTables: boolean
  hasHandwriting: boolean
  data: { [key: string]: NormalizedExtractionValue | undefined }
}): NormalizedExtractionJson {
  return {
    schema_version: 'module4.v1',
    extraction_source: input.source,
    doc_type: input.docType,
    confidence: input.confidence,
    has_tables: input.hasTables,
    has_handwriting: input.hasHandwriting,
    data: input.data,
  }
}

function normalizeExtractionForDocument(input: {
  document: DocumentForOcr
  extraction: Extract<ExtractionResult, { status: 'succeeded' }>
}): Result<NormalizedExtractionJson> {
  const base = {
    source: 'textract' as const,
    docType: input.document.doc_type,
    confidence: input.extraction.confidence,
    hasTables: input.extraction.hasTables,
    hasHandwriting: input.extraction.hasHandwriting,
  }

  if (input.document.doc_type === 'hospital_bill') {
    const result = normalizeBillLines(input.extraction.blocks)
    if (!result.ok) return err(result.error)
    return ok(createNormalizedExtraction({ ...base, data: { bill_lines: result.value } }))
  }

  if (input.document.doc_type === 'policy' || input.document.doc_type === 'cis') {
    const result = chunkPolicy(input.extraction.blocks)
    if (!result.ok) return err(result.error)
    return ok(createNormalizedExtraction({ ...base, data: { policy_chunks: result.value } }))
  }

  if (input.document.doc_type === 'insurer_response') {
    const result = parseInsurerLetter(input.extraction.blocks)
    if (!result.ok) return err(result.error)
    return ok(createNormalizedExtraction({ ...base, data: { insurer_letter: result.value } }))
  }

  const lines = input.extraction.blocks
    .filter((block) => block.blockType === 'LINE')
    .map((block) => block.text)
    .filter((text): text is string => Boolean(text))
    .slice(0, 20)

  if (lines.length === 0) {
    return err('No structured OCR output available for this document type.')
  }

  return ok(createNormalizedExtraction({ ...base, data: { summary_lines: lines } }))
}

async function getDocumentForOcr(input: {
  client: DbClient
  documentId: string
}): Promise<DocumentForOcr> {
  const { data, error } = await input.client
    .from('documents')
    .select(
      'id, case_id, doc_type, is_required, storage_path, file_size_bytes, mime_type, page_count, ocr_status, extracted_json'
    )
    .eq('id', input.documentId)
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

async function insertManualReviewNotification(input: {
  client: DbClient
  caseId: string
  reason: string
}): Promise<void> {
  const { data: reviewer } = await input.client
    .from('users')
    .select('id')
    .in('role', ['reviewer', 'admin'])
    .limit(1)
    .maybeSingle()

  if (!reviewer) {
    console.warn('[ocr-job] No reviewer/admin user available for OCR manual-required notification')
    return
  }

  const { error } = await input.client.from('reviewer_notifications').insert({
    recipient_id: reviewer.id,
    notification_type: 'document_manual_required',
    case_id: input.caseId,
    message: input.reason,
  })

  if (error) {
    throw new Error(error.message)
  }
}

async function markManualRequired(input: {
  client: DbClient
  documentId: string
  caseId: string
  jobId: string
  reason: string
  confidence: number | null
}): Promise<void> {
  await input.client
    .from('documents')
    .update({
      quality_status: 'manual_required',
      quality_failure_reason: input.reason,
      ocr_status: 'failed',
      ocr_completed_at: new Date().toISOString(),
      extracted_json: null,
      extracted_text: null,
      extraction_confidence: input.confidence,
    })
    .eq('id', input.documentId)

  await insertManualReviewNotification({
    client: input.client,
    caseId: input.caseId,
    reason: input.reason,
  })

  await input.client
    .from('processing_jobs')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      result: { status: 'manual_required', reason: input.reason, confidence: input.confidence },
    })
    .eq('id', input.jobId)
}

async function applyInsurerAmounts(input: {
  client: DbClient
  caseId: string
  data: InsurerLetterData
}): Promise<void> {
  const [caseUpdate, outcomeUpdate] = await Promise.all([
    input.client
      .from('cases')
      .update({
        original_approved_inr: input.data.approved_amount_inr,
        originally_deducted_inr: input.data.deducted_amount_inr,
      })
      .eq('id', input.caseId),
    input.client
      .from('outcomes')
      .update({
        original_approved_inr: input.data.approved_amount_inr,
        originally_deducted_inr: input.data.deducted_amount_inr,
      })
      .eq('case_id', input.caseId)
      .select('id'),
  ])

  if (caseUpdate.error) {
    throw new Error(caseUpdate.error.message)
  }

  if (outcomeUpdate.error) {
    throw new Error(outcomeUpdate.error.message)
  }

  if (outcomeUpdate.data.length === 0) {
    const { error } = await input.client.from('outcomes').insert({
      case_id: input.caseId,
      original_approved_inr: input.data.approved_amount_inr,
      originally_deducted_inr: input.data.deducted_amount_inr,
    })

    if (error) {
      throw new Error(error.message)
    }
  }
}

function insurerDataFromExtraction(extractedJson: NormalizedExtractionJson): InsurerLetterData | null {
  const insurerLetter = extractedJson.data.insurer_letter
  if (!isRecord(insurerLetter)) {
    return null
  }

  return {
    claim_number:
      typeof insurerLetter.claim_number === 'string' ? insurerLetter.claim_number : null,
    policy_number:
      typeof insurerLetter.policy_number === 'string' ? insurerLetter.policy_number : null,
    approved_amount_inr:
      typeof insurerLetter.approved_amount_inr === 'number'
        ? insurerLetter.approved_amount_inr
        : null,
    deducted_amount_inr:
      typeof insurerLetter.deducted_amount_inr === 'number'
        ? insurerLetter.deducted_amount_inr
        : null,
    deductions: [],
    stated_reason_summary:
      typeof insurerLetter.stated_reason_summary === 'string'
        ? insurerLetter.stated_reason_summary
        : null,
  }
}

async function maybeQueueRulesEngine(input: { client: DbClient; caseId: string }): Promise<void> {
  const documents = await listDocumentsForCase({ client: input.client, caseId: input.caseId })
  const requiredDocuments = documents.filter((document) => document.is_required === true)
  if (requiredDocuments.length === 0) {
    return
  }

  const requiredReady = requiredDocuments.every((document) => {
    if (
      document.quality_status === 'manual_required' ||
      document.quality_status === 'pending' ||
      document.quality_status === 'fail'
    ) {
      return false
    }

    return document.quality_status === 'pass'
  })

  if (!requiredReady) {
    return
  }

  const { data, error } = await input.client
    .from('documents')
    .select('id, ocr_status, extracted_json, quality_status')
    .eq('case_id', input.caseId)
    .eq('is_required', true)

  if (error) {
    throw new Error(error.message)
  }

  const allOcrReady = data.every(
    (document) =>
      document.ocr_status === 'completed' &&
      document.quality_status !== 'manual_required' &&
      hasUsableNormalizedExtraction(document.extracted_json)
  )

  if (!allOcrReady) {
    return
  }

  await queueProcessingJob({
    client: input.client,
    caseId: input.caseId,
    documentId: null,
    jobType: 'rules_engine',
    idempotencyKey: `rules_engine:${input.caseId}`,
  })

  await input.client
    .from('cases')
    .update({ current_step: 'rules_engine', updated_at: new Date().toISOString() })
    .eq('id', input.caseId)
}

async function defaultExtractDocument(input: {
  client: DbClient
  document: DocumentForOcr
  jobId: string
}): Promise<ExtractionResult> {
  const live = createLiveTextractDependencies()
  return extractDocument({
    storagePath: input.document.storage_path,
    docType: input.document.doc_type,
    caseId: input.document.case_id,
    documentId: input.document.id,
    jobId: input.jobId,
    mimeType: input.document.mime_type,
    pageCount: input.document.page_count,
    fileSizeBytes: input.document.file_size_bytes,
    storage: createSupabaseStorageReader(input.client),
    textract: live.textract,
    s3: live.s3,
    config: live.config,
  })
}

async function processOcrJob(input: {
  client: DbClient
  job: OcrJob
  deps: OcrProcessorDeps
}): Promise<void> {
  if (!input.job.document_id) {
    throw new Error('ocr job missing document_id')
  }

  const document = await getDocumentForOcr({
    client: input.client,
    documentId: input.job.document_id,
  })

  if (document.ocr_status === 'completed' && hasUsableNormalizedExtraction(document.extracted_json)) {
    await input.client
      .from('processing_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        result: { status: 'skipped', reason: 'document already has usable extracted_json' },
      })
      .eq('id', input.job.id)
    await maybeQueueRulesEngine({ client: input.client, caseId: input.job.case_id })
    return
  }

  await Promise.all([
    input.client
      .from('processing_jobs')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', input.job.id),
    input.client
      .from('documents')
      .update({
        ocr_status: 'running',
        ocr_started_at: new Date().toISOString(),
        ocr_attempt_count: (input.job.attempt_count ?? 0) + 1,
      })
      .eq('id', document.id),
  ])

  const extractor =
    input.deps.extractDocument ??
    ((extractInput: ExtractorInput) =>
      defaultExtractDocument({
        client: input.client,
        document: extractInput.document,
        jobId: extractInput.jobId,
      }))
  const extraction = await extractor({ document, jobId: input.job.id })

  if (extraction.status === 'manual_required') {
    await markManualRequired({
      client: input.client,
      documentId: document.id,
      caseId: document.case_id,
      jobId: input.job.id,
      reason: extraction.reason,
      confidence: extraction.confidence,
    })
    return
  }

  const normalized = normalizeExtractionForDocument({ document, extraction })
  if (!normalized.ok) {
    await markManualRequired({
      client: input.client,
      documentId: document.id,
      caseId: document.case_id,
      jobId: input.job.id,
      reason: normalized.error,
      confidence: extraction.confidence,
    })
    return
  }

  if (document.doc_type === 'insurer_response') {
    const insurerData = insurerDataFromExtraction(normalized.value)
    if (insurerData) {
      await applyInsurerAmounts({ client: input.client, caseId: document.case_id, data: insurerData })
    }
  }

  await Promise.all([
    input.client
      .from('documents')
      .update({
        extracted_json: toJson(normalized.value),
        extracted_text: null,
        ocr_status: 'completed',
        ocr_completed_at: new Date().toISOString(),
        extraction_confidence: extraction.confidence,
        has_tables: extraction.hasTables,
        has_handwriting: extraction.hasHandwriting,
      })
      .eq('id', document.id),
    input.client
      .from('processing_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        result: {
          status: 'completed',
          mode: extraction.mode,
          confidence: extraction.confidence,
          has_tables: extraction.hasTables,
          has_handwriting: extraction.hasHandwriting,
        },
      })
      .eq('id', input.job.id),
  ])

  await maybeQueueRulesEngine({ client: input.client, caseId: document.case_id })
}

async function markOcrJobFailure(input: {
  client: DbClient
  job: OcrJob
  message: string
}): Promise<void> {
  const nextAttempt = (input.job.attempt_count ?? 0) + 1
  const maxAttempts = input.job.max_attempts ?? 3
  const retryAllowed = nextAttempt < maxAttempts
  const now = Date.now()
  const retryAt = new Date(
    now + Math.pow(JOB_RETRY_BASE_MINUTES, nextAttempt) * 60 * 1000
  ).toISOString()

  await input.client
    .from('processing_jobs')
    .update({
      status: retryAllowed ? 'retrying' : 'failed',
      attempt_count: nextAttempt,
      error_message: input.message,
      completed_at: retryAllowed ? null : new Date().toISOString(),
      next_retry_at: retryAllowed ? retryAt : null,
    })
    .eq('id', input.job.id)

  if (!retryAllowed && input.job.document_id) {
    await input.client
      .from('documents')
      .update({
        quality_status: 'manual_required',
        quality_failure_reason: input.message,
        ocr_status: 'failed',
        ocr_completed_at: new Date().toISOString(),
        extracted_json: null,
        extracted_text: null,
      })
      .eq('id', input.job.document_id)

    await insertManualReviewNotification({
      client: input.client,
      caseId: input.job.case_id,
      reason: input.message,
    })
  }
}

/**
 * Processes queued Module 4 OCR jobs.
 *
 * SIDE EFFECTS: updates OCR documents/jobs/cases/outcomes and may queue rules_engine
 * THROWS: none for per-job failures; failed jobs are marked retrying/failed
 * IDEMPOTENT: yes at document level; completed documents with usable extracted_json are skipped
 *
 * @param client - Optional service-role client for tests; created when omitted
 * @param caseId - Optional case id filter
 * @param deps - Optional injected extractor for non-live tests
 * @returns Number of jobs that completed or reached handled manual fallback
 */
export async function processQueuedOcrJobs(
  client: DbClient = createServiceClient(),
  caseId?: string,
  deps: OcrProcessorDeps = {}
): Promise<number> {
  const jobs = await listQueuedOcrJobs({
    client,
    ...(caseId ? { caseId } : {}),
  })
  let processed = 0

  for (const job of jobs) {
    try {
      await processOcrJob({ client, job, deps })
      processed += 1
    } catch (error) {
      await markOcrJobFailure({
        client,
        job,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return processed
}

/**
 * Persists reviewer-completed manual extraction using the same normalized JSON schema.
 *
 * SIDE EFFECTS: updates documents and may queue rules_engine
 * THROWS: Error when Supabase rejects the update
 * IDEMPOTENT: yes for the same manual data payload
 *
 * @param input - Manual extraction payload and service-role client
 * @returns Nothing
 */
export async function completeManualOcrExtraction(input: {
  client: DbClient
  documentId: string
  data: { [key: string]: NormalizedExtractionValue | undefined }
}): Promise<void> {
  const document = await getDocumentForOcr({ client: input.client, documentId: input.documentId })
  const normalized = createNormalizedExtraction({
    source: 'manual',
    docType: document.doc_type,
    confidence: null,
    hasTables: false,
    hasHandwriting: false,
    data: input.data,
  })

  const { error } = await input.client
    .from('documents')
    .update({
      extracted_json: toJson(normalized),
      extracted_text: null,
      ocr_status: 'completed',
      ocr_completed_at: new Date().toISOString(),
      quality_status: 'pass',
      quality_failure_reason: null,
    })
    .eq('id', input.documentId)

  if (error) {
    throw new Error(error.message)
  }

  await maybeQueueRulesEngine({ client: input.client, caseId: document.case_id })
}

/**
 * Exposes normalized extraction validation for Module 4 checkpoints.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, pure predicate
 *
 * @param value - Stored extracted_json value
 * @returns True when downstream rules_engine can safely consume the value
 */
export function hasUsableExtractedJson(value: Json | null): boolean {
  return hasUsableNormalizedExtraction(value)
}

/**
 * Exposes normalizer dispatch for Module 4 checkpoints.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, pure transformation
 *
 * @param document - Document metadata
 * @param blocks - Textract blocks
 * @param confidence - Confidence in 0..1 form
 * @returns Normalized extraction JSON or handled reason
 */
export function normalizeOcrBlocks(input: {
  document: Pick<DocumentForOcr, 'doc_type'>
  blocks: TextractBlock[]
  confidence: number
  hasTables: boolean
  hasHandwriting: boolean
}): Result<NormalizedExtractionJson> {
  return normalizeExtractionForDocument({
    document: {
      id: 'checkpoint',
      case_id: 'checkpoint',
      is_required: true,
      storage_path: 'checkpoint',
      file_size_bytes: null,
      mime_type: null,
      page_count: null,
      ocr_status: 'pending',
      extracted_json: null,
      ...input.document,
    },
    extraction: {
      status: 'succeeded',
      mode: 'sync_image_bytes',
      blocks: input.blocks,
      confidence: input.confidence,
      hasTables: input.hasTables,
      hasHandwriting: input.hasHandwriting,
    },
  })
}
