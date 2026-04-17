/**
 * @file supabase-store.ts
 * @module dashboard/review
 *
 * Supabase-backed Module 7 review workflow store.
 */

import { createServiceClient, type DbClient, type Json } from '@claimclarity/db'

import type {
  ReviewAuditInput,
  ReviewCase,
  ReviewCaseUpdate,
  ReviewEscalation,
  ReviewEscalationUpdate,
  ReviewFinding,
  ReviewFindingUpdate,
  ReviewNotificationInput,
  ReviewStore,
} from './workflow'

function toJson(value: unknown): Json {
  return value as Json
}

function throwIfDbError(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

function findingSelect(): string {
  return [
    'id',
    'case_id',
    'finding_type',
    'bill_line_item',
    'bill_amount_inr',
    'confidence_label',
    'plain_language_explanation',
    'appeal_strength',
    'appeal_basis',
    'reviewer_confirmed',
    'reviewer_confirmed_by',
    'reviewer_confirmed_at',
    'reviewer_unassessable',
    'reviewer_unassessable_reason',
    'reviewer_unassessable_by',
    'reviewer_unassessable_at',
    'reviewer_edited',
    'sort_order',
  ].join(', ')
}

function escalationSelect(): string {
  return [
    'id',
    'case_id',
    'finding_id',
    'escalation_type',
    'from_reviewer_id',
    'to_expert_id',
    'question_text',
    'priority',
    'status',
    'expert_response',
    'confidence_recommendation',
  ].join(', ')
}

function caseSelect(): string {
  return [
    'id',
    'case_ref',
    'status',
    'assigned_reviewer_id',
    'assigned_expert_id',
    'ai_draft',
    'insurer_name',
    'claim_amount_inr',
    'confidence_overall',
    'sla_deadline',
    'sla_breached',
  ].join(', ')
}

/**
 * Creates a service-role store for Module 7 workflows.
 *
 * SIDE EFFECTS: reads required Supabase service-role environment
 * THROWS: Error when required environment is missing
 * IDEMPOTENT: yes, factory only
 *
 * @param client - Optional Supabase client used by tests
 * @returns ReviewStore backed by Supabase tables
 */
export function createSupabaseReviewStore(client: DbClient = createServiceClient()): ReviewStore {
  return {
    async readCase(caseId: string): Promise<ReviewCase | null> {
      const { data, error } = await client
        .from('cases')
        .select(caseSelect())
        .eq('id', caseId)
        .maybeSingle()
      throwIfDbError(error)
      return data as ReviewCase | null
    },

    async readFinding(findingId: string): Promise<ReviewFinding | null> {
      const { data, error } = await client
        .from('findings')
        .select(findingSelect())
        .eq('id', findingId)
        .maybeSingle()
      throwIfDbError(error)
      return data as ReviewFinding | null
    },

    async listFindings(caseId: string): Promise<ReviewFinding[]> {
      const { data, error } = await client
        .from('findings')
        .select(findingSelect())
        .eq('case_id', caseId)
        .order('sort_order', { ascending: true })
      throwIfDbError(error)
      return data as unknown as ReviewFinding[]
    },

    async listOpenEscalations(caseId: string): Promise<ReviewEscalation[]> {
      const { data, error } = await client
        .from('escalations')
        .select(escalationSelect())
        .eq('case_id', caseId)
        .eq('status', 'open')
      throwIfDbError(error)
      return data as unknown as ReviewEscalation[]
    },

    async readEscalation(escalationId: string): Promise<ReviewEscalation | null> {
      const { data, error } = await client
        .from('escalations')
        .select(escalationSelect())
        .eq('id', escalationId)
        .maybeSingle()
      throwIfDbError(error)
      return data as ReviewEscalation | null
    },

    async reportExists(caseId: string): Promise<boolean> {
      const { data, error } = await client
        .from('reports')
        .select('id')
        .eq('case_id', caseId)
        .maybeSingle()
      throwIfDbError(error)
      return Boolean(data)
    },

    async updateCase(caseId: string, updates: ReviewCaseUpdate): Promise<void> {
      const { error } = await client.from('cases').update(updates).eq('id', caseId)
      throwIfDbError(error)
    },

    async updateFinding(findingId: string, updates: ReviewFindingUpdate): Promise<void> {
      const { error } = await client.from('findings').update(updates).eq('id', findingId)
      throwIfDbError(error)
    },

    async insertEscalation(input): Promise<string> {
      const { data, error } = await client
        .from('escalations')
        .insert({
          case_id: input.caseId,
          finding_id: input.findingId,
          escalation_type: input.escalationType,
          from_reviewer_id: input.fromReviewerId,
          to_expert_id: input.toExpertId,
          question_text: input.questionText,
          priority: input.priority,
        })
        .select('id')
        .single()
      throwIfDbError(error)
      if (!data) throw new Error('Escalation insert returned no id')
      return data.id
    },

    async updateEscalation(
      escalationId: string,
      updates: ReviewEscalationUpdate
    ): Promise<void> {
      const { error } = await client.from('escalations').update(updates).eq('id', escalationId)
      throwIfDbError(error)
    },

    async insertNotification(input: ReviewNotificationInput): Promise<void> {
      const { error } = await client.from('reviewer_notifications').insert({
        recipient_id: input.recipientId,
        notification_type: input.notificationType,
        case_id: input.caseId,
        escalation_id: input.escalationId ?? null,
        message: input.message,
      })
      throwIfDbError(error)
    },

    async insertAudit(input: ReviewAuditInput): Promise<void> {
      const { error } = await client.from('audit_log').insert({
        actor_id: input.actorId,
        actor_role: input.actorRole,
        action: input.action,
        entity_type: input.entityType,
        entity_id: input.entityId,
        metadata: input.metadata ?? null,
      })
      throwIfDbError(error)
    },

    async signOffReport(caseId: string, reviewerId: string, signedOffAt: string): Promise<void> {
      const { error } = await client
        .from('reports')
        .update({ signed_off_by: reviewerId, signed_off_at: signedOffAt })
        .eq('case_id', caseId)
      throwIfDbError(error)
    },

    async queueReportGeneration(caseId: string): Promise<void> {
      const { error } = await client
        .from('processing_jobs')
        .upsert(
          {
            case_id: caseId,
            job_type: 'report_generation',
            status: 'queued',
            idempotency_key: `report_gen:${caseId}`,
            payload: toJson({ source: 'module7_sign_off' }),
          },
          { onConflict: 'idempotency_key', ignoreDuplicates: true }
        )
      throwIfDbError(error)
    },
  }
}
