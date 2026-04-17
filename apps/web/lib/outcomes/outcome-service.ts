/**
 * @file outcome-service.ts
 * @module web/lib/outcomes
 *
 * Module 9 outcome mutation helpers shared by API routes and checkpoint tests.
 *
 * DEPENDENCIES:
 *   - @claimclarity/db (service-role outcome token helpers)
 *   - @claimclarity/shared/constants (high-value threshold)
 *   - /apps/web/lib/errors.ts
 *   - /apps/web/lib/validation/outcome.schemas.ts
 *
 * CALLED BY:
 *   - /apps/web/app/api/outcomes/[caseId]/route.ts
 *   - /apps/web/app/api/outcomes/quick-update/route.ts
 *   - /apps/web/tests/module9.test.ts
 *
 * CALLS:
 *   - Supabase cases, outcomes, outcome_tokens, follow_up_schedule, audit_log
 */

import { type DbClient, type Json } from '@claimclarity/db'
import {
  consumeOutcomeToken,
  inspectOutcomeToken,
  type OutcomeTokenType,
} from '@claimclarity/db/outcome-tokens'
import { HIGH_VALUE_CLAIM_INR } from '@claimclarity/shared/constants'

import { AuthorizationError, ExternalServiceError, NotFoundError } from '../errors'
import type {
  FullOutcomeSubmissionInput,
  OutcomeType,
  PatientActionType,
  QuickOutcomeAction,
} from '../validation/outcome.schemas'

export type OutcomeCase = {
  id: string
  case_ref: string
  patient_id: string
  status: string
  claim_amount_inr: number | null
  original_approved_inr: number | null
  originally_deducted_inr: number | null
}

export type OutcomeMutation = {
  appeal_submitted?: boolean | null
  appeal_submitted_at?: string | null
  insurer_responded?: boolean | null
  insurer_responded_at?: string | null
  final_settled_amount_inr?: number | null
  original_approved_inr?: number | null
  originally_deducted_inr?: number | null
  outcome_type?: OutcomeType | null
  patient_action_type?: PatientActionType
  report_used_in_appeal?: boolean | null
  evidence_type?: 'self_reported' | 'document_verified'
  evidence_storage_path?: string | null
  user_satisfaction?: number | null
  user_comment?: string | null
  needs_manual_followup?: boolean
  manual_followup_reason?: string | null
  collected_via?:
    | 'email_survey_30d'
    | 'email_survey_60d'
    | 'email_survey_90d'
    | 'manual_call'
    | 'admin_entry'
    | null
  collected_at?: string
  last_updated_at: string
}

export type SubmitOutcomeResult = {
  caseId: string
  outcomeType: OutcomeType | null
  patientActionType: PatientActionType
  evidenceType: 'self_reported' | 'document_verified'
}

type SubmitCommonInput = {
  caseId: string
  serviceClient: DbClient
  patientId?: string | null
  token?: string | undefined
  ipAddress?: string | null
  now?: Date
}

function toJson(value: unknown): Json {
  return value as Json
}

function isFinalOutcome(outcomeType: OutcomeType | null | undefined): boolean {
  return (
    outcomeType === 'not_applicable' ||
    outcomeType === 'no_change' ||
    outcomeType === 'partial_reversal' ||
    outcomeType === 'full_reversal'
  )
}

function safeErrorMessage(error: { message: string } | null): string | null {
  return error ? error.message : null
}

async function loadOutcomeCase(client: DbClient, caseId: string): Promise<OutcomeCase> {
  const { data, error } = await client
    .from('cases')
    .select(
      'id, case_ref, patient_id, status, claim_amount_inr, original_approved_inr, originally_deducted_inr'
    )
    .eq('id', caseId)
    .maybeSingle()

  if (error) throw new ExternalServiceError('Supabase', error.message, { caseId })
  if (!data) throw new NotFoundError('case', caseId)

  return data as OutcomeCase
}

async function assertReportDelivered(client: DbClient, caseId: string): Promise<void> {
  const { data, error } = await client
    .from('reports')
    .select('delivered_at')
    .eq('case_id', caseId)
    .maybeSingle()

  if (error) throw new ExternalServiceError('Supabase', error.message, { caseId })
  if (!data?.delivered_at) throw new AuthorizationError('Outcome updates require delivered report')
}

async function validateTokenAuthorization(input: {
  serviceClient: DbClient
  caseId: string
  token: string
  tokenType: OutcomeTokenType
  now: Date
}): Promise<void> {
  const inspected = await inspectOutcomeToken(input.token, input.serviceClient, input.now)

  if (
    !inspected ||
    inspected.caseId !== input.caseId ||
    inspected.tokenType !== input.tokenType
  ) {
    await input.serviceClient.from('audit_log').insert({
      actor_role: 'system',
      action: 'outcome_token_rejected',
      entity_type: 'case',
      entity_id: input.caseId,
      metadata: toJson({
        token_type: input.tokenType,
        reason: 'invalid_expired_used_or_wrong_case',
      }),
    })
    throw new AuthorizationError('Invalid or expired outcome link')
  }
}

async function authorizeOutcomeMutation(input: SubmitCommonInput & { tokenType: OutcomeTokenType }) {
  const now = input.now ?? new Date()
  const caseRow = await loadOutcomeCase(input.serviceClient, input.caseId)

  if (input.token) {
    await validateTokenAuthorization({
      serviceClient: input.serviceClient,
      caseId: input.caseId,
      token: input.token,
      tokenType: input.tokenType,
      now,
    })
    return { caseRow, actorRole: 'patient_token' as const }
  }

  if (!input.patientId || caseRow.patient_id !== input.patientId) {
    throw new AuthorizationError('Authentication required for outcome update')
  }

  return { caseRow, actorRole: 'patient' as const }
}

function outcomeTypeFromFinancials(input: {
  requestedType?: OutcomeType | undefined
  finalSettledAmountInr?: number | undefined
  originalApprovedInr: number | null
  originallyDeductedInr: number | null
}): OutcomeType {
  if (input.requestedType) {
    if (
      input.requestedType === 'partial_reversal' &&
      input.finalSettledAmountInr !== undefined &&
      input.originalApprovedInr !== null &&
      input.originallyDeductedInr !== null &&
      input.finalSettledAmountInr >= input.originalApprovedInr + input.originallyDeductedInr
    ) {
      return 'full_reversal'
    }
    return input.requestedType
  }

  if (input.finalSettledAmountInr === undefined || input.originalApprovedInr === null) {
    return 'partial_reversal'
  }

  if (input.finalSettledAmountInr <= input.originalApprovedInr) {
    return 'no_change'
  }

  if (
    input.originallyDeductedInr !== null &&
    input.finalSettledAmountInr >= input.originalApprovedInr + input.originallyDeductedInr
  ) {
    return 'full_reversal'
  }

  return 'partial_reversal'
}

/**
 * Converts a one-click POST action into the intended outcome patch.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes
 *
 * @param action - Submitted action from the POST body
 * @param now - Mutation timestamp
 * @returns Partial outcome mutation
 */
export function buildQuickOutcomeMutation(action: QuickOutcomeAction, now: Date): OutcomeMutation {
  const timestamp = now.toISOString()
  const base = {
    collected_at: timestamp,
    last_updated_at: timestamp,
  }

  if (action === 'submitted_appeal') {
    return {
      ...base,
      appeal_submitted: true,
      appeal_submitted_at: timestamp,
      patient_action_type: 'submitted_appeal',
      outcome_type: 'pending',
    }
  }

  if (action === 'not_yet') {
    return {
      ...base,
      appeal_submitted: false,
      patient_action_type: 'none',
      outcome_type: 'pending',
    }
  }

  if (action === 'no_appeal' || action === 'moved_on') {
    return {
      ...base,
      appeal_submitted: false,
      patient_action_type: 'closed_no_benefit',
      outcome_type: 'not_applicable',
    }
  }

  if (action === 'waiting') {
    return {
      ...base,
      insurer_responded: false,
      patient_action_type: 'waiting_response',
      outcome_type: 'pending',
    }
  }

  if (action === 'rejected' || action === 'no_change') {
    return {
      ...base,
      insurer_responded: true,
      insurer_responded_at: timestamp,
      outcome_type: 'no_change',
    }
  }

  return {
    ...base,
    insurer_responded: true,
    insurer_responded_at: timestamp,
    outcome_type: 'partial_reversal',
  }
}

/**
 * Converts full form data into a DB-safe outcome mutation.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes
 *
 * @param input - Full outcome form input and case context
 * @param caseRow - Case row used for original amounts and high-value follow-up
 * @param now - Mutation timestamp
 * @returns Outcome mutation that never sets reversal_amount_inr manually
 */
export function buildFullOutcomeMutation(
  input: FullOutcomeSubmissionInput,
  caseRow: OutcomeCase,
  now: Date
): OutcomeMutation {
  const timestamp = now.toISOString()
  const evidenceType = input.evidenceStoragePath ? 'document_verified' : 'self_reported'
  const patientActionType =
    input.patientActionType ??
    (input.appealSubmitted
      ? input.insurerResponded === false
        ? 'waiting_response'
        : 'submitted_appeal'
      : 'none')
  const outcomeType = input.appealSubmitted
    ? input.insurerResponded === false
      ? 'pending'
      : outcomeTypeFromFinancials({
          requestedType: input.outcomeType,
          finalSettledAmountInr: input.finalSettledAmountInr,
          originalApprovedInr: caseRow.original_approved_inr,
          originallyDeductedInr: caseRow.originally_deducted_inr,
        })
    : patientActionType === 'closed_no_benefit'
      ? 'not_applicable'
      : 'pending'
  const needsManualFollowup =
    evidenceType === 'self_reported' && (caseRow.claim_amount_inr ?? 0) > HIGH_VALUE_CLAIM_INR

  return {
    appeal_submitted: input.appealSubmitted,
    appeal_submitted_at: input.appealSubmitted ? timestamp : null,
    insurer_responded: input.insurerResponded ?? null,
    insurer_responded_at: input.insurerResponded ? timestamp : null,
    final_settled_amount_inr: input.finalSettledAmountInr ?? null,
    original_approved_inr: caseRow.original_approved_inr,
    originally_deducted_inr: caseRow.originally_deducted_inr,
    outcome_type: outcomeType,
    patient_action_type: patientActionType,
    report_used_in_appeal: input.reportUsedInAppeal ?? input.appealSubmitted,
    evidence_type: evidenceType,
    evidence_storage_path: input.evidenceStoragePath ?? null,
    user_satisfaction: input.userSatisfaction,
    user_comment: input.userComment ?? null,
    needs_manual_followup: needsManualFollowup,
    manual_followup_reason: needsManualFollowup ? 'high_value_self_reported' : null,
    collected_via: input.collectedVia ?? null,
    collected_at: timestamp,
    last_updated_at: timestamp,
  }
}

async function upsertOutcome(input: {
  serviceClient: DbClient
  caseId: string
  patch: OutcomeMutation
}): Promise<void> {
  const { error } = await input.serviceClient.from('outcomes').upsert(
    {
      case_id: input.caseId,
      ...input.patch,
    },
    { onConflict: 'case_id' }
  )

  if (error) throw new ExternalServiceError('Supabase', error.message, { caseId: input.caseId })
}

async function markFollowUpsResponded(client: DbClient, caseId: string): Promise<void> {
  const { error } = await client
    .from('follow_up_schedule')
    .update({ response_received: true })
    .eq('case_id', caseId)

  if (error) throw new ExternalServiceError('Supabase', error.message, { caseId })
}

async function insertOutcomeAudit(input: {
  serviceClient: DbClient
  action: string
  caseId: string
  actorRole: string
  actorId?: string | null
  ipAddress?: string | null
  metadata: Json
}): Promise<void> {
  const { error } = await input.serviceClient.from('audit_log').insert({
    actor_id: input.actorId ?? null,
    actor_role: input.actorRole,
    action: input.action,
    entity_type: 'case',
    entity_id: input.caseId,
    ip_address: input.ipAddress ?? null,
    metadata: input.metadata,
  })

  if (error) throw new ExternalServiceError('Supabase', error.message, { caseId: input.caseId })
}

async function consumeTokenAfterMutation(input: {
  token?: string | undefined
  serviceClient: DbClient
  tokenType: OutcomeTokenType
  now: Date
}): Promise<void> {
  if (!input.token) return

  const consumed = await consumeOutcomeToken(input.token, input.serviceClient, input.tokenType, input.now)
  if (!consumed) {
    throw new AuthorizationError('Outcome link was already used')
  }
}

/**
 * Submits the full Module 9 outcome form.
 *
 * SIDE EFFECTS: upserts outcomes, marks follow-ups responded, consumes token after success,
 * and writes audit_log
 * THROWS: AuthorizationError, NotFoundError, ExternalServiceError
 * IDEMPOTENT: no, updates collected_at and consumes tokens
 *
 * @param input - Authorized case, form body, and service dependencies
 * @returns Outcome summary for patient confirmation
 */
export async function submitFullOutcome(input: SubmitCommonInput & {
  body: FullOutcomeSubmissionInput
}): Promise<SubmitOutcomeResult> {
  const now = input.now ?? new Date()
  const authorization = await authorizeOutcomeMutation({
    ...input,
    token: input.body.token ?? input.token,
    tokenType: 'full_outcome',
    now,
  })
  await assertReportDelivered(input.serviceClient, input.caseId)

  const patch = buildFullOutcomeMutation(input.body, authorization.caseRow, now)
  await upsertOutcome({ serviceClient: input.serviceClient, caseId: input.caseId, patch })
  await markFollowUpsResponded(input.serviceClient, input.caseId)
  await consumeTokenAfterMutation({
    token: input.body.token ?? input.token,
    serviceClient: input.serviceClient,
    tokenType: 'full_outcome',
    now,
  })

  await insertOutcomeAudit({
    serviceClient: input.serviceClient,
    action: 'outcome_submitted',
    caseId: input.caseId,
    actorRole: authorization.actorRole,
    actorId: input.patientId ?? null,
    ipAddress: input.ipAddress ?? null,
    metadata: toJson({
      evidence_type: patch.evidence_type,
      outcome_type: patch.outcome_type,
      patient_action_type: patch.patient_action_type,
      needs_manual_followup: patch.needs_manual_followup,
      final_state: isFinalOutcome(patch.outcome_type),
    }),
  })

  return {
    caseId: input.caseId,
    outcomeType: patch.outcome_type ?? null,
    patientActionType: patch.patient_action_type ?? 'none',
    evidenceType: patch.evidence_type ?? 'self_reported',
  }
}

/**
 * Submits a one-click outcome update from an email confirmation page.
 *
 * SIDE EFFECTS: upserts outcomes, marks follow-ups responded, consumes token after success,
 * and writes audit_log
 * THROWS: AuthorizationError, NotFoundError, ExternalServiceError
 * IDEMPOTENT: no, tokens are single-use
 *
 * @param input - Quick-update body and service dependencies
 * @returns Outcome summary for thank-you response
 */
export async function submitQuickOutcome(input: SubmitCommonInput & {
  action: QuickOutcomeAction
}): Promise<SubmitOutcomeResult> {
  const now = input.now ?? new Date()
  const authorization = await authorizeOutcomeMutation({
    ...input,
    tokenType: 'quick_update',
    now,
  })
  await assertReportDelivered(input.serviceClient, input.caseId)

  const patch = buildQuickOutcomeMutation(input.action, now)
  await upsertOutcome({ serviceClient: input.serviceClient, caseId: input.caseId, patch })
  await markFollowUpsResponded(input.serviceClient, input.caseId)
  await consumeTokenAfterMutation({
    token: input.token,
    serviceClient: input.serviceClient,
    tokenType: 'quick_update',
    now,
  })

  await insertOutcomeAudit({
    serviceClient: input.serviceClient,
    action: 'outcome_quick_update_submitted',
    caseId: input.caseId,
    actorRole: authorization.actorRole,
    actorId: input.patientId ?? null,
    ipAddress: input.ipAddress ?? null,
    metadata: toJson({
      action: input.action,
      outcome_type: patch.outcome_type,
      patient_action_type: patch.patient_action_type ?? null,
      db_error: safeErrorMessage(null),
    }),
  })

  return {
    caseId: input.caseId,
    outcomeType: patch.outcome_type ?? null,
    patientActionType: patch.patient_action_type ?? 'none',
    evidenceType: patch.evidence_type ?? 'self_reported',
  }
}
