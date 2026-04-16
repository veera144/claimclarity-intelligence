/**
 * @file module4.test.ts
 * @module processor/tests
 *
 * Executable Module 4 OCR and extraction pipeline checkpoints.
 *
 * DEPENDENCIES:
 *   - @claimclarity/db
 *   - processor OCR/extraction modules
 *
 * CALLED BY:
 *   - pnpm test:module4
 *
 * CALLS:
 *   - Supabase public schema tables
 *   - AWS S3 staging bucket for put/get/delete readiness only
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createServiceClient, type DbClient } from '@claimclarity/db'
import type { Database } from '@claimclarity/db/types'

import { normalizeBillLines } from '../src/extraction/bill-normalizer'
import { parseInsurerLetter } from '../src/extraction/insurer-letter-parser'
import { chunkPolicy } from '../src/extraction/policy-chunker'
import {
  completeManualOcrExtraction,
  hasUsableExtractedJson,
  processQueuedOcrJobs,
} from '../src/jobs/ocr-job'
import { selectExtractionRoute } from '../src/ocr/document-routing'
import {
  createAwsS3StagingGateway,
  extractDocument,
  readTextractRuntimeConfig,
  type S3StagingGateway,
  type TextractGateway,
} from '../src/ocr/textract-client'
import {
  TextractBlockType,
  type ExtractionResult,
  type TextractBlock,
} from '../src/ocr/textract-types'

type CheckpointName =
  | 'env_presence'
  | 's3_staging_put_get_delete'
  | 'extraction_mode_routing'
  | 'normalizers'
  | 'manual_required_fallback'
  | 'manual_fallback_not_fake_success'
  | 'failed_ocr_retries'
  | 'no_raw_ocr_persistence'
  | 'idempotent_ocr_job_handling'
  | 'insurer_amounts_written'
  | 'rules_engine_only_after_usable_extracted_json'
  | 'manual_completion_normalized_shape'

type CheckpointResult = { pass: boolean; detail?: string }
type TestUser = { id: string; email: string }
type TestCase = { id: string }
type TestDocument = { id: string }
type CaseInsertWithPaymentMode = Database['public']['Tables']['cases']['Insert'] & {
  payment_mode: 'test_simulated'
  payment_reporting_category: 'test'
}

const CHECKPOINTS: readonly CheckpointName[] = [
  'env_presence',
  's3_staging_put_get_delete',
  'extraction_mode_routing',
  'normalizers',
  'manual_required_fallback',
  'manual_fallback_not_fake_success',
  'failed_ocr_retries',
  'no_raw_ocr_persistence',
  'idempotent_ocr_job_handling',
  'insurer_amounts_written',
  'rules_engine_only_after_usable_extracted_json',
  'manual_completion_normalized_shape',
]

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const TEST_PASSWORD = 'Module4-test-password-12345'

function loadRootEnv(): void {
  const content = readFileSync(resolve(rootDir, '.env.local'), 'utf8')
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) continue
    const key = line.slice(0, separatorIndex)
    const value = line.slice(separatorIndex + 1)
    if (!process.env[key]) process.env[key] = value
  }
}

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function makeServiceClient(): DbClient {
  return createServiceClient()
}

async function waitForUserRow(serviceClient: DbClient, userId: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data, error } = await serviceClient
      .from('users')
      .select('id')
      .eq('id', userId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (data) return
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 250))
  }
  throw new Error(`Auth trigger did not create users row for ${userId}`)
}

async function createTestUser(
  serviceClient: DbClient,
  label: string,
  role: 'patient' | 'admin' = 'patient'
): Promise<TestUser> {
  const token = randomUUID()
  const email = `module4-${label}-${token}@claimclarity.internal`
  const createResult = await serviceClient.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { module: 'module4', test_run: token },
  })
  if (createResult.error) throw new Error(createResult.error.message)

  const userId = createResult.data.user.id
  await waitForUserRow(serviceClient, userId)
  if (role !== 'patient') {
    const { error } = await serviceClient.from('users').update({ role }).eq('id', userId)
    if (error) throw new Error(error.message)
  }
  return { id: userId, email }
}

async function cleanupUser(serviceClient: DbClient, user: TestUser): Promise<void> {
  await serviceClient.from('consents').delete().eq('user_id', user.id)
  await serviceClient.auth.admin.deleteUser(user.id)
}

async function createTestCase(serviceClient: DbClient, userId: string, label: string): Promise<TestCase> {
  const caseInsert: CaseInsertWithPaymentMode = {
    patient_id: userId,
    case_ref: `CC-M4-${label}-${randomUUID().slice(0, 8)}`,
    status: 'processing',
    current_step: 'ocr',
    payment_waived: true,
    payment_waived_reason: 'module4 checkpoint',
    payment_mode: 'test_simulated',
    payment_reporting_category: 'test',
  }
  const { data, error } = await serviceClient
    .from('cases')
    .insert(caseInsert)
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  const { error: outcomeError } = await serviceClient.from('outcomes').insert({ case_id: data.id })
  if (outcomeError) throw new Error(outcomeError.message)
  return { id: data.id }
}

async function cleanupCase(serviceClient: DbClient, caseId: string): Promise<void> {
  await serviceClient.from('reviewer_notifications').delete().eq('case_id', caseId)
  await serviceClient.from('processing_jobs').delete().eq('case_id', caseId)
  await serviceClient.from('documents').delete().eq('case_id', caseId)
  await serviceClient.from('outcomes').delete().eq('case_id', caseId)
  await serviceClient.from('reports').delete().eq('case_id', caseId)
  await serviceClient.from('payments').delete().eq('case_id', caseId)
  await serviceClient.from('cases').delete().eq('id', caseId)
}

async function createDocument(input: {
  serviceClient: DbClient
  caseId: string
  docType: string
  isRequired?: boolean
}): Promise<TestDocument> {
  const { data, error } = await input.serviceClient
    .from('documents')
    .insert({
      case_id: input.caseId,
      doc_type: input.docType,
      is_required: input.isRequired ?? true,
      storage_path: `case-documents/${input.caseId}/${input.docType}.png`,
      file_size_bytes: 1024,
      mime_type: 'image/png',
      page_count: 1,
      quality_status: 'pass',
      ocr_status: 'pending',
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return { id: data.id }
}

async function queueOcrJob(input: {
  serviceClient: DbClient
  caseId: string
  documentId: string
  label: string
}): Promise<void> {
  const { error } = await input.serviceClient.from('processing_jobs').insert({
    case_id: input.caseId,
    document_id: input.documentId,
    job_type: 'ocr',
    status: 'queued',
    idempotency_key: `ocr:${input.caseId}:${input.documentId}:${input.label}`,
  })
  if (error) throw new Error(error.message)
}

function tableBlocks(rows: string[][]): TextractBlock[] {
  const cellIds = rows.flatMap((row, rowIndex) =>
    row.map((_, columnIndex) => `cell-${String(rowIndex)}-${String(columnIndex)}`)
  )
  const blocks: TextractBlock[] = [
    {
      id: 'table-1',
      blockType: TextractBlockType.TABLE,
      page: 1,
      relationships: [{ type: 'CHILD', ids: cellIds }],
    },
  ]

  rows.forEach((row, rowIndex) => {
    row.forEach((text, columnIndex) => {
      const cellId = `cell-${String(rowIndex)}-${String(columnIndex)}`
      const wordId = `word-${String(rowIndex)}-${String(columnIndex)}`
      blocks.push({
        id: cellId,
        blockType: TextractBlockType.CELL,
        rowIndex: rowIndex + 1,
        columnIndex: columnIndex + 1,
        relationships: [{ type: 'CHILD', ids: [wordId] }],
      })
      blocks.push({ id: wordId, blockType: TextractBlockType.WORD, text, confidence: 96 })
    })
  })
  return blocks
}

function lineBlocks(lines: string[]): TextractBlock[] {
  return lines.flatMap((line, index) => [
    { id: `line-${String(index)}`, blockType: TextractBlockType.LINE, text: line, confidence: 96 },
    {
      id: `word-line-${String(index)}`,
      blockType: TextractBlockType.WORD,
      text: line.split(/\s+/u)[0] ?? line,
      confidence: 96,
    },
  ])
}

function billFixtureBlocks(): TextractBlock[] {
  return tableBlocks([
    ['Description', 'Qty', 'Rate', 'Amount'],
    ['Room Charges', '1', '₹5,000.00', '₹5,000.00'],
    ['Pharmacy Medicines', '1', '₹2,000.00', '₹2,000.00'],
    ['Doctor Consultation', '1', '₹1,000.00', '₹1,000.00'],
    ['Grand Total', '', '', '₹8,000.00'],
  ])
}

function policyFixtureBlocks(): TextractBlock[] {
  return lineBlocks([
    'ROOM RENT',
    'Room rent is covered up to one percent of sum insured per day.',
    'CO-PAYMENT',
    'A co-payment of ten percent applies to admissible claims.',
  ])
}

function insurerFixtureBlocks(): TextractBlock[] {
  return [
    ...lineBlocks([
      'Claim No: CLM-123',
      'Policy No: POL-456',
      'Approved Amount: ₹5,000',
      'Deducted Amount: ₹1,000',
      'Reason: Non payable consumables deducted.',
    ]),
    ...tableBlocks([
      ['Item', 'Amount', 'Reason'],
      ['Consumables', '₹1,000', 'Non payable consumables'],
    ]),
  ]
}

function fakeSuccessExtractor(blocks: TextractBlock[]): () => Promise<ExtractionResult> {
  return () => Promise.resolve({
    status: 'succeeded',
    mode: 'sync_image_bytes',
    blocks,
    confidence: 0.96,
    hasTables: blocks.some((block) => block.blockType === TextractBlockType.TABLE),
    hasHandwriting: false,
  })
}

function checkpointEnvPresence(): void {
  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_REGION',
    'AWS_TEXTRACT_STAGING_BUCKET',
  ]
  const missing = required.filter((name) => !process.env[name])
  assertCondition(missing.length === 0, `Missing env vars: ${missing.join(', ')}`)
}

async function checkpointS3Staging(): Promise<void> {
  const config = readTextractRuntimeConfig()
  const s3 = createAwsS3StagingGateway(config)
  assertCondition(typeof s3.getObject === 'function', 'S3 gateway did not expose getObject')
  const key = `${config.stagingPrefix}/module4-checkpoints/${randomUUID()}.txt`
  const body = new TextEncoder().encode('module4-s3-readiness')

  await s3.putObject({ bucket: config.stagingBucket, key, body, contentType: 'text/plain' })
  try {
    const roundTrip = await s3.getObject({ bucket: config.stagingBucket, key })
    assertCondition(
      new TextDecoder().decode(roundTrip) === 'module4-s3-readiness',
      'S3 getObject did not return staged bytes'
    )
  } finally {
    await s3.deleteObject({ bucket: config.stagingBucket, key })
  }
}

async function checkpointExtractionModeRouting(): Promise<void> {
  assertCondition(
    selectExtractionRoute({ mimeType: 'image/png', pageCount: 1, fileSizeBytes: 1000 }).mode ===
      'sync_image_bytes',
    'PNG/JPEG single-page route did not use sync bytes'
  )
  assertCondition(
    selectExtractionRoute({ mimeType: 'application/pdf', pageCount: 4, fileSizeBytes: 1000 }).mode ===
      'async_s3_document_location',
    'PDF/TIFF route did not use async S3 DocumentLocation'
  )
  assertCondition(
    selectExtractionRoute({ mimeType: 'text/plain', pageCount: 1, fileSizeBytes: 1000 }).mode ===
      'manual_required',
    'Unsupported input did not route to manual_required'
  )

  let putCalled = false
  let deleteCalled = false
  let startedWithS3Object = false
  const fakeS3: S3StagingGateway = {
    putObject(): Promise<void> {
      putCalled = true
      return Promise.resolve()
    },
    deleteObject(): Promise<void> {
      deleteCalled = true
      return Promise.resolve()
    },
  }
  const fakeTextract: TextractGateway = {
    analyzeBytes(): Promise<TextractBlock[]> {
      return Promise.reject(new Error('PDF route should not use sync bytes'))
    },
    startAnalysis(document): Promise<string> {
      startedWithS3Object = Boolean(document.bucket && document.key)
      return Promise.resolve('job-module4')
    },
    getAnalysisPage(): Promise<{ status: 'SUCCEEDED'; blocks: TextractBlock[] }> {
      return Promise.resolve({
        status: 'SUCCEEDED',
        blocks: [
          ...lineBlocks(['Approved Amount: ₹5,000']),
          { id: 'confidence-word', blockType: TextractBlockType.WORD, text: 'Approved', confidence: 96 },
        ],
      })
    },
  }

  const result = await extractDocument({
    storagePath: 'case-documents/case/doc.pdf',
    docType: 'insurer_response',
    caseId: 'case',
    documentId: 'doc',
    jobId: 'job',
    mimeType: 'application/pdf',
    pageCount: 2,
    fileSizeBytes: 1000,
    storage: { download(): Promise<Buffer> { return Promise.resolve(Buffer.from('pdf bytes')) } },
    textract: fakeTextract,
    s3: fakeS3,
    config: {
      awsRegion: 'ap-south-1',
      stagingBucket: 'test-bucket',
      stagingPrefix: 'ocr-staging',
      asyncPollIntervalMs: 1,
      asyncTimeoutMs: 100,
    },
  })

  assertCondition(result.status === 'succeeded', 'Fake async extraction did not succeed')
  assertCondition(putCalled, 'Async PDF/TIFF did not put temporary S3 object')
  assertCondition(deleteCalled, 'Async PDF/TIFF did not delete temporary S3 object')
  assertCondition(startedWithS3Object, 'StartDocumentAnalysis did not receive an S3 object')
}

function checkpointNormalizers(): void {
  const bill = normalizeBillLines(billFixtureBlocks())
  assertCondition(bill.ok, bill.ok ? '' : bill.error)
  assertCondition(bill.value.length === 3, `Expected 3 bill lines, got ${String(bill.value.length)}`)
  assertCondition(bill.value[0]?.total_inr === 500000, '₹5000 was not parsed as 500000 paise')
  assertCondition(
    bill.value.some((line) => line.bill_category === 'room_charges') &&
      bill.value.some((line) => line.bill_category === 'pharmacy') &&
      bill.value.some((line) => line.bill_category === 'doctor_fees'),
    'Bill categories were not assigned correctly'
  )

  const policy = chunkPolicy(policyFixtureBlocks())
  assertCondition(policy.ok, policy.ok ? '' : policy.error)
  assertCondition(
    policy.value.some((chunk) => chunk.clause_category === 'room_rent') &&
      policy.value.some((chunk) => chunk.clause_category === 'copay'),
    'Policy chunks missing'
  )

  const insurer = parseInsurerLetter(insurerFixtureBlocks())
  assertCondition(insurer.ok, insurer.ok ? '' : insurer.error)
  assertCondition(insurer.value.approved_amount_inr === 5000, 'Approved amount not whole ₹5000')
  assertCondition(insurer.value.deducted_amount_inr === 1000, 'Deducted amount not whole ₹1000')
}

async function checkpointManualFallback(input: { serviceClient: DbClient; patient: TestUser }): Promise<void> {
  const testCase = await createTestCase(input.serviceClient, input.patient.id, 'manual')
  try {
    const document = await createDocument({
      serviceClient: input.serviceClient,
      caseId: testCase.id,
      docType: 'hospital_bill',
    })
    await queueOcrJob({
      serviceClient: input.serviceClient,
      caseId: testCase.id,
      documentId: document.id,
      label: 'manual',
    })
    await processQueuedOcrJobs(input.serviceClient, testCase.id, {
      extractDocument: () => Promise.resolve({
        status: 'manual_required',
        mode: 'manual_required',
        reason: 'Textract confidence is below the manual-review threshold.',
        confidence: 0.42,
      }),
    })

    const { data: docRead, error } = await input.serviceClient
      .from('documents')
      .select('quality_status, quality_failure_reason, ocr_status, extracted_json')
      .eq('id', document.id)
      .single()
    if (error) throw new Error(error.message)

    const { count, error: notificationError } = await input.serviceClient
      .from('reviewer_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', testCase.id)
    if (notificationError) throw new Error(notificationError.message)

    assertCondition(docRead.quality_status === 'manual_required', 'Document was not manual_required')
    assertCondition(docRead.ocr_status === 'failed', 'Manual fallback was stored as OCR success')
    assertCondition(docRead.extracted_json === null, 'Manual fallback stored fake extracted_json')
    assertCondition(Boolean(docRead.quality_failure_reason), 'Manual fallback reason missing')
    assertCondition((count ?? 0) > 0, 'Reviewer notification was not inserted')
  } finally {
    await cleanupCase(input.serviceClient, testCase.id)
  }
}

async function checkpointNoRawOcr(input: { serviceClient: DbClient; patient: TestUser }): Promise<void> {
  const testCase = await createTestCase(input.serviceClient, input.patient.id, 'raw')
  try {
    const document = await createDocument({
      serviceClient: input.serviceClient,
      caseId: testCase.id,
      docType: 'hospital_bill',
    })
    await queueOcrJob({ serviceClient: input.serviceClient, caseId: testCase.id, documentId: document.id, label: 'raw' })
    await processQueuedOcrJobs(input.serviceClient, testCase.id, {
      extractDocument: fakeSuccessExtractor(billFixtureBlocks()),
    })

    const { data, error } = await input.serviceClient
      .from('documents')
      .select('extracted_json, extracted_text, ocr_status')
      .eq('id', document.id)
      .single()
    if (error) throw new Error(error.message)

    assertCondition(data.ocr_status === 'completed', 'OCR did not complete')
    assertCondition(data.extracted_text === null, 'Raw OCR text was persisted')
    assertCondition(hasUsableExtractedJson(data.extracted_json), 'Normalized extracted_json missing')
    assertCondition(!JSON.stringify(data.extracted_json).includes('Blocks'), 'Raw Textract response persisted')
  } finally {
    await cleanupCase(input.serviceClient, testCase.id)
  }
}

async function checkpointFailedOcrRetries(input: {
  serviceClient: DbClient
  patient: TestUser
}): Promise<void> {
  const testCase = await createTestCase(input.serviceClient, input.patient.id, 'retry')
  try {
    const document = await createDocument({
      serviceClient: input.serviceClient,
      caseId: testCase.id,
      docType: 'hospital_bill',
    })
    await queueOcrJob({
      serviceClient: input.serviceClient,
      caseId: testCase.id,
      documentId: document.id,
      label: 'retry',
    })

    const failingExtractor = (): Promise<ExtractionResult> =>
      Promise.reject(new Error('Simulated Textract transport failure'))

    await processQueuedOcrJobs(input.serviceClient, testCase.id, { extractDocument: failingExtractor })
    const { data: firstRead, error: firstError } = await input.serviceClient
      .from('processing_jobs')
      .select('id, status, attempt_count, next_retry_at')
      .eq('case_id', testCase.id)
      .eq('job_type', 'ocr')
      .single()
    if (firstError) throw new Error(firstError.message)

    assertCondition(firstRead.status === 'retrying', `Expected retrying, got ${firstRead.status}`)
    assertCondition(firstRead.attempt_count === 1, 'First failure did not increment attempt_count')
    assertCondition(Boolean(firstRead.next_retry_at), 'First failure did not schedule next_retry_at')

    await input.serviceClient.from('processing_jobs').update({ status: 'queued' }).eq('id', firstRead.id)
    await processQueuedOcrJobs(input.serviceClient, testCase.id, { extractDocument: failingExtractor })
    const { data: secondRead, error: secondError } = await input.serviceClient
      .from('processing_jobs')
      .select('status, attempt_count, next_retry_at')
      .eq('id', firstRead.id)
      .single()
    if (secondError) throw new Error(secondError.message)

    assertCondition(secondRead.status === 'retrying', `Expected retrying, got ${secondRead.status}`)
    assertCondition(secondRead.attempt_count === 2, 'Second failure did not increment attempt_count')
    assertCondition(Boolean(secondRead.next_retry_at), 'Second failure did not schedule next_retry_at')
  } finally {
    await cleanupCase(input.serviceClient, testCase.id)
  }
}

async function checkpointIdempotentOcr(input: { serviceClient: DbClient; patient: TestUser }): Promise<void> {
  const testCase = await createTestCase(input.serviceClient, input.patient.id, 'idempotent')
  try {
    const document = await createDocument({
      serviceClient: input.serviceClient,
      caseId: testCase.id,
      docType: 'hospital_bill',
    })
    await queueOcrJob({ serviceClient: input.serviceClient, caseId: testCase.id, documentId: document.id, label: 'first' })
    let extractorCalls = 0
    const extractor = (): Promise<ExtractionResult> => {
      extractorCalls += 1
      return fakeSuccessExtractor(billFixtureBlocks())()
    }
    await processQueuedOcrJobs(input.serviceClient, testCase.id, { extractDocument: extractor })
    await queueOcrJob({ serviceClient: input.serviceClient, caseId: testCase.id, documentId: document.id, label: 'second' })
    await processQueuedOcrJobs(input.serviceClient, testCase.id, { extractDocument: extractor })
    assertCondition(extractorCalls === 1, `Expected one extractor call, got ${String(extractorCalls)}`)
  } finally {
    await cleanupCase(input.serviceClient, testCase.id)
  }
}

async function checkpointRulesEngineGate(input: {
  serviceClient: DbClient
  patient: TestUser
}): Promise<string> {
  const testCase = await createTestCase(input.serviceClient, input.patient.id, 'rules')
  const policy = await createDocument({ serviceClient: input.serviceClient, caseId: testCase.id, docType: 'policy' })
  const bill = await createDocument({ serviceClient: input.serviceClient, caseId: testCase.id, docType: 'hospital_bill' })
  const insurer = await createDocument({
    serviceClient: input.serviceClient,
    caseId: testCase.id,
    docType: 'insurer_response',
  })

  await queueOcrJob({ serviceClient: input.serviceClient, caseId: testCase.id, documentId: policy.id, label: 'policy' })
  await queueOcrJob({ serviceClient: input.serviceClient, caseId: testCase.id, documentId: bill.id, label: 'bill' })
  await queueOcrJob({ serviceClient: input.serviceClient, caseId: testCase.id, documentId: insurer.id, label: 'insurer' })

  await processQueuedOcrJobs(input.serviceClient, testCase.id, {
    extractDocument: ({ document }) => {
      if (document.doc_type === 'policy') return fakeSuccessExtractor(policyFixtureBlocks())()
      if (document.doc_type === 'hospital_bill') return fakeSuccessExtractor(billFixtureBlocks())()
      return Promise.resolve({
        status: 'manual_required',
        mode: 'manual_required',
        reason: 'Textract temporarily unavailable.',
        confidence: null,
      })
    },
  })

  const { count: beforeCount, error: beforeError } = await input.serviceClient
    .from('processing_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', testCase.id)
    .eq('job_type', 'rules_engine')
  if (beforeError) throw new Error(beforeError.message)
  assertCondition((beforeCount ?? 0) === 0, 'rules_engine queued before usable extracted_json')

  await completeManualOcrExtraction({
    client: input.serviceClient,
    documentId: insurer.id,
    data: {
      insurer_letter: {
        claim_number: 'CLM-123',
        policy_number: 'POL-456',
        approved_amount_inr: 5000,
        deducted_amount_inr: 1000,
        deductions: [],
        stated_reason_summary: 'Manual reviewer completed extraction.',
      },
    },
  })

  const { count: afterCount, error: afterError } = await input.serviceClient
    .from('processing_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', testCase.id)
    .eq('job_type', 'rules_engine')
    .eq('status', 'queued')
  if (afterError) throw new Error(afterError.message)
  assertCondition((afterCount ?? 0) === 1, 'rules_engine was not queued after manual completion')
  return testCase.id
}

async function checkpointInsurerWrites(input: {
  serviceClient: DbClient
  patient: TestUser
}): Promise<void> {
  const testCase = await createTestCase(input.serviceClient, input.patient.id, 'insurer')
  try {
    const document = await createDocument({
      serviceClient: input.serviceClient,
      caseId: testCase.id,
      docType: 'insurer_response',
    })
    await queueOcrJob({ serviceClient: input.serviceClient, caseId: testCase.id, documentId: document.id, label: 'amounts' })
    await processQueuedOcrJobs(input.serviceClient, testCase.id, {
      extractDocument: fakeSuccessExtractor(insurerFixtureBlocks()),
    })

    const [{ data: caseRead, error: caseError }, { data: outcomeRead, error: outcomeError }] =
      await Promise.all([
        input.serviceClient
          .from('cases')
          .select('original_approved_inr, originally_deducted_inr')
          .eq('id', testCase.id)
          .single(),
        input.serviceClient
          .from('outcomes')
          .select('original_approved_inr, originally_deducted_inr')
          .eq('case_id', testCase.id)
          .single(),
      ])
    if (caseError) throw new Error(caseError.message)
    if (outcomeError) throw new Error(outcomeError.message)
    const { data: jobRead, error: jobError } = await input.serviceClient
      .from('processing_jobs')
      .select('status, error_message')
      .eq('case_id', testCase.id)
      .eq('job_type', 'ocr')
      .single()
    if (jobError) throw new Error(jobError.message)
    assertCondition(caseRead.original_approved_inr === 5000, 'cases approved amount not written')
    assertCondition(caseRead.originally_deducted_inr === 1000, 'cases deducted amount not written')
    assertCondition(
      outcomeRead.original_approved_inr === 5000,
      `outcomes approved amount not written, got ${String(outcomeRead.original_approved_inr)}; job ${jobRead.status}: ${jobRead.error_message ?? 'no error'}`
    )
    assertCondition(outcomeRead.originally_deducted_inr === 1000, 'outcomes deducted amount not written')
  } finally {
    await cleanupCase(input.serviceClient, testCase.id)
  }
}

async function runCheckpoint(
  name: CheckpointName,
  results: Partial<Record<CheckpointName, CheckpointResult>>,
  check: () => void | Promise<void>
): Promise<void> {
  try {
    await check()
    results[name] = { pass: true }
  } catch (error) {
    results[name] = { pass: false, detail: errorMessage(error) }
  }
}

function printReport(results: Partial<Record<CheckpointName, CheckpointResult>>): number {
  console.log('\nMODULE 4 CHECKPOINT REPORT')
  console.log('==========================')
  for (const checkpoint of CHECKPOINTS) {
    const result = results[checkpoint] ?? { pass: false, detail: 'Checkpoint did not run' }
    console.log(
      `${result.pass ? 'PASS' : 'FAIL'} ${checkpoint}${result.detail ? ` - ${result.detail}` : ''}`
    )
  }

  const passed = CHECKPOINTS.filter((checkpoint) => results[checkpoint]?.pass === true).length
  console.log(`\n${String(passed)}/${String(CHECKPOINTS.length)} checks passed`)
  console.log(passed === CHECKPOINTS.length ? 'PASS - proceed to review' : 'FAIL - fix before review')
  return passed === CHECKPOINTS.length ? 0 : 1
}

async function main(): Promise<void> {
  loadRootEnv()
  const serviceClient = makeServiceClient()
  const patient = await createTestUser(serviceClient, 'patient')
  const admin = await createTestUser(serviceClient, 'admin', 'admin')
  const results: Partial<Record<CheckpointName, CheckpointResult>> = {}
  const cleanupState: { rulesCaseId?: string } = {}

  try {
    await runCheckpoint('env_presence', results, checkpointEnvPresence)
    await runCheckpoint('s3_staging_put_get_delete', results, checkpointS3Staging)
    await runCheckpoint('extraction_mode_routing', results, checkpointExtractionModeRouting)
    await runCheckpoint('normalizers', results, checkpointNormalizers)
    await runCheckpoint('manual_required_fallback', results, () =>
      checkpointManualFallback({ serviceClient, patient })
    )
    await runCheckpoint('manual_fallback_not_fake_success', results, () =>
      checkpointManualFallback({ serviceClient, patient })
    )
    await runCheckpoint('failed_ocr_retries', results, () =>
      checkpointFailedOcrRetries({ serviceClient, patient })
    )
    await runCheckpoint('no_raw_ocr_persistence', results, () =>
      checkpointNoRawOcr({ serviceClient, patient })
    )
    await runCheckpoint('idempotent_ocr_job_handling', results, () =>
      checkpointIdempotentOcr({ serviceClient, patient })
    )
    await runCheckpoint('rules_engine_only_after_usable_extracted_json', results, async () => {
      cleanupState.rulesCaseId = await checkpointRulesEngineGate({ serviceClient, patient })
    })
    await runCheckpoint('manual_completion_normalized_shape', results, async () => {
      if (!cleanupState.rulesCaseId) {
        throw new Error('Rules gate checkpoint did not create completion case')
      }
      const { data, error } = await serviceClient
        .from('documents')
        .select('extracted_json')
        .eq('case_id', cleanupState.rulesCaseId)
        .eq('doc_type', 'insurer_response')
        .single()
      if (error) throw new Error(error.message)
      assertCondition(
        isRecord(data.extracted_json) && data.extracted_json.extraction_source === 'manual',
        'Manual completion did not use normalized manual extraction shape'
      )
    })
    await runCheckpoint('insurer_amounts_written', results, () =>
      checkpointInsurerWrites({ serviceClient, patient })
    )
  } finally {
    if (cleanupState.rulesCaseId) await cleanupCase(serviceClient, cleanupState.rulesCaseId)
    await cleanupUser(serviceClient, patient)
    await cleanupUser(serviceClient, admin)
  }

  process.exit(printReport(results))
}

main().catch((error: unknown) => {
  console.error('Module 4 checkpoint runner crashed:', error)
  process.exit(1)
})
