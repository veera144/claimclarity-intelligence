/**
 * @file module6.test.ts
 * @module processor/tests
 *
 * Executable Module 6 OpenAI AI draft checkpoints with mocked provider calls.
 *
 * DEPENDENCIES:
 *   - @claimclarity/db
 *   - /apps/processor/src/aiDraft/*.ts
 *   - /apps/processor/src/jobs/aiDraftJob.ts
 *
 * CALLED BY:
 *   - pnpm test:module6
 *   - /apps/processor/tests/aiRegression.ts
 *
 * CALLS:
 *   - Supabase public schema tables
 */

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createServiceClient, type DbClient, type Json } from '@claimclarity/db'
import {
  AI_DRAFT_PROMPT_VERSION,
  AI_DRAFT_SCHEMA_VERSION,
  OPENAI_AI_DRAFT_DEFAULT_FALLBACK_MODEL,
  OPENAI_AI_DRAFT_DEFAULT_MODEL,
} from '@claimclarity/shared/constants'

import { buildDeterministicFallback } from '../src/aiDraft/fallback'
import {
  OpenAiResponsesDraftClient,
  type AiDraftProviderClient,
  type AiDraftProviderRequest,
  type AiDraftProviderResult,
} from '../src/aiDraft/openai-client'
import {
  buildAiDraftPrompt,
  type AiDraftPromptFinding,
  type AiDraftPromptInput,
} from '../src/aiDraft/prompt-builder'
import { resolveAiDraftProviderConfig } from '../src/aiDraft/provider-config'
import { parseAiDraftResponse, type AiDraftResponse } from '../src/aiDraft/schema'
import {
  INSUFFICIENT_INFORMATION_EXPLANATION,
  TYPICAL_POLICY_SUFFIX,
  validateAiDraftSemantics,
} from '../src/aiDraft/semantic-validator'
import { runAiDraftGeneration } from '../src/jobs/aiDraftJob'

type CheckpointName =
  | 'openai_api_key_required'
  | 'primary_model_default'
  | 'fallback_model_default'
  | 'no_legacy_non_openai_provider'
  | 'responses_api_strict_schema_request'
  | 'cases_ai_draft_required_keys'
  | 'additional_properties_rejected'
  | 'prompt_excludes_raw_ocr'
  | 'input_token_budget'
  | 'output_token_budget'
  | 'token_budget_fallback'
  | 'full_finding_id_once'
  | 'truncated_finding_id_rejected'
  | 'forbidden_phrase_rejected'
  | 'confidence_wording_rules'
  | 'bima_bharosa_required'
  | 'no_final_claims'
  | 'api_failure_retry_fallback'
  | 'invalid_json_fallback'
  | 'schema_failure_fallback'
  | 'semantic_failure_fallback'
  | 'fallback_flag_saved'
  | 'fallback_notification'
  | 'audit_provider_openai'
  | 'audit_model_token_metadata'
  | 'audit_schema_prompt_fallback'
  | 'status_ai_draft_ready'
  | 'current_step_awaiting_review'
  | 'reviewer_notification_exists'
  | 'patient_report_unavailable'

type CheckpointResult = { pass: boolean; detail?: string }
type TestUser = { id: string; email: string }
type StoredDraft = AiDraftResponse & {
  is_fallback?: boolean
  fallback_reason?: string | null
  provider_metadata?: Record<string, unknown>
}

const CHECKPOINTS: readonly CheckpointName[] = [
  'openai_api_key_required',
  'primary_model_default',
  'fallback_model_default',
  'no_legacy_non_openai_provider',
  'responses_api_strict_schema_request',
  'cases_ai_draft_required_keys',
  'additional_properties_rejected',
  'prompt_excludes_raw_ocr',
  'input_token_budget',
  'output_token_budget',
  'token_budget_fallback',
  'full_finding_id_once',
  'truncated_finding_id_rejected',
  'forbidden_phrase_rejected',
  'confidence_wording_rules',
  'bima_bharosa_required',
  'no_final_claims',
  'api_failure_retry_fallback',
  'invalid_json_fallback',
  'schema_failure_fallback',
  'semantic_failure_fallback',
  'fallback_flag_saved',
  'fallback_notification',
  'audit_provider_openai',
  'audit_model_token_metadata',
  'audit_schema_prompt_fallback',
  'status_ai_draft_ready',
  'current_step_awaiting_review',
  'reviewer_notification_exists',
  'patient_report_unavailable',
]

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const TEST_PASSWORD = 'Module6-test-password-12345'

class MockProviderClient implements AiDraftProviderClient {
  public readonly calls: AiDraftProviderRequest[] = []

  private readonly handlers: Array<
    (request: AiDraftProviderRequest) => AiDraftProviderResult | Promise<AiDraftProviderResult>
  >

  public constructor(
    handlers: Array<
      (request: AiDraftProviderRequest) => AiDraftProviderResult | Promise<AiDraftProviderResult>
    >
  ) {
    this.handlers = handlers
  }

  public async generateDraft(
    request: AiDraftProviderRequest
  ): Promise<AiDraftProviderResult> {
    this.calls.push(request)
    const handler = this.handlers.shift()
    if (!handler) throw new Error('api_failure: mock provider exhausted')
    return handler(request)
  }
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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

async function waitForUserRow(serviceClient: DbClient, userId: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data, error } = await serviceClient
      .from('users')
      .select('id')
      .eq('id', userId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (data) return
    await new Promise<void>((resolvePromise) => {
      setTimeout(resolvePromise, 250)
    })
  }
  throw new Error(`Auth trigger did not create users row for ${userId}`)
}

async function createTestUser(
  serviceClient: DbClient,
  label: string,
  role: 'patient' | 'reviewer'
): Promise<TestUser> {
  const token = randomUUID()
  const email = `module6-${label}-${token}@claimclarity.internal`
  const createResult = await serviceClient.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { module: 'module6', test_run: token },
  })
  if (createResult.error) throw new Error(createResult.error.message)

  const userId = createResult.data.user.id
  await waitForUserRow(serviceClient, userId)
  const { error } = await serviceClient.from('users').update({ role }).eq('id', userId)
  if (error) throw new Error(error.message)
  return { id: userId, email }
}

async function cleanupUser(serviceClient: DbClient, user: TestUser): Promise<void> {
  await serviceClient.auth.admin.deleteUser(user.id)
}

async function createCase(input: {
  serviceClient: DbClient
  patientId: string
  reviewerId: string
  label: string
}): Promise<string> {
  const { data, error } = await input.serviceClient
    .from('cases')
    .insert({
      patient_id: input.patientId,
      assigned_reviewer_id: input.reviewerId,
      case_ref: `CC-M6-${input.label}-${randomUUID().slice(0, 8)}`,
      status: 'processing',
      current_step: 'ai_draft',
      claim_amount_inr: 125000,
      insurer_name: 'Module 6 Health',
      case_type: 'reimbursement',
      original_approved_inr: 100000,
      originally_deducted_inr: 25000,
      payment_waived: true,
      payment_waived_reason: 'module6 checkpoint',
      payment_mode: 'test_simulated',
      payment_reporting_category: 'test',
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
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

async function insertStructuredDocuments(serviceClient: DbClient, caseId: string): Promise<void> {
  const { error } = await serviceClient.from('documents').insert([
    {
      case_id: caseId,
      doc_type: 'hospital_bill',
      storage_path: `case-documents/${caseId}/bill.json`,
      quality_status: 'pass',
      ocr_status: 'completed',
      extracted_json: normalizedExtraction('hospital_bill', {
        bill_lines: [
          {
            line_item: 'Room Charges',
            total_inr: 500000,
            bill_category: 'room_charges',
            page_number: 1,
          },
        ],
      }),
      extracted_text: 'RAW OCR SENTINEL SHOULD NEVER ENTER MODULE 6 PROMPT',
    },
    {
      case_id: caseId,
      doc_type: 'insurer_response',
      storage_path: `case-documents/${caseId}/insurer.json`,
      quality_status: 'pass',
      ocr_status: 'completed',
      extracted_json: normalizedExtraction('insurer_response', {
        insurer_letter: {
          deductions: [
            {
              item_description: 'Room Charges',
              deducted_amount_inr: 25000,
              stated_reason: 'Room rent sub-limit applied',
            },
          ],
        },
      }),
      extracted_text: 'ANOTHER RAW OCR SENTINEL',
    },
  ])
  if (error) throw new Error(error.message)
}

async function insertFindings(
  serviceClient: DbClient,
  caseId: string,
  findings: AiDraftPromptFinding[]
): Promise<void> {
  const { error } = await serviceClient.from('findings').insert(
    findings.map((finding, index) => ({
      id: finding.id,
      case_id: caseId,
      finding_type: finding.finding_type,
      bill_line_item: finding.bill_line_item,
      bill_amount_inr: finding.bill_amount_inr,
      bill_category: 'room_charges',
      clause_reference: finding.clause_reference,
      kb_pattern_id: finding.kb_pattern_id,
      operative_reason: finding.operative_reason,
      confidence_label: finding.confidence_label,
      appeal_strength: finding.appeal_strength,
      appeal_basis: finding.appeal_basis,
      ai_generated: false,
      reviewer_confirmed: false,
      reviewer_edited: false,
      expert_confirmed: false,
      sort_order: index + 1,
    }))
  )
  if (error) throw new Error(error.message)
}

function fixtureFindings(): AiDraftPromptFinding[] {
  return [
    {
      id: randomUUID(),
      finding_type: 'deducted',
      bill_line_item: 'Room Charges',
      bill_amount_inr: 500000,
      confidence_label: 'clause_found_matched',
      clause_reference: 'ROOM RENT p.2',
      kb_pattern_id: null,
      operative_reason: 'Room rent sub-limit appears in the structured policy fields.',
      appeal_strength: 'strong',
      appeal_basis: 'Request the TPA to share the room-rent calculation.',
    },
    {
      id: randomUUID(),
      finding_type: 'deducted',
      bill_line_item: 'Consumables',
      bill_amount_inr: 125000,
      confidence_label: 'based_on_typical_policy',
      clause_reference: null,
      kb_pattern_id: null,
      operative_reason: 'Consumables appear to match a common non-medical expense pattern.',
      appeal_strength: 'moderate',
      appeal_basis: 'Ask for itemized breakup and policy exclusion wording.',
    },
    {
      id: randomUUID(),
      finding_type: 'missing_document',
      bill_line_item: 'discharge_summary',
      bill_amount_inr: null,
      confidence_label: 'insufficient_information',
      clause_reference: null,
      kb_pattern_id: null,
      operative_reason: 'Additional document review is needed.',
      appeal_strength: 'weak',
      appeal_basis: 'Reviewer should request the missing document before final delivery.',
    },
  ]
}

function goodDraft(findings: AiDraftPromptFinding[]): AiDraftResponse {
  return parseAiDraftResponse({
    schema_version: AI_DRAFT_SCHEMA_VERSION,
    prompt_version: AI_DRAFT_PROMPT_VERSION,
    findings_explained: findings.map((finding) => ({
      finding_id: finding.id,
      plain_language_explanation:
        finding.confidence_label === 'insufficient_information'
          ? INSUFFICIENT_INFORMATION_EXPLANATION
          : finding.confidence_label === 'based_on_typical_policy'
            ? `This item appears to match a typical policy pattern from Module 5. ${TYPICAL_POLICY_SUFFIX}`
            : `Clause ${String(finding.clause_reference)} appears relevant to ${String(finding.bill_line_item)}.`,
    })),
    hospital_questions: [
      'Please share the itemized breakup and supporting bill note for Room Charges.',
    ],
    insurer_questions: [
      'Please explain how Clause ROOM RENT p.2 was applied to Room Charges and share the calculation used.',
    ],
    appeal_points: [
      {
        point: 'Ask for the calculation used for room-rent-related deductions.',
        strength: 'strong',
        basis: 'Clause ROOM RENT p.2',
      },
      {
        point: 'Ask for the itemized breakup before reviewer sign-off.',
        strength: 'moderate',
        basis: `KB pattern ${findings[1]?.kb_pattern_id ?? 'unknown'}`,
      },
    ],
    appeal_letter_draft:
      'Please review the listed deductions and share clause wording and calculations. The patient may refer to IRDAI Bima Bharosa at bimabharosa.irdai.gov.in for grievance submission guidance.',
    scope_notes: 'Reviewer-facing draft from Module 5 findings only.',
  })
}

function promptFixture(findings = fixtureFindings()): AiDraftPromptInput {
  return {
    caseRow: {
      id: randomUUID(),
      insurer_name: 'Module 6 Health',
      case_type: 'reimbursement',
      claim_amount_inr: 125000,
      original_approved_inr: 100000,
      originally_deducted_inr: 25000,
    },
    findings,
    insurerReasons: [
      {
        item_description: 'Room Charges',
        deducted_amount_inr: 25000,
        stated_reason: 'Room rent sub-limit applied',
      },
    ],
    billSummary: {
      totalBilledPaise: 500000,
      originallyApprovedInr: 100000,
      deductedInr: 25000,
    },
    missingDocuments: ['discharge_summary'],
  }
}

async function createDraftCase(input: {
  serviceClient: DbClient
  patientId: string
  reviewerId: string
  label: string
  findings?: AiDraftPromptFinding[]
}): Promise<{ caseId: string; findings: AiDraftPromptFinding[] }> {
  const findings = input.findings ?? fixtureFindings()
  const caseId = await createCase({
    serviceClient: input.serviceClient,
    patientId: input.patientId,
    reviewerId: input.reviewerId,
    label: input.label,
  })
  await insertStructuredDocuments(input.serviceClient, caseId)
  await insertFindings(input.serviceClient, caseId, findings)
  return { caseId, findings }
}

async function readCaseDraft(
  serviceClient: DbClient,
  caseId: string
): Promise<StoredDraft> {
  const { data, error } = await serviceClient
    .from('cases')
    .select('ai_draft')
    .eq('id', caseId)
    .single()
  if (error) throw new Error(error.message)
  return data.ai_draft as StoredDraft
}

async function latestAuditMetadata(
  serviceClient: DbClient,
  caseId: string
): Promise<Record<string, unknown>> {
  const { data, error } = await serviceClient
    .from('audit_log')
    .select('metadata')
    .eq('entity_id', caseId)
    .eq('action', 'ai_draft_generated')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  if (error) throw new Error(error.message)
  return isRecord(data.metadata) ? data.metadata : {}
}

function outputJsonForClient(draft: AiDraftResponse): unknown {
  return {
    status: 'completed',
    output_text: JSON.stringify(draft),
    usage: { input_tokens: 900, output_tokens: 500 },
  }
}

function draftPayloadOnly(draft: StoredDraft): AiDraftResponse {
  return {
    schema_version: draft.schema_version,
    prompt_version: draft.prompt_version,
    findings_explained: draft.findings_explained,
    hospital_questions: draft.hospital_questions,
    insurer_questions: draft.insurer_questions,
    appeal_points: draft.appeal_points,
    appeal_letter_draft: draft.appeal_letter_draft,
    scope_notes: draft.scope_notes,
  }
}

async function checkpointOpenAiClientRequest(findings: AiDraftPromptFinding[]): Promise<void> {
  const fetchImpl: typeof fetch = () =>
    Promise.resolve(new Response(JSON.stringify(outputJsonForClient(goodDraft(findings))), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
  const client = new OpenAiResponsesDraftClient({ apiKey: 'test-key', fetchImpl })
  const prompt = buildAiDraftPrompt(promptFixture(findings))
  await client.generateDraft({
    model: OPENAI_AI_DRAFT_DEFAULT_MODEL,
    prompt: prompt.prompt,
    inputTokens: prompt.inputTokens,
    outputTokenLimit: prompt.outputTokenLimit,
  })
  const request = client.lastRequests[0]
  assertCondition(isRecord(request), 'OpenAI request body missing')
  assertCondition(request.model === OPENAI_AI_DRAFT_DEFAULT_MODEL, 'Wrong model in request')
  assertCondition(isRecord(request.text), 'Responses API text format missing')
  assertCondition(isRecord(request.text.format), 'Responses API text.format missing')
  assertCondition(request.text.format.type === 'json_schema', 'JSON schema format missing')
  assertCondition(request.text.format.strict === true, 'Strict Structured Outputs not enabled')
  assertCondition(
    request.text.format.name === 'claimclarity_ai_draft_response',
    'Wrong schema name'
  )
}

async function checkpointValidPersist(input: {
  serviceClient: DbClient
  patientId: string
  reviewerId: string
  createdCaseIds: string[]
}): Promise<string> {
  const { caseId, findings } = await createDraftCase({
    serviceClient: input.serviceClient,
    patientId: input.patientId,
    reviewerId: input.reviewerId,
    label: 'valid',
  })
  input.createdCaseIds.push(caseId)
  const provider = new MockProviderClient([
    (request) => ({
      draft: goodDraft(findings),
      model: request.model,
      inputTokens: request.inputTokens,
      outputTokens: 500,
    }),
  ])
  await runAiDraftGeneration(caseId, {
    client: input.serviceClient,
    providerClient: provider,
    providerConfig: {
      apiKey: 'test-key',
      primaryModel: OPENAI_AI_DRAFT_DEFAULT_MODEL,
      fallbackModel: OPENAI_AI_DRAFT_DEFAULT_FALLBACK_MODEL,
      fallbackModelValidated: false,
    },
    retryDelayMs: 0,
  })
  return caseId
}

async function checkpointFallbackCase(input: {
  serviceClient: DbClient
  patientId: string
  reviewerId: string
  createdCaseIds: string[]
  label: string
  provider: MockProviderClient
  expectedReason: string
}): Promise<string> {
  const { caseId } = await createDraftCase({
    serviceClient: input.serviceClient,
    patientId: input.patientId,
    reviewerId: input.reviewerId,
    label: input.label,
  })
  input.createdCaseIds.push(caseId)
  await runAiDraftGeneration(caseId, {
    client: input.serviceClient,
    providerClient: input.provider,
    providerConfig: {
      apiKey: 'test-key',
      primaryModel: OPENAI_AI_DRAFT_DEFAULT_MODEL,
      fallbackModel: OPENAI_AI_DRAFT_DEFAULT_FALLBACK_MODEL,
      fallbackModelValidated: false,
    },
    retryDelayMs: 0,
  })
  const draft = await readCaseDraft(input.serviceClient, caseId)
  assertCondition(draft.is_fallback === true, 'Fallback flag not set')
  assertCondition(draft.fallback_reason === input.expectedReason, 'Fallback reason mismatch')
  return caseId
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

function printReport(
  title: string,
  results: Partial<Record<CheckpointName, CheckpointResult>>
): number {
  console.log(`\n${title}`)
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

export async function runModule6Checkpoints(title = 'MODULE 6 CHECKPOINT REPORT'): Promise<number> {
  loadRootEnv()
  const serviceClient = createServiceClient()
  const patient = await createTestUser(serviceClient, 'patient', 'patient')
  const reviewer = await createTestUser(serviceClient, 'reviewer', 'reviewer')
  const results: Partial<Record<CheckpointName, CheckpointResult>> = {}
  const createdCaseIds: string[] = []
  let validCaseId: string | null = null
  let fallbackCaseId: string | null = null
  const findings = fixtureFindings()

  try {
    await runCheckpoint('openai_api_key_required', results, () => {
      try {
        resolveAiDraftProviderConfig({
          NODE_ENV: 'development',
          OPENAI_AI_DRAFT_MODEL: OPENAI_AI_DRAFT_DEFAULT_MODEL,
          OPENAI_AI_DRAFT_FALLBACK_MODEL: OPENAI_AI_DRAFT_DEFAULT_FALLBACK_MODEL,
        })
      } catch (error) {
        assertCondition(
          errorMessage(error).includes('OPENAI_API_KEY'),
          'Missing API key did not fail fast'
        )
        return
      }
      throw new Error('Missing OPENAI_API_KEY did not throw')
    })
    await runCheckpoint('primary_model_default', results, () => {
      const config = resolveAiDraftProviderConfig({
        NODE_ENV: 'development',
        OPENAI_API_KEY: 'test-key',
      })
      assertCondition(config.primaryModel === OPENAI_AI_DRAFT_DEFAULT_MODEL, 'Primary default mismatch')
    })
    await runCheckpoint('fallback_model_default', results, () => {
      const config = resolveAiDraftProviderConfig({
        NODE_ENV: 'development',
        OPENAI_API_KEY: 'test-key',
      })
      assertCondition(
        config.fallbackModel === OPENAI_AI_DRAFT_DEFAULT_FALLBACK_MODEL,
        'Fallback default mismatch'
      )
    })
    await runCheckpoint('no_legacy_non_openai_provider', results, () => {
      const moduleFiles = [
        readFileSync(resolve(rootDir, 'apps/processor/src/jobs/aiDraftJob.ts'), 'utf8'),
        readFileSync(resolve(rootDir, 'apps/processor/src/aiDraft/openai-client.ts'), 'utf8'),
        readFileSync(resolve(rootDir, 'packages/shared/src/config.ts'), 'utf8'),
      ].join('\n')
      assertCondition(!/anthropic|claude/iu.test(moduleFiles), 'Legacy non-OpenAI reference found')
    })
    await runCheckpoint('responses_api_strict_schema_request', results, () =>
      checkpointOpenAiClientRequest(findings)
    )
    await runCheckpoint('cases_ai_draft_required_keys', results, async () => {
      validCaseId = await checkpointValidPersist({
        serviceClient,
        patientId: patient.id,
        reviewerId: reviewer.id,
        createdCaseIds,
      })
      const draft = await readCaseDraft(serviceClient, validCaseId)
      parseAiDraftResponse(draftPayloadOnly(draft))
    })
    await runCheckpoint('additional_properties_rejected', results, () => {
      const draft = { ...goodDraft(findings), extra: 'nope' }
      try {
        parseAiDraftResponse(draft)
      } catch {
        return
      }
      throw new Error('Additional property was accepted')
    })
    await runCheckpoint('prompt_excludes_raw_ocr', results, () => {
      const prompt = buildAiDraftPrompt(promptFixture(findings)).prompt
      assertCondition(!prompt.includes('RAW OCR SENTINEL'), 'Prompt leaked raw OCR sentinel')
      try {
        buildAiDraftPrompt({
          ...promptFixture(findings),
          extracted_text: 'RAW OCR SENTINEL',
        } as unknown as AiDraftPromptInput)
      } catch {
        return
      }
      throw new Error('Prompt builder accepted extracted_text')
    })
    await runCheckpoint('input_token_budget', results, () => {
      const prompt = buildAiDraftPrompt(promptFixture(findings))
      assertCondition(prompt.inputTokens <= 3500, 'Input token budget exceeded')
    })
    await runCheckpoint('output_token_budget', results, () => {
      const outputTokens = Math.ceil(JSON.stringify(goodDraft(findings)).length / 4)
      assertCondition(outputTokens <= 2000, 'Mock output token budget exceeded')
    })
    await runCheckpoint('token_budget_fallback', results, () => {
      const largeFindings = Array.from({ length: 250 }, (_, index) => ({
        ...findings[0]!,
        id: randomUUID(),
        operative_reason: `Long reason ${String(index)} ${'x'.repeat(500)}`,
      }))
      try {
        buildAiDraftPrompt(promptFixture(largeFindings))
      } catch (error) {
        assertCondition(errorMessage(error).startsWith('token_budget_exceeded'), 'Wrong failure')
        return
      }
      throw new Error('Oversized prompt did not trip token budget')
    })
    await runCheckpoint('full_finding_id_once', results, () => {
      const validation = validateAiDraftSemantics(goodDraft(findings), findings)
      assertCondition(validation.ok, validation.ok ? 'ok' : validation.reason)
    })
    await runCheckpoint('truncated_finding_id_rejected', results, () => {
      const draft = goodDraft(findings)
      draft.findings_explained[0]!.finding_id = findings[0]!.id.slice(0, 8)
      const validation = validateAiDraftSemantics(draft, findings)
      assertCondition(!validation.ok, 'Truncated finding_id passed')
    })
    await runCheckpoint('forbidden_phrase_rejected', results, () => {
      const draft = goodDraft(findings)
      draft.scope_notes = 'you are entitled to payment'
      const validation = validateAiDraftSemantics(draft, findings)
      assertCondition(!validation.ok, 'Forbidden phrase passed')
    })
    await runCheckpoint('confidence_wording_rules', results, () => {
      const draft = goodDraft(findings)
      const validation = validateAiDraftSemantics(draft, findings)
      assertCondition(validation.ok, validation.ok ? 'ok' : validation.reason)
      draft.findings_explained[1]!.plain_language_explanation =
        'This is based on a typical policy pattern.'
      const failed = validateAiDraftSemantics(draft, findings)
      assertCondition(!failed.ok, 'Bad typical-policy wording passed')
    })
    await runCheckpoint('bima_bharosa_required', results, () => {
      const draft = goodDraft(findings)
      draft.appeal_letter_draft = 'Please review these items.'
      const validation = validateAiDraftSemantics(draft, findings)
      assertCondition(!validation.ok, 'Missing Bima Bharosa URL passed')
    })
    await runCheckpoint('no_final_claims', results, () => {
      const draft = goodDraft(findings)
      draft.scope_notes = 'This claim will be approved.'
      const validation = validateAiDraftSemantics(draft, findings)
      assertCondition(!validation.ok, 'Final claim statement passed')
    })
    await runCheckpoint('api_failure_retry_fallback', results, async () => {
      const provider = new MockProviderClient([
        () => {
          throw new Error('api_failure: first failure')
        },
        () => {
          throw new Error('api_failure: retry failure')
        },
      ])
      fallbackCaseId = await checkpointFallbackCase({
        serviceClient,
        patientId: patient.id,
        reviewerId: reviewer.id,
        createdCaseIds,
        label: 'api',
        provider,
        expectedReason: 'api_failure',
      })
      assertCondition(provider.calls.length === 2, 'API failure did not retry exactly once')
    })
    await runCheckpoint('invalid_json_fallback', results, async () => {
      await checkpointFallbackCase({
        serviceClient,
        patientId: patient.id,
        reviewerId: reviewer.id,
        createdCaseIds,
        label: 'json',
        provider: new MockProviderClient([
          () => {
            throw new Error('invalid_json: broken')
          },
        ]),
        expectedReason: 'invalid_json',
      })
    })
    await runCheckpoint('schema_failure_fallback', results, async () => {
      await checkpointFallbackCase({
        serviceClient,
        patientId: patient.id,
        reviewerId: reviewer.id,
        createdCaseIds,
        label: 'schema',
        provider: new MockProviderClient([
          () => {
            throw new Error('schema mismatch')
          },
        ]),
        expectedReason: 'schema_failure',
      })
    })
    await runCheckpoint('semantic_failure_fallback', results, async () => {
      await checkpointFallbackCase({
        serviceClient,
        patientId: patient.id,
        reviewerId: reviewer.id,
        createdCaseIds,
        label: 'semantic',
        provider: new MockProviderClient([
          (request) => {
            const unsafe = goodDraft(fixtureFindings())
            unsafe.scope_notes = 'you are entitled to payment'
            return {
              draft: unsafe,
              model: request.model,
              inputTokens: request.inputTokens,
              outputTokens: 300,
            }
          },
        ]),
        expectedReason: 'semantic_validation_failure',
      })
    })
    await runCheckpoint('fallback_flag_saved', results, async () => {
      assertCondition(Boolean(fallbackCaseId), 'Fallback case missing')
      const draft = await readCaseDraft(serviceClient, fallbackCaseId!)
      assertCondition(draft.is_fallback === true, 'Fallback flag not saved')
    })
    await runCheckpoint('fallback_notification', results, async () => {
      assertCondition(Boolean(fallbackCaseId), 'Fallback case missing')
      const { data, error } = await serviceClient
        .from('reviewer_notifications')
        .select('message')
        .eq('case_id', fallbackCaseId!)
        .single()
      if (error) throw new Error(error.message)
      assertCondition(data.message.toLowerCase().includes('fallback'), 'Fallback notice missing')
    })
    await runCheckpoint('audit_provider_openai', results, async () => {
      assertCondition(Boolean(validCaseId), 'Valid case missing')
      const metadata = await latestAuditMetadata(serviceClient, validCaseId!)
      assertCondition(metadata.provider === 'openai', 'Audit provider mismatch')
    })
    await runCheckpoint('audit_model_token_metadata', results, async () => {
      assertCondition(Boolean(validCaseId), 'Valid case missing')
      const metadata = await latestAuditMetadata(serviceClient, validCaseId!)
      assertCondition(typeof metadata.model === 'string', 'Audit model missing')
      assertCondition(typeof metadata.input_tokens === 'number', 'Audit input tokens missing')
      assertCondition(typeof metadata.output_tokens === 'number', 'Audit output tokens missing')
    })
    await runCheckpoint('audit_schema_prompt_fallback', results, async () => {
      assertCondition(Boolean(fallbackCaseId), 'Fallback case missing')
      const metadata = await latestAuditMetadata(serviceClient, fallbackCaseId!)
      assertCondition(metadata.schema_version === AI_DRAFT_SCHEMA_VERSION, 'Schema version missing')
      assertCondition(metadata.prompt_version === AI_DRAFT_PROMPT_VERSION, 'Prompt version missing')
      assertCondition(metadata.fallback_reason === 'api_failure', 'Fallback reason missing')
    })
    await runCheckpoint('status_ai_draft_ready', results, async () => {
      assertCondition(Boolean(validCaseId), 'Valid case missing')
      const { data, error } = await serviceClient
        .from('cases')
        .select('status')
        .eq('id', validCaseId!)
        .single()
      if (error) throw new Error(error.message)
      assertCondition(data.status === 'ai_draft_ready', 'Status transition missing')
    })
    await runCheckpoint('current_step_awaiting_review', results, async () => {
      assertCondition(Boolean(validCaseId), 'Valid case missing')
      const { data, error } = await serviceClient
        .from('cases')
        .select('current_step')
        .eq('id', validCaseId!)
        .single()
      if (error) throw new Error(error.message)
      assertCondition(data.current_step === 'awaiting_review', 'Current step transition missing')
    })
    await runCheckpoint('reviewer_notification_exists', results, async () => {
      assertCondition(Boolean(validCaseId), 'Valid case missing')
      const { count, error } = await serviceClient
        .from('reviewer_notifications')
        .select('id', { count: 'exact', head: true })
        .eq('case_id', validCaseId!)
        .eq('notification_type', 'new_case_assigned')
      if (error) throw new Error(error.message)
      assertCondition((count ?? 0) >= 1, 'Reviewer notification missing')
    })
    await runCheckpoint('patient_report_unavailable', results, async () => {
      assertCondition(Boolean(validCaseId), 'Valid case missing')
      const { data, error } = await serviceClient
        .from('reports')
        .select('delivered_at, pdf_storage_path, signed_off_at')
        .eq('case_id', validCaseId!)
      if (error) throw new Error(error.message)
      assertCondition(
        data.length === 0 ||
          data.every(
            (report) =>
              report.delivered_at === null &&
              report.pdf_storage_path === null &&
              report.signed_off_at === null
          ),
        'Patient-facing report became available before reviewer approval'
      )
    })
  } finally {
    for (const caseId of createdCaseIds) await cleanupCase(serviceClient, caseId)
    await cleanupUser(serviceClient, patient)
    await cleanupUser(serviceClient, reviewer)
  }

  const fallbackDraft = buildDeterministicFallback(findings)
  const fallbackValidation = validateAiDraftSemantics(fallbackDraft, findings)
  if (!fallbackValidation.ok && !results.semantic_failure_fallback) {
    results.semantic_failure_fallback = { pass: false, detail: fallbackValidation.reason }
  }

  return printReport(title, results)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runModule6Checkpoints().then((exitCode) => {
    process.exit(exitCode)
  }).catch((error: unknown) => {
    console.error('Module 6 checkpoint runner crashed:', error)
    process.exit(1)
  })
}
