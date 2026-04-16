/**
 * @file aiDraftJob.ts
 * @module processor/jobs
 *
 * Module 6 AI explanation and appeal drafting queue job.
 *
 * DEPENDENCIES:
 *   - @claimclarity/db
 *   - @claimclarity/shared/constants
 *   - /apps/processor/src/aiDraft/*.ts
 *
 * CALLED BY:
 *   - /apps/processor/tests/module6.test.ts
 *   - future processor job runner
 *
 * CALLS:
 *   - OpenAI Responses API through provider-neutral client
 *   - Supabase cases, findings, reviewer_notifications, audit_log, processing_jobs tables
 */

import { createServiceClient, type DbClient, type Json } from '@claimclarity/db'
import {
  AI_DRAFT_PROMPT_VERSION,
  AI_DRAFT_SCHEMA_VERSION,
  OPENAI_AI_DRAFT_DEFAULT_MODEL,
} from '@claimclarity/shared/constants'

import { buildDeterministicFallback, estimateDraftOutputTokens } from '../aiDraft/fallback'
import { OpenAiResponsesDraftClient, type AiDraftProviderClient } from '../aiDraft/openai-client'
import {
  buildAiDraftPrompt,
  type AiDraftPromptFinding,
  type AiDraftPromptInput,
  type AiDraftPromptInsurerReason,
} from '../aiDraft/prompt-builder'
import {
  resolveAiDraftProviderConfig,
  type AiDraftProviderConfig,
} from '../aiDraft/provider-config'
import {
  type AiDraftFallbackReason,
  type AiDraftProviderMetadata,
  type AiDraftResponse,
  type StoredAiDraft,
} from '../aiDraft/schema'
import { validateAiDraftSemantics } from '../aiDraft/semantic-validator'

type CaseForAiDraft = AiDraftPromptInput['caseRow'] & {
  assigned_reviewer_id: string | null
}

type DocumentForAiDraft = {
  doc_type: string
  extracted_json: Json | null
}

type ProviderAttemptOutcome =
  | {
      ok: true
      draft: AiDraftResponse
      model: string
      inputTokens: number
      outputTokens: number
    }
  | {
      ok: false
      reason: AiDraftFallbackReason
      model: string
      inputTokens: number
      outputTokens: number
      detail: string
    }

type RunAiDraftResult = {
  usedFallback: boolean
  fallbackReason: AiDraftFallbackReason | null
  model: string
  inputTokens: number
  outputTokens: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toJson(value: unknown): Json {
  return value as Json
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

function classifyProviderError(error: unknown): { reason: AiDraftFallbackReason; detail: string } {
  const detail = error instanceof Error ? error.message : String(error)
  if (detail.startsWith('api_failure')) return { reason: 'api_failure', detail }
  if (detail.startsWith('invalid_json')) return { reason: 'invalid_json', detail }
  return { reason: 'schema_failure', detail }
}

function extractionData(document: DocumentForAiDraft): Record<string, unknown> | null {
  if (!isRecord(document.extracted_json)) return null
  const data = document.extracted_json.data
  return document.extracted_json.schema_version === 'module4.v1' && isRecord(data) ? data : null
}

function asInsurerReason(value: unknown): AiDraftPromptInsurerReason | null {
  if (!isRecord(value)) return null
  if (typeof value.item_description !== 'string' || typeof value.stated_reason !== 'string') {
    return null
  }

  return {
    item_description: value.item_description,
    deducted_amount_inr:
      typeof value.deducted_amount_inr === 'number' ? value.deducted_amount_inr : null,
    stated_reason: value.stated_reason,
  }
}

function collectInsurerReasons(documents: DocumentForAiDraft[]): AiDraftPromptInsurerReason[] {
  return documents
    .filter((document) => document.doc_type === 'insurer_response')
    .flatMap((document) => {
      const insurerLetter = extractionData(document)?.insurer_letter
      if (!isRecord(insurerLetter) || !Array.isArray(insurerLetter.deductions)) return []
      return insurerLetter.deductions
        .map(asInsurerReason)
        .filter((reason): reason is AiDraftPromptInsurerReason => reason !== null)
    })
}

function collectTotalBilledPaise(documents: DocumentForAiDraft[]): number | null {
  const amounts: number[] = []
  for (const document of documents) {
    if (document.doc_type !== 'hospital_bill') continue
    const billLines = extractionData(document)?.bill_lines
    if (!Array.isArray(billLines)) continue
    for (const line of billLines) {
      if (isRecord(line) && typeof line.total_inr === 'number') amounts.push(line.total_inr)
    }
  }

  return amounts.length > 0 ? amounts.reduce((sum, amount) => sum + amount, 0) : null
}

function missingDocumentsFromFindings(findings: AiDraftPromptFinding[]): string[] {
  return findings
    .filter((finding) => finding.finding_type === 'missing_document')
    .flatMap((finding) => (finding.bill_line_item ?? '').split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

async function loadPromptInput(client: DbClient, caseId: string): Promise<{
  promptInput: AiDraftPromptInput
  assignedReviewerId: string
}> {
  const [caseResult, findingsResult, documentsResult] = await Promise.all([
    client
      .from('cases')
      .select(
        'id, insurer_name, case_type, claim_amount_inr, original_approved_inr, originally_deducted_inr, assigned_reviewer_id'
      )
      .eq('id', caseId)
      .single(),
    client
      .from('findings')
      .select(
        'id, finding_type, bill_line_item, bill_amount_inr, confidence_label, clause_reference, kb_pattern_id, operative_reason, appeal_strength, appeal_basis'
      )
      .eq('case_id', caseId)
      .order('sort_order', { ascending: true }),
    client.from('documents').select('doc_type, extracted_json').eq('case_id', caseId),
  ])

  if (caseResult.error) throw new Error(caseResult.error.message)
  if (findingsResult.error) throw new Error(findingsResult.error.message)
  if (documentsResult.error) throw new Error(documentsResult.error.message)

  const caseRow = caseResult.data as CaseForAiDraft
  if (!caseRow.assigned_reviewer_id) {
    throw new Error('Module 6 requires assigned_reviewer_id before reviewer notification.')
  }

  const findings = findingsResult.data as AiDraftPromptFinding[]
  if (findings.length === 0) {
    throw new Error('Module 6 requires Module 5 findings before AI drafting.')
  }

  const documents = documentsResult.data as DocumentForAiDraft[]
  return {
    assignedReviewerId: caseRow.assigned_reviewer_id,
    promptInput: {
      caseRow: {
        id: caseRow.id,
        insurer_name: caseRow.insurer_name,
        case_type: caseRow.case_type,
        claim_amount_inr: caseRow.claim_amount_inr,
        original_approved_inr: caseRow.original_approved_inr,
        originally_deducted_inr: caseRow.originally_deducted_inr,
      },
      findings,
      insurerReasons: collectInsurerReasons(documents),
      billSummary: {
        totalBilledPaise: collectTotalBilledPaise(documents),
        originallyApprovedInr: caseRow.original_approved_inr,
        deductedInr: caseRow.originally_deducted_inr,
      },
      missingDocuments: missingDocumentsFromFindings(findings),
    },
  }
}

async function writeAudit(input: {
  client: DbClient
  caseId: string
  action: string
  metadata: AiDraftProviderMetadata & Record<string, Json | undefined>
}): Promise<void> {
  const { error } = await input.client.from('audit_log').insert({
    actor_role: 'processor',
    action: input.action,
    entity_type: 'case',
    entity_id: input.caseId,
    metadata: toJson(input.metadata),
  })
  if (error) throw new Error(error.message)
}

async function persistDraft(input: {
  client: DbClient
  caseId: string
  assignedReviewerId: string
  draft: AiDraftResponse
  metadata: AiDraftProviderMetadata
  usedFallback: boolean
}): Promise<void> {
  for (const finding of input.draft.findings_explained) {
    // Sequential: each finding row receives a different validated explanation.
    const { error } = await input.client
      .from('findings')
      .update({
        plain_language_explanation: finding.plain_language_explanation,
        updated_at: new Date().toISOString(),
      })
      .eq('id', finding.finding_id)
      .eq('case_id', input.caseId)
    if (error) throw new Error(error.message)
  }

  const storedDraft: StoredAiDraft = {
    ...input.draft,
    is_fallback: input.usedFallback,
    fallback_reason: input.metadata.fallback_reason,
    provider_metadata: input.metadata,
  }

  const { error: caseError } = await input.client
    .from('cases')
    .update({
      ai_draft: toJson(storedDraft),
      status: 'ai_draft_ready',
      current_step: 'awaiting_review',
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.caseId)
  if (caseError) throw new Error(caseError.message)

  const message = input.usedFallback
    ? 'AI draft fallback ready for review - reviewer attention required'
    : 'AI draft ready for review'
  const { error: notificationError } = await input.client.from('reviewer_notifications').insert({
    recipient_id: input.assignedReviewerId,
    notification_type: 'new_case_assigned',
    case_id: input.caseId,
    message,
  })
  if (notificationError) throw new Error(notificationError.message)
}

async function attemptProviderDraft(input: {
  client: AiDraftProviderClient
  model: string
  prompt: string
  inputTokens: number
  outputTokenLimit: number
  findings: AiDraftPromptFinding[]
}): Promise<ProviderAttemptOutcome> {
  try {
    const result = await input.client.generateDraft({
      model: input.model,
      prompt: input.prompt,
      inputTokens: input.inputTokens,
      outputTokenLimit: input.outputTokenLimit,
    })
    const validation = validateAiDraftSemantics(result.draft, input.findings)
    if (!validation.ok) {
      return {
        ok: false,
        reason: 'semantic_validation_failure',
        model: input.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        detail: validation.reason,
      }
    }

    return {
      ok: true,
      draft: result.draft,
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    }
  } catch (error) {
    const classified = classifyProviderError(error)
    return {
      ok: false,
      reason: classified.reason,
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: 0,
      detail: classified.detail,
    }
  }
}

async function generateWithProviderOrFallback(input: {
  client: AiDraftProviderClient
  config: AiDraftProviderConfig
  prompt: string
  inputTokens: number
  outputTokenLimit: number
  findings: AiDraftPromptFinding[]
  retryDelayMs: number
}): Promise<{
  draft: AiDraftResponse
  metadata: AiDraftProviderMetadata
  usedFallback: boolean
}> {
  const primary = await attemptProviderDraft({
    client: input.client,
    model: input.config.primaryModel,
    prompt: input.prompt,
    inputTokens: input.inputTokens,
    outputTokenLimit: input.outputTokenLimit,
    findings: input.findings,
  })

  if (primary.ok) {
    return {
      draft: primary.draft,
      usedFallback: false,
      metadata: {
        provider: 'openai',
        model: primary.model,
        input_tokens: primary.inputTokens,
        output_tokens: primary.outputTokens,
        schema_version: AI_DRAFT_SCHEMA_VERSION,
        prompt_version: AI_DRAFT_PROMPT_VERSION,
        fallback_reason: null,
      },
    }
  }

  let finalReason = primary.reason
  let model = primary.model
  let outputTokens = primary.outputTokens

  if (primary.reason === 'api_failure') {
    if (input.retryDelayMs > 0) await sleep(input.retryDelayMs)
    const retry = await attemptProviderDraft({
      client: input.client,
      model: input.config.primaryModel,
      prompt: input.prompt,
      inputTokens: input.inputTokens,
      outputTokenLimit: input.outputTokenLimit,
      findings: input.findings,
    })

    if (retry.ok) {
      return {
        draft: retry.draft,
        usedFallback: false,
        metadata: {
          provider: 'openai',
          model: retry.model,
          input_tokens: retry.inputTokens,
          output_tokens: retry.outputTokens,
          schema_version: AI_DRAFT_SCHEMA_VERSION,
          prompt_version: AI_DRAFT_PROMPT_VERSION,
          fallback_reason: null,
        },
      }
    }

    finalReason = retry.reason
    model = retry.model
    outputTokens = retry.outputTokens

    if (input.config.fallbackModelValidated) {
      const fallbackModelAttempt = await attemptProviderDraft({
        client: input.client,
        model: input.config.fallbackModel,
        prompt: input.prompt,
        inputTokens: input.inputTokens,
        outputTokenLimit: input.outputTokenLimit,
        findings: input.findings,
      })

      if (fallbackModelAttempt.ok) {
        return {
          draft: fallbackModelAttempt.draft,
          usedFallback: false,
          metadata: {
            provider: 'openai',
            model: fallbackModelAttempt.model,
            input_tokens: fallbackModelAttempt.inputTokens,
            output_tokens: fallbackModelAttempt.outputTokens,
            schema_version: AI_DRAFT_SCHEMA_VERSION,
            prompt_version: AI_DRAFT_PROMPT_VERSION,
            fallback_reason: null,
          },
        }
      }

      finalReason = fallbackModelAttempt.reason
      model = fallbackModelAttempt.model
      outputTokens = fallbackModelAttempt.outputTokens
    }
  }

  const deterministicDraft = buildDeterministicFallback(input.findings)
  return {
    draft: deterministicDraft,
    usedFallback: true,
    metadata: {
      provider: 'openai',
      model,
      input_tokens: input.inputTokens,
      output_tokens: outputTokens || estimateDraftOutputTokens(deterministicDraft),
      schema_version: AI_DRAFT_SCHEMA_VERSION,
      prompt_version: AI_DRAFT_PROMPT_VERSION,
      fallback_reason: finalReason,
    },
  }
}

/**
 * Generates and persists Module 6 reviewer-facing AI draft output for one case.
 *
 * SIDE EFFECTS: updates findings/cases, inserts reviewer notification and audit_log
 * THROWS: Error when prerequisites or database writes fail
 * IDEMPOTENT: yes, reruns overwrite the same draft/explanations and add fresh audit rows
 * TOKEN COST: max 3,500 input and 2,000 output
 *
 * @param caseId - Case id with Module 5 findings and current_step=ai_draft
 * @param deps - Optional injected DB/provider/config for tests
 * @returns Provider/fallback metadata summary
 */
export async function runAiDraftGeneration(
  caseId: string,
  deps: {
    client?: DbClient
    providerClient?: AiDraftProviderClient
    providerConfig?: AiDraftProviderConfig
    retryDelayMs?: number
  } = {}
): Promise<RunAiDraftResult> {
  const client = deps.client ?? createServiceClient()
  const providerConfig = deps.providerConfig ?? resolveAiDraftProviderConfig()
  const providerClient =
    deps.providerClient ?? new OpenAiResponsesDraftClient({ apiKey: providerConfig.apiKey })
  const { promptInput, assignedReviewerId } = await loadPromptInput(client, caseId)

  let prompt
  try {
    prompt = buildAiDraftPrompt(promptInput)
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith('token_budget_exceeded')) {
      throw error
    }

    const fallbackDraft = buildDeterministicFallback(promptInput.findings)
    const metadata: AiDraftProviderMetadata = {
      provider: 'openai',
      model: providerConfig.primaryModel,
      input_tokens: 0,
      output_tokens: estimateDraftOutputTokens(fallbackDraft),
      schema_version: AI_DRAFT_SCHEMA_VERSION,
      prompt_version: AI_DRAFT_PROMPT_VERSION,
      fallback_reason: 'token_budget_exceeded',
    }
    await persistDraft({
      client,
      caseId,
      assignedReviewerId,
      draft: fallbackDraft,
      metadata,
      usedFallback: true,
    })
    await writeAudit({
      client,
      caseId,
      action: 'ai_draft_generated',
      metadata: { ...metadata, failure_detail: error.message },
    })
    return {
      usedFallback: true,
      fallbackReason: 'token_budget_exceeded',
      model: providerConfig.primaryModel,
      inputTokens: 0,
      outputTokens: metadata.output_tokens,
    }
  }

  const generated = await generateWithProviderOrFallback({
    client: providerClient,
    config: providerConfig,
    prompt: prompt.prompt,
    inputTokens: prompt.inputTokens,
    outputTokenLimit: prompt.outputTokenLimit,
    findings: promptInput.findings,
    retryDelayMs: deps.retryDelayMs ?? 60_000,
  })

  await persistDraft({
    client,
    caseId,
    assignedReviewerId,
    draft: generated.draft,
    metadata: generated.metadata,
    usedFallback: generated.usedFallback,
  })
  await writeAudit({
    client,
    caseId,
    action: 'ai_draft_generated',
    metadata: generated.metadata,
  })

  return {
    usedFallback: generated.usedFallback,
    fallbackReason: generated.metadata.fallback_reason,
    model: generated.metadata.model,
    inputTokens: generated.metadata.input_tokens,
    outputTokens: generated.metadata.output_tokens,
  }
}

/**
 * Processes queued Module 6 ai_draft_generation jobs.
 *
 * SIDE EFFECTS: updates processing_jobs and runs Module 6 draft generation
 * THROWS: none for per-job failures; failed jobs are marked failed and audited
 * IDEMPOTENT: yes, queued jobs are marked completed once processed
 * TOKEN COST: max 3,500 input and 2,000 output per job
 *
 * @param client - Optional service-role database client
 * @param caseId - Optional case id filter for tests
 * @returns Number of jobs completed
 */
export async function processQueuedAiDraftJobs(
  client: DbClient = createServiceClient(),
  caseId?: string
): Promise<number> {
  let query = client
    .from('processing_jobs')
    .select('id, case_id')
    .eq('job_type', 'ai_draft_generation')
    .eq('status', 'queued')
    .order('queued_at', { ascending: true })

  if (caseId) query = query.eq('case_id', caseId)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  let completed = 0
  for (const job of data) {
    await client
      .from('processing_jobs')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', job.id)

    try {
      const result = await runAiDraftGeneration(job.case_id, { client })
      await client
        .from('processing_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          result: toJson({
            provider: 'openai',
            model: result.model,
            input_tokens: result.inputTokens,
            output_tokens: result.outputTokens,
            fallback_reason: result.fallbackReason,
          }),
        })
        .eq('id', job.id)
      completed += 1
    } catch (caughtError) {
      const detail = caughtError instanceof Error ? caughtError.message : String(caughtError)
      await client
        .from('processing_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: detail,
        })
        .eq('id', job.id)
      await writeAudit({
        client,
        caseId: job.case_id,
        action: 'ai_draft_generation_failed',
        metadata: {
          provider: 'openai',
          model: process.env.OPENAI_AI_DRAFT_MODEL ?? OPENAI_AI_DRAFT_DEFAULT_MODEL,
          input_tokens: 0,
          output_tokens: 0,
          schema_version: AI_DRAFT_SCHEMA_VERSION,
          prompt_version: AI_DRAFT_PROMPT_VERSION,
          fallback_reason: null,
          failure_detail: detail,
        },
      }).catch((auditError: unknown) => {
        console.error('[module6] Failed to audit AI draft failure', auditError)
      })
    }
  }

  return completed
}
