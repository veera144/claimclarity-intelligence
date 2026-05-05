/**
 * @file module5.test.ts
 * @module processor/tests
 *
 * Executable Module 5 rules engine and knowledge-base checkpoints.
 *
 * DEPENDENCIES:
 *   - @claimclarity/db
 *   - /apps/processor/src/knowledgeBase/seed.ts
 *   - /apps/processor/src/rulesEngine/*.ts
 *
 * CALLED BY:
 *   - pnpm test:module5
 *
 * CALLS:
 *   - Supabase public schema tables
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createServiceClient, type DbClient, type Json } from '@claimclarity/db'
import type { Database } from '@claimclarity/db/types'

import { REQUIRED_KB_PATTERNS, seedKnowledgeBase } from '../src/knowledgeBase/seed'
import { runBenchmark } from '../src/rulesEngine/benchmark'
import { clearRulesPatternCache, runRulesEngine } from '../src/rulesEngine/engine'

type CheckpointName =
  | 'seed_patterns_16'
  | 'unverified_pattern_cap'
  | 'verified_policy_chunk_clause_match'
  | 'unseeded_item_insufficient_information'
  | 'missing_document_finding'
  | 'confidence_overall_high_mixed_low'
  | 'idempotent_rerun'
  | 'benchmark_match_rate'
  | 'no_raw_ocr_consumed'
  | 'money_unit_correctness'
  | 'ai_draft_generation_after_gate'
  | 'no_ai_draft_ready_status'

type CheckpointResult = { pass: boolean; detail?: string }
type TestUser = { id: string; email: string }
type CaseInsertWithPaymentMode = Database['public']['Tables']['cases']['Insert'] & {
  payment_mode: 'test_simulated'
  payment_reporting_category: 'test'
}

const CHECKPOINTS: readonly CheckpointName[] = [
  'seed_patterns_16',
  'unverified_pattern_cap',
  'verified_policy_chunk_clause_match',
  'unseeded_item_insufficient_information',
  'missing_document_finding',
  'confidence_overall_high_mixed_low',
  'idempotent_rerun',
  'benchmark_match_rate',
  'no_raw_ocr_consumed',
  'money_unit_correctness',
  'ai_draft_generation_after_gate',
  'no_ai_draft_ready_status',
]

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const TEST_PASSWORD = 'Module5-test-password-12345'
const REQUIRED_CATEGORIES = REQUIRED_KB_PATTERNS.map((pattern) => pattern.clause_category)

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

function toJson(value: unknown): Json {
  return value as Json
}

function normalizedExtraction(docType: string, data: Record<string, unknown>): Json {
  return toJson({
    schema_version: 'module4.v1',
    extraction_source: 'manual',
    doc_type: docType,
    confidence: null,
    has_tables: false,
    has_handwriting: false,
    data,
  })
}

function billExtraction(input: {
  lineItem: string
  amountPaise: number
  category: string
}): Json {
  return normalizedExtraction('hospital_bill', {
    bill_lines: [
      {
        line_item: input.lineItem,
        quantity: 1,
        unit_rate_inr: null,
        total_inr: input.amountPaise,
        bill_category: input.category,
        page_number: 1,
      },
    ],
  })
}

function policyExtraction(text: string): Json {
  return normalizedExtraction('policy', {
    policy_chunks: [
      {
        heading: 'ROOM RENT',
        clause_category: 'room_rent',
        text,
        word_count: text.split(/\s+/u).length,
        page_number: 2,
      },
    ],
  })
}

function insurerExtraction(input: { lineItem: string; reason: string }): Json {
  return normalizedExtraction('insurer_response', {
    insurer_letter: {
      claim_number: 'CLM-M5',
      policy_number: 'POL-M5',
      approved_amount_inr: 100000,
      deducted_amount_inr: 10000,
      deductions: [
        {
          item_description: input.lineItem,
          deducted_amount_inr: 1000,
          stated_reason: input.reason,
        },
      ],
      stated_reason_summary: 'Module 5 fixture',
    },
  })
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
  const email = `module5-${label}-${token}@claimclarity.internal`
  const createResult = await serviceClient.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { module: 'module5', test_run: token },
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
  await serviceClient.auth.admin.deleteUser(user.id)
}

async function cleanupSeedRows(serviceClient: DbClient, adminId: string): Promise<void> {
  const { data, error } = await serviceClient
    .from('kb_clause_patterns')
    .select('id')
    .eq('added_by', adminId)
  if (error) throw new Error(error.message)

  const ids = data.map((row) => row.id)
  if (ids.length === 0) return

  await serviceClient.from('kb_change_log').delete().in('pattern_id', ids)
  await serviceClient.from('findings').delete().in('kb_pattern_id', ids)
  await serviceClient.from('kb_clause_patterns').delete().in('id', ids)
}

async function resetSeedVerification(serviceClient: DbClient): Promise<void> {
  const { error } = await serviceClient
    .from('kb_clause_patterns')
    .update({ verified_by_expert: false, verified_by: null, verified_at: null, is_active: true })
    .in('clause_category', REQUIRED_CATEGORIES)
  if (error) throw new Error(error.message)
  clearRulesPatternCache()
}

async function setRoomRentVerified(input: {
  serviceClient: DbClient
  adminId: string
  verified: boolean
}): Promise<void> {
  const { error } = await input.serviceClient
    .from('kb_clause_patterns')
    .update({
      verified_by_expert: input.verified,
      verified_by: input.verified ? input.adminId : null,
      verified_at: input.verified ? new Date().toISOString() : null,
    })
    .eq('clause_category', 'room_rent')
    .is('insurer_name', null)
  if (error) throw new Error(error.message)
  clearRulesPatternCache()
}

async function createTestCase(input: {
  serviceClient: DbClient
  patientId: string
  label: string
}): Promise<string> {
  const caseInsert: CaseInsertWithPaymentMode = {
    patient_id: input.patientId,
    case_ref: `CC-M5-${input.label}-${randomUUID().slice(0, 8)}`,
    status: 'processing',
    current_step: 'rules_engine',
    claim_amount_inr: 125000,
    insurer_name: 'Module 5 Health',
    payment_waived: true,
    payment_waived_reason: 'module5 checkpoint',
    payment_mode: 'test_simulated',
    payment_reporting_category: 'test',
  }
  const { data, error } = await input.serviceClient
    .from('cases')
    .insert(caseInsert)
    .select('id')
    .single()
  if (error) throw new Error(error.message)

  const { error: outcomeError } = await input.serviceClient.from('outcomes').insert({
    case_id: data.id,
    original_approved_inr: 100000,
    originally_deducted_inr: 10000,
  })
  if (outcomeError) throw new Error(outcomeError.message)
  return data.id
}

async function cleanupCase(serviceClient: DbClient, caseId: string): Promise<void> {
  await serviceClient.from('reviewer_notifications').delete().eq('case_id', caseId)
  await serviceClient.from('processing_jobs').delete().eq('case_id', caseId)
  await serviceClient.from('findings').delete().eq('case_id', caseId)
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
  extractedJson?: Json
  extractedText?: string | null
}): Promise<void> {
  const { error } = await input.serviceClient.from('documents').insert({
    case_id: input.caseId,
    doc_type: input.docType,
    is_required: ['policy', 'hospital_bill', 'insurer_response'].includes(input.docType),
    storage_path: `case-documents/${input.caseId}/${input.docType}-${randomUUID()}.json`,
    file_size_bytes: 1024,
    mime_type: 'application/json',
    page_count: 1,
    quality_status: 'pass',
    ocr_status: 'completed',
    extracted_json: input.extractedJson ?? null,
    extracted_text: input.extractedText ?? null,
  })
  if (error) throw new Error(error.message)
}

async function createRulesFixture(input: {
  serviceClient: DbClient
  patientId: string
  label: string
  lineItem?: string
  amountPaise?: number
  category?: string
  policyText?: string
  reason?: string
  includeHelpfulDocs?: boolean
  extractedText?: string | null
}): Promise<string> {
  const lineItem = input.lineItem ?? 'Room Charges'
  const caseId = await createTestCase({
    serviceClient: input.serviceClient,
    patientId: input.patientId,
    label: input.label,
  })
  await createDocument({
    serviceClient: input.serviceClient,
    caseId,
    docType: 'hospital_bill',
    extractedJson: billExtraction({
      lineItem,
      amountPaise: input.amountPaise ?? 500000,
      category: input.category ?? 'room_charges',
    }),
    extractedText: input.extractedText ?? null,
  })
  await createDocument({
    serviceClient: input.serviceClient,
    caseId,
    docType: 'policy',
    extractedJson: policyExtraction(input.policyText ?? 'Room rent is capped by policy wording.'),
  })
  await createDocument({
    serviceClient: input.serviceClient,
    caseId,
    docType: 'insurer_response',
    extractedJson: insurerExtraction({
      lineItem,
      reason: input.reason ?? 'Room rent exceeds sub-limit and room charge cap.',
    }),
  })
  if (input.includeHelpfulDocs) {
    await createDocument({
      serviceClient: input.serviceClient,
      caseId,
      docType: 'discharge_summary',
      extractedJson: normalizedExtraction('discharge_summary', { summary_lines: ['Discharged'] }),
    })
    await createDocument({
      serviceClient: input.serviceClient,
      caseId,
      docType: 'preauth_letter',
      extractedJson: normalizedExtraction('preauth_letter', { summary_lines: ['Preauth'] }),
    })
  }
  return caseId
}

async function firstFinding(input: {
  serviceClient: DbClient
  caseId: string
  lineItem?: string
}): Promise<Database['public']['Tables']['findings']['Row']> {
  let query = input.serviceClient
    .from('findings')
    .select('*')
    .eq('case_id', input.caseId)
    .order('sort_order', { ascending: true })
    .limit(1)

  if (input.lineItem) query = query.eq('bill_line_item', input.lineItem)

  const { data, error } = await query.single()
  if (error) throw new Error(error.message)
  return data
}

async function countFindings(serviceClient: DbClient, caseId: string): Promise<number> {
  const { count, error } = await serviceClient
    .from('findings')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', caseId)
  if (error) throw new Error(error.message)
  return count ?? 0
}

async function countAiDraftJobs(serviceClient: DbClient, caseId: string): Promise<number> {
  const { count, error } = await serviceClient
    .from('processing_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', caseId)
    .eq('job_type', 'ai_draft_generation')
  if (error) throw new Error(error.message)
  return count ?? 0
}

async function checkpointSeedPatterns(serviceClient: DbClient, admin: TestUser): Promise<void> {
  const count = await seedKnowledgeBase({ client: serviceClient, adminUserId: admin.id })
  assertCondition(count === 16, `Expected 16 active patterns, got ${String(count)}`)
}

async function checkpointUnverifiedCap(serviceClient: DbClient, patient: TestUser): Promise<string> {
  await resetSeedVerification(serviceClient)
  const caseId = await createRulesFixture({
    serviceClient,
    patientId: patient.id,
    label: 'unverified',
    policyText: 'ROOM RENT sub-limit appears in this policy chunk.',
  })
  await runRulesEngine(caseId, { client: serviceClient })
  const finding = await firstFinding({ serviceClient, caseId })
  assertCondition(
    finding.confidence_label === 'based_on_typical_policy',
    `Expected based_on_typical_policy, got ${finding.confidence_label}`
  )
  return caseId
}

async function checkpointVerifiedPolicy(
  serviceClient: DbClient,
  patient: TestUser,
  admin: TestUser
): Promise<string> {
  await setRoomRentVerified({ serviceClient, adminId: admin.id, verified: true })
  const caseId = await createRulesFixture({
    serviceClient,
    patientId: patient.id,
    label: 'verified',
    policyText: 'ROOM RENT benefit says room charge is subject to room rent cap.',
    includeHelpfulDocs: true,
  })
  await runRulesEngine(caseId, { client: serviceClient })
  const finding = await firstFinding({ serviceClient, caseId })
  assertCondition(
    finding.confidence_label === 'clause_found_matched',
    `Expected clause_found_matched, got ${finding.confidence_label}`
  )
  assertCondition(Boolean(finding.clause_reference), 'Clause reference missing')
  return caseId
}

async function checkpointUnseeded(serviceClient: DbClient, patient: TestUser): Promise<string> {
  await resetSeedVerification(serviceClient)
  const caseId = await createRulesFixture({
    serviceClient,
    patientId: patient.id,
    label: 'unseeded',
    lineItem: 'Parking charges',
    amountPaise: 250000,
    category: 'miscellaneous',
    policyText: 'General policy wording with no parking clause.',
    reason: 'General deduction without seeded keywords.',
  })
  await runRulesEngine(caseId, { client: serviceClient })
  const finding = await firstFinding({ serviceClient, caseId, lineItem: 'Parking charges' })
  assertCondition(
    finding.confidence_label === 'insufficient_information',
    `Expected insufficient_information, got ${finding.confidence_label}`
  )
  return caseId
}

async function checkpointConfidence(
  serviceClient: DbClient,
  patient: TestUser,
  admin: TestUser
): Promise<string[]> {
  await setRoomRentVerified({ serviceClient, adminId: admin.id, verified: true })
  const highCaseId = await createRulesFixture({
    serviceClient,
    patientId: patient.id,
    label: 'high',
    policyText: 'ROOM RENT clause covers room charge cap.',
    includeHelpfulDocs: true,
  })
  await runRulesEngine(highCaseId, { client: serviceClient })

  await resetSeedVerification(serviceClient)
  const mixedCaseId = await createRulesFixture({
    serviceClient,
    patientId: patient.id,
    label: 'mixed',
    includeHelpfulDocs: true,
  })
  await runRulesEngine(mixedCaseId, { client: serviceClient })
  const lowCaseId = await checkpointUnseeded(serviceClient, patient)

  const { data, error } = await serviceClient
    .from('cases')
    .select('id, confidence_overall')
    .in('id', [highCaseId, mixedCaseId, lowCaseId])
  if (error) throw new Error(error.message)

  const confidenceByCase = new Map(data.map((row) => [row.id, row.confidence_overall]))
  assertCondition(confidenceByCase.get(highCaseId) === 'high', 'High case confidence mismatch')
  assertCondition(confidenceByCase.get(mixedCaseId) === 'mixed', 'Mixed case confidence mismatch')
  assertCondition(confidenceByCase.get(lowCaseId) === 'low', 'Low case confidence mismatch')
  return [highCaseId, mixedCaseId, lowCaseId]
}

async function checkpointIdempotency(serviceClient: DbClient, patient: TestUser): Promise<string> {
  await resetSeedVerification(serviceClient)
  const caseId = await createRulesFixture({ serviceClient, patientId: patient.id, label: 'idempotent' })
  await runRulesEngine(caseId, { client: serviceClient })
  const firstCount = await countFindings(serviceClient, caseId)
  await runRulesEngine(caseId, { client: serviceClient })
  const secondCount = await countFindings(serviceClient, caseId)
  const jobCount = await countAiDraftJobs(serviceClient, caseId)
  assertCondition(firstCount === secondCount, 'Second rules run duplicated findings')
  assertCondition(jobCount === 1, 'Second rules run duplicated ai_draft_generation job')
  return caseId
}

function checkpointBenchmark(): void {
  const report = runBenchmark()
  assertCondition(
    report.matchRate >= 0.7,
    `Expected benchmark >= 0.70, got ${report.matchRate.toFixed(2)}`
  )
}

async function checkpointRawOcr(serviceClient: DbClient, patient: TestUser): Promise<string> {
  await resetSeedVerification(serviceClient)
  const caseId = await createRulesFixture({
    serviceClient,
    patientId: patient.id,
    label: 'raw',
    lineItem: 'Parking charges',
    amountPaise: 250000,
    category: 'miscellaneous',
    policyText: 'No matching seeded clause in structured policy data.',
    reason: 'No seeded keyword appears here.',
    extractedText: 'RAW OCR TEXT ONLY: room rent room charge accommodation bed charges',
  })
  await runRulesEngine(caseId, { client: serviceClient })
  const finding = await firstFinding({ serviceClient, caseId, lineItem: 'Parking charges' })
  assertCondition(
    finding.confidence_label === 'insufficient_information',
    'Rules engine used raw OCR text instead of structured extracted_json'
  )
  return caseId
}

async function checkpointMoneyUnits(serviceClient: DbClient, patient: TestUser): Promise<string> {
  await resetSeedVerification(serviceClient)
  const caseId = await createRulesFixture({
    serviceClient,
    patientId: patient.id,
    label: 'money',
    amountPaise: 250000,
    includeHelpfulDocs: true,
  })
  await runRulesEngine(caseId, { client: serviceClient })
  const [{ data: finding, error: findingError }, { data: caseRow, error: caseError }] =
    await Promise.all([
      serviceClient
        .from('findings')
        .select('bill_amount_inr')
        .eq('case_id', caseId)
        .eq('bill_line_item', 'Room Charges')
        .single(),
      serviceClient.from('cases').select('claim_amount_inr').eq('id', caseId).single(),
    ])
  if (findingError) throw new Error(findingError.message)
  if (caseError) throw new Error(caseError.message)
  assertCondition(finding.bill_amount_inr === 250000, 'Finding bill amount was not preserved as paise')
  assertCondition(caseRow.claim_amount_inr === 125000, 'Case claim amount did not remain whole rupees')
  return caseId
}

async function checkpointAiQueueGate(serviceClient: DbClient, patient: TestUser): Promise<string> {
  await resetSeedVerification(serviceClient)
  const caseId = await createRulesFixture({ serviceClient, patientId: patient.id, label: 'gate' })
  await runRulesEngine(caseId, { client: serviceClient })
  const afterCount = await countAiDraftJobs(serviceClient, caseId)
  assertCondition(afterCount === 1, 'AI draft job was not queued after runtime rules completion')
  return caseId
}

async function checkpointNoAiDraftReady(serviceClient: DbClient, caseIds: string[]): Promise<void> {
  const { data, error } = await serviceClient
    .from('cases')
    .select('id, status, current_step')
    .in('id', caseIds)
  if (error) throw new Error(error.message)

  const badCase = data.find((row) => row.status === 'ai_draft_ready')
  assertCondition(!badCase, `Rules engine set ai_draft_ready for case ${badCase?.id ?? 'unknown'}`)
  assertCondition(
    data.every((row) => row.current_step === 'ai_draft'),
    'Rules engine did not leave completed cases at current_step=ai_draft'
  )
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
  console.log('\nMODULE 5 CHECKPOINT REPORT')
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
  const serviceClient = createServiceClient()
  const patient = await createTestUser(serviceClient, 'patient')
  const admin = await createTestUser(serviceClient, 'admin', 'admin')
  const results: Partial<Record<CheckpointName, CheckpointResult>> = {}
  const createdCaseIds: string[] = []

  try {
    await runCheckpoint('seed_patterns_16', results, () => checkpointSeedPatterns(serviceClient, admin))
    await runCheckpoint('unverified_pattern_cap', results, async () => {
      createdCaseIds.push(await checkpointUnverifiedCap(serviceClient, patient))
    })
    await runCheckpoint('verified_policy_chunk_clause_match', results, async () => {
      createdCaseIds.push(await checkpointVerifiedPolicy(serviceClient, patient, admin))
    })
    await runCheckpoint('unseeded_item_insufficient_information', results, async () => {
      createdCaseIds.push(await checkpointUnseeded(serviceClient, patient))
    })
    await runCheckpoint('missing_document_finding', results, async () => {
      const caseId = await checkpointUnseeded(serviceClient, patient)
      createdCaseIds.push(caseId)
      const { count, error } = await serviceClient
        .from('findings')
        .select('id', { count: 'exact', head: true })
        .eq('case_id', caseId)
        .eq('finding_type', 'missing_document')
      if (error) throw new Error(error.message)
      assertCondition((count ?? 0) >= 1, 'Missing-document finding was not created')
    })
    await runCheckpoint('confidence_overall_high_mixed_low', results, async () => {
      createdCaseIds.push(...(await checkpointConfidence(serviceClient, patient, admin)))
    })
    await runCheckpoint('idempotent_rerun', results, async () => {
      createdCaseIds.push(await checkpointIdempotency(serviceClient, patient))
    })
    await runCheckpoint('benchmark_match_rate', results, checkpointBenchmark)
    await runCheckpoint('no_raw_ocr_consumed', results, async () => {
      createdCaseIds.push(await checkpointRawOcr(serviceClient, patient))
    })
    await runCheckpoint('money_unit_correctness', results, async () => {
      createdCaseIds.push(await checkpointMoneyUnits(serviceClient, patient))
    })
    await runCheckpoint('ai_draft_generation_after_gate', results, async () => {
      createdCaseIds.push(await checkpointAiQueueGate(serviceClient, patient))
    })
    await runCheckpoint('no_ai_draft_ready_status', results, () =>
      checkpointNoAiDraftReady(serviceClient, createdCaseIds)
    )
  } finally {
    for (const caseId of createdCaseIds) await cleanupCase(serviceClient, caseId)
    await cleanupSeedRows(serviceClient, admin.id)
    await cleanupUser(serviceClient, patient)
    await cleanupUser(serviceClient, admin)
  }

  process.exit(printReport(results))
}

main().catch((error: unknown) => {
  console.error('Module 5 checkpoint runner crashed:', error)
  process.exit(1)
})
