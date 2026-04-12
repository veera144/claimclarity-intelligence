/**
 * @file quality-check.ts
 * @module processor/jobs
 *
 * Processes Module 2 document quality-check jobs.
 *
 * DEPENDENCIES:
 *   - /packages/db/src/client.server.ts
 *   - /packages/db/src/queries/documents.queries.ts
 *   - /packages/shared/src/constants.ts
 *
 * CALLED BY:
 *   - Module 2 verification suite
 *   - future processor job runner loop
 *
 * CALLS:
 *   - Supabase Storage, documents, cases, reviewer_notifications, and processing_jobs tables
 */

import { createServiceClient, listDocumentsForCase, listQueuedQualityCheckJobs, queueProcessingJob } from '@claimclarity/db'
import type { DbClient } from '@claimclarity/db'
import { MAX_DOCUMENT_PAGES, MAX_FILE_SIZE_BYTES, MIN_IMAGE_DPI } from '@claimclarity/shared/constants'

type QualityResult =
  | { status: 'pass'; pageCount?: number; language?: string }
  | { status: 'fail'; reason: string; pageCount?: number; language?: string }
  | { status: 'manual_required'; reason: string; pageCount?: number; language?: string }

type DocumentForQualityCheck = {
  id: string
  case_id: string
  storage_path: string
  file_size_bytes: number | null
  mime_type: string | null
}

type CaseForQualityCheck = {
  id: string
  payment_waived: boolean
}

const PDF_PAGE_PATTERN = /\/Type\s*\/Page\b/g
const PDF_TEXT_PATTERN = /\(([^)]{2,})\)/g

function inferMimeType(buffer: Buffer): string | null {
  if (buffer.subarray(0, 4).toString('utf8') === '%PDF') {
    return 'application/pdf'
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return 'image/jpeg'
  }

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png'
  }

  const tiffLittleEndian =
    buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00
  const tiffBigEndian =
    buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a
  return tiffLittleEndian || tiffBigEndian ? 'image/tiff' : null
}

function extractPdfText(buffer: Buffer): string {
  const content = buffer.toString('latin1')
  const matches = Array.from(content.matchAll(PDF_TEXT_PATTERN))
  return matches.map((match) => match[1] ?? '').join(' ')
}

function countPdfPages(buffer: Buffer): number {
  return Array.from(buffer.toString('latin1').matchAll(PDF_PAGE_PATTERN)).length
}

function detectLanguage(text: string): string | null {
  const sample = text.slice(0, 2000)
  if (/[\u0900-\u097F]/u.test(sample)) {
    return 'hi'
  }

  if (/[A-Za-z]/.test(sample)) {
    return 'en'
  }

  return null
}

function readJpegDpi(buffer: Buffer): number | null {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null
  }

  let offset = 2
  while (offset + 4 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      return null
    }

    const marker = buffer[offset + 1]
    const length = buffer.readUInt16BE(offset + 2)
    const segmentStart = offset + 4

    if (marker === 0xe0 && buffer.subarray(segmentStart, segmentStart + 5).toString('ascii') === 'JFIF\0') {
      const units = buffer[segmentStart + 7]
      const xDensity = buffer.readUInt16BE(segmentStart + 8)
      if (units === 1) {
        return xDensity
      }

      if (units === 2) {
        return Math.round(xDensity * 2.54)
      }

      return null
    }

    offset += 2 + length
  }

  return null
}

function objectPathFromStoragePath(storagePath: string): string {
  return storagePath.startsWith('case-documents/')
    ? storagePath.slice('case-documents/'.length)
    : storagePath
}

async function downloadDocumentBuffer(input: {
  client: DbClient
  storagePath: string
}): Promise<Buffer> {
  const { data, error } = await input.client.storage
    .from('case-documents')
    .createSignedUrl(objectPathFromStoragePath(input.storagePath), 300)

  if (error) {
    throw new Error(error.message)
  }

  const response = await fetch(data.signedUrl)
  if (!response.ok) {
    throw new Error(`Unable to fetch signed document URL: ${String(response.status)}`)
  }

  return Buffer.from(await response.arrayBuffer())
}

function evaluateQuality(buffer: Buffer, mimeType: string | null): QualityResult {
  if (buffer.byteLength > MAX_FILE_SIZE_BYTES) {
    return { status: 'fail', reason: 'This file is too large. Maximum is 20MB.' }
  }

  const inferredMimeType = inferMimeType(buffer)
  if (!inferredMimeType || inferredMimeType !== mimeType) {
    return { status: 'fail', reason: 'Only PDF, JPEG, PNG, and TIFF files are accepted.' }
  }

  if (inferredMimeType === 'application/pdf') {
    const pageCount = countPdfPages(buffer)
    if (pageCount > MAX_DOCUMENT_PAGES) {
      return {
        status: 'manual_required',
        reason: 'Document has over 50 pages - a reviewer will extract relevant sections.',
        pageCount,
      }
    }

    const text = extractPdfText(buffer)
    if (!text.trim()) {
      return {
        status: 'manual_required',
        reason: 'Your PDF contains scanned images. Processing may take up to 48 hours.',
        pageCount,
      }
    }

    const language = detectLanguage(text)
    if (language !== 'en' && language !== 'hi') {
      return {
        status: 'fail',
        reason: 'We currently support English documents only.',
        pageCount,
      }
    }

    return { status: 'pass', pageCount, language }
  }

  if (inferredMimeType === 'image/jpeg') {
    const dpi = readJpegDpi(buffer)
    if (dpi === null || dpi < MIN_IMAGE_DPI) {
      return {
        status: 'fail',
        reason: 'Image resolution too low. Please re-upload at 150 DPI or higher.',
      }
    }
  }

  return { status: 'pass' }
}

async function getDocumentForQualityCheck(input: {
  client: DbClient
  documentId: string
}): Promise<DocumentForQualityCheck> {
  const { data, error } = await input.client
    .from('documents')
    .select('id, case_id, storage_path, file_size_bytes, mime_type')
    .eq('id', input.documentId)
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

async function getCaseForQualityCheck(input: {
  client: DbClient
  caseId: string
}): Promise<CaseForQualityCheck> {
  const { data, error } = await input.client
    .from('cases')
    .select('id, payment_waived')
    .eq('id', input.caseId)
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

async function queuePatientFailureEmail(input: {
  client: DbClient
  caseId: string
  documentId: string
  reason: string
}): Promise<void> {
  await queueProcessingJob({
    client: input.client,
    caseId: input.caseId,
    documentId: input.documentId,
    jobType: 'email_delivery',
    idempotencyKey: `quality_email:${input.caseId}:${input.documentId}`,
    payload: { reason: input.reason },
  })
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
    console.warn('[quality-check] No reviewer/admin user available for manual-required notification')
    return
  }

  await input.client.from('reviewer_notifications').insert({
    recipient_id: reviewer.id,
    notification_type: 'document_manual_required',
    case_id: input.caseId,
    message: input.reason,
  })
}

async function advanceCaseIfRequiredDocsPassed(input: {
  client: DbClient
  caseId: string
}): Promise<void> {
  const [caseRow, documents] = await Promise.all([
    getCaseForQualityCheck({ client: input.client, caseId: input.caseId }),
    listDocumentsForCase({ client: input.client, caseId: input.caseId }),
  ])

  const coveragePassed = documents.some(
    (document) =>
      (document.doc_type === 'policy' || document.doc_type === 'cis') &&
      document.quality_status === 'pass'
  )
  const hospitalBillPassed = documents.some(
    (document) => document.doc_type === 'hospital_bill' && document.quality_status === 'pass'
  )
  const insurerResponsePassed = documents.some(
    (document) => document.doc_type === 'insurer_response' && document.quality_status === 'pass'
  )

  if (!coveragePassed || !hospitalBillPassed || !insurerResponsePassed) {
    return
  }

  if (caseRow.payment_waived) {
    const requiredDocuments = documents.filter(
      (document) =>
        document.quality_status === 'pass' &&
        (document.doc_type === 'policy' ||
          document.doc_type === 'cis' ||
          document.doc_type === 'hospital_bill' ||
          document.doc_type === 'insurer_response')
    )

    await Promise.all(
      requiredDocuments.map((document) =>
        queueProcessingJob({
          client: input.client,
          caseId: input.caseId,
          documentId: document.id,
          jobType: 'ocr',
          idempotencyKey: `ocr:${input.caseId}:${document.id}`,
        })
      )
    )

    await input.client
      .from('cases')
      .update({
        status: 'processing',
        current_step: 'quality_check',
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.caseId)
    return
  }

  await input.client
    .from('cases')
    .update({
      status: 'payment_pending',
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.caseId)
}

async function processQualityCheckJob(input: {
  client: DbClient
  jobId: string
  caseId: string
  documentId: string
}): Promise<void> {
  await input.client
    .from('processing_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', input.jobId)

  const document = await getDocumentForQualityCheck({
    client: input.client,
    documentId: input.documentId,
  })
  const buffer = await downloadDocumentBuffer({
    client: input.client,
    storagePath: document.storage_path,
  })
  const result = evaluateQuality(buffer, document.mime_type)
  const checkedAt = new Date().toISOString()

  if (result.status === 'pass') {
    await input.client
      .from('documents')
      .update({
        quality_status: 'pass',
        quality_failure_reason: null,
        quality_checked_at: checkedAt,
        page_count: result.pageCount ?? null,
        language_detected: result.language ?? null,
      })
      .eq('id', input.documentId)
    await advanceCaseIfRequiredDocsPassed({ client: input.client, caseId: input.caseId })
  } else {
    await input.client
      .from('documents')
      .update({
        quality_status: result.status,
        quality_failure_reason: result.reason,
        quality_checked_at: checkedAt,
        page_count: result.pageCount ?? null,
        language_detected: result.language ?? null,
      })
      .eq('id', input.documentId)

    if (result.status === 'fail') {
      await queuePatientFailureEmail({
        client: input.client,
        caseId: input.caseId,
        documentId: input.documentId,
        reason: result.reason,
      })
    } else {
      await insertManualReviewNotification({
        client: input.client,
        caseId: input.caseId,
        reason: result.reason,
      })
    }
  }

  await input.client
    .from('processing_jobs')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      result,
    })
    .eq('id', input.jobId)
}

/**
 * Processes queued Module 2 quality-check jobs.
 *
 * SIDE EFFECTS: downloads files, updates documents/cases/jobs, queues downstream jobs
 * THROWS: Error when job lookup or processing fails unexpectedly
 * IDEMPOTENT: yes for downstream queue creation; job status prevents repeat processing
 *
 * @param client - Optional service-role client for tests; created when omitted
 * @returns Number of jobs processed in this call
 */
export async function processQueuedQualityCheckJobs(
  client: DbClient = createServiceClient(),
  caseId?: string
): Promise<number> {
  const jobs = await listQueuedQualityCheckJobs({
    client,
    ...(caseId ? { caseId } : {}),
  })
  let processed = 0

  for (const job of jobs) {
    if (!job.document_id) {
      await client
        .from('processing_jobs')
        .update({
          status: 'failed',
          error_message: 'quality_check job missing document_id',
          completed_at: new Date().toISOString(),
        })
        .eq('id', job.id)
      continue
    }

    try {
      await processQualityCheckJob({
        client,
        jobId: job.id,
        caseId: job.case_id,
        documentId: job.document_id,
      })
      processed += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await client
        .from('processing_jobs')
        .update({
          status: 'failed',
          error_message: message,
          completed_at: new Date().toISOString(),
        })
        .eq('id', job.id)
      throw error
    }
  }

  return processed
}
