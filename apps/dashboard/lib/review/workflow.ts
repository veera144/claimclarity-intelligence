/**
 * @file workflow.ts
 * @module dashboard/review
 *
 * Module 7 reviewer and expert workflow gates shared by dashboard pages and tests.
 */

import type { Json } from '@claimclarity/db'

export type ReviewRole = 'reviewer' | 'expert' | 'admin'

export type ReviewActor = {
  id: string
  role: ReviewRole
}

export type ReviewCaseStatus =
  | 'consent_pending'
  | 'documents_pending'
  | 'payment_pending'
  | 'processing'
  | 'ai_draft_ready'
  | 'under_review'
  | 'escalated'
  | 'approved'
  | 'generating_report'
  | 'delivered'
  | 'closed'

export type ReviewCase = {
  id: string
  case_ref: string
  status: ReviewCaseStatus
  assigned_reviewer_id: string | null
  assigned_expert_id: string | null
  ai_draft: Json | null
  insurer_name: string | null
  claim_amount_inr: number | null
  confidence_overall: 'high' | 'mixed' | 'low' | null
  sla_deadline: string | null
  sla_breached: boolean | null
}

export type ReviewFinding = {
  id: string
  case_id: string
  finding_type: string
  bill_line_item: string | null
  bill_amount_inr: number | null
  confidence_label:
    | 'clause_found_matched'
    | 'based_on_typical_policy'
    | 'insufficient_information'
  plain_language_explanation: string | null
  appeal_strength: 'strong' | 'moderate' | 'weak' | null
  appeal_basis: string | null
  reviewer_confirmed: boolean | null
  reviewer_confirmed_by: string | null
  reviewer_confirmed_at: string | null
  reviewer_unassessable: boolean | null
  reviewer_unassessable_reason: string | null
  reviewer_unassessable_by: string | null
  reviewer_unassessable_at: string | null
  reviewer_edited: boolean | null
  sort_order: number | null
}

export type ReviewEscalation = {
  id: string
  case_id: string
  finding_id: string | null
  escalation_type: 'finding' | 'full_case'
  from_reviewer_id: string
  to_expert_id: string | null
  question_text: string
  priority: 'normal' | 'high'
  status: 'open' | 'accepted' | 'responded' | 'resolved' | 'dismissed'
  expert_response: string | null
  confidence_recommendation:
    | 'clause_found_matched'
    | 'based_on_typical_policy'
    | 'insufficient_information'
    | null
}

export type ReviewCaseUpdate = Partial<
  Pick<ReviewCase, 'status' | 'ai_draft' | 'assigned_expert_id'>
> & {
  updated_at?: string
  current_step?: 'awaiting_review' | 'report_generation'
}

export type ReviewFindingUpdate = Partial<
  Pick<
    ReviewFinding,
    | 'plain_language_explanation'
    | 'bill_amount_inr'
    | 'appeal_strength'
    | 'appeal_basis'
    | 'reviewer_confirmed'
    | 'reviewer_confirmed_by'
    | 'reviewer_confirmed_at'
    | 'reviewer_unassessable'
    | 'reviewer_unassessable_reason'
    | 'reviewer_unassessable_by'
    | 'reviewer_unassessable_at'
    | 'reviewer_edited'
  >
> & {
  updated_at?: string
}

export type ReviewEscalationUpdate = Partial<
  Pick<ReviewEscalation, 'status' | 'expert_response' | 'confidence_recommendation'>
> & {
  responded_at?: string
  resolved_at?: string
}

export type ReviewAuditInput = {
  actorId: string
  actorRole: ReviewRole
  action: string
  entityType: string
  entityId: string
  metadata?: Json
}

export type ReviewNotificationInput = {
  recipientId: string
  notificationType: 'escalation_received' | 'escalation_responded'
  caseId: string
  escalationId?: string
  message: string
}

export type CreateEscalationInput = {
  caseId: string
  findingId?: string
  questionText: string
  expertId?: string
  priority?: 'normal' | 'high'
}

export type RespondEscalationInput = {
  escalationId: string
  responseText: string
  confidenceRecommendation:
    | 'clause_found_matched'
    | 'based_on_typical_policy'
    | 'insufficient_information'
}

export type ReviewDraftSection =
  | 'hospital_questions'
  | 'insurer_questions'
  | 'appeal_points'
  | 'appeal_letter_draft'
  | 'scope_notes'
  | 'reviewer_letter_confirmed'

export type ReviewStore = {
  readCase(caseId: string): Promise<ReviewCase | null>
  readFinding(findingId: string): Promise<ReviewFinding | null>
  listFindings(caseId: string): Promise<ReviewFinding[]>
  listOpenEscalations(caseId: string): Promise<ReviewEscalation[]>
  readEscalation(escalationId: string): Promise<ReviewEscalation | null>
  reportExists(caseId: string): Promise<boolean>
  updateCase(caseId: string, updates: ReviewCaseUpdate): Promise<void>
  updateFinding(findingId: string, updates: ReviewFindingUpdate): Promise<void>
  insertEscalation(input: {
    caseId: string
    findingId: string | null
    escalationType: 'finding' | 'full_case'
    fromReviewerId: string
    toExpertId: string
    questionText: string
    priority: 'normal' | 'high'
  }): Promise<string>
  updateEscalation(escalationId: string, updates: ReviewEscalationUpdate): Promise<void>
  insertNotification(input: ReviewNotificationInput): Promise<void>
  insertAudit(input: ReviewAuditInput): Promise<void>
  signOffReport(caseId: string, reviewerId: string, signedOffAt: string): Promise<void>
  queueReportGeneration(caseId: string): Promise<void>
}

const HIGH_VALUE_INSUFFICIENT_INFO_THRESHOLD_PAISE = 20_000_000

export class ReviewWorkflowError extends Error {
  public readonly statusCode: number

  public constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'ReviewWorkflowError'
    this.statusCode = statusCode
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

function toJson(value: unknown): Json {
  return value as Json
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireText(value: string, fieldName: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new ReviewWorkflowError(`${fieldName} is required`, 400)
  return trimmed
}

function ensureReviewerAccess(actor: ReviewActor, caseRow: ReviewCase): void {
  if (actor.role === 'admin') return
  if (actor.role !== 'reviewer') throw new ReviewWorkflowError('Reviewer access required', 403)
  if (caseRow.assigned_reviewer_id !== actor.id) {
    throw new ReviewWorkflowError('Case is not assigned to this reviewer', 404)
  }
}

function ensureExpertAccess(actor: ReviewActor, escalation: ReviewEscalation): void {
  if (actor.role === 'admin') return
  if (actor.role !== 'expert') throw new ReviewWorkflowError('Expert access required', 403)
  if (escalation.to_expert_id !== actor.id || escalation.status !== 'open') {
    throw new ReviewWorkflowError('Escalation is not open for this expert', 404)
  }
}

async function readRequiredCase(store: ReviewStore, caseId: string): Promise<ReviewCase> {
  const caseRow = await store.readCase(caseId)
  if (!caseRow) throw new ReviewWorkflowError('Case not found', 404)
  return caseRow
}

async function readRequiredFinding(store: ReviewStore, findingId: string): Promise<ReviewFinding> {
  const finding = await store.readFinding(findingId)
  if (!finding) throw new ReviewWorkflowError('Finding not found', 404)
  return finding
}

function mergeAiDraftSection(aiDraft: Json, section: ReviewDraftSection, value: Json): Json {
  if (!isRecord(aiDraft)) throw new ReviewWorkflowError('AI draft is not editable JSON', 400)
  return toJson({
    ...aiDraft,
    [section]: value,
    reviewer_edited_sections: {
      ...(isRecord(aiDraft.reviewer_edited_sections) ? aiDraft.reviewer_edited_sections : {}),
      [section]: true,
    },
  })
}

/**
 * Moves an assigned case from ai_draft_ready to under_review when opened.
 *
 * SIDE EFFECTS: updates cases and writes audit_log through ReviewStore
 * THROWS: ReviewWorkflowError for authorization or invalid case state
 * IDEMPOTENT: yes, under_review/escalated cases are not moved again
 *
 * @param actor - Internal user opening the review page
 * @param store - ReviewStore implementation
 * @param caseId - Case to open
 * @returns The status after the open operation
 */
export async function startCaseReview(
  actor: ReviewActor,
  store: ReviewStore,
  caseId: string
): Promise<ReviewCaseStatus> {
  const caseRow = await readRequiredCase(store, caseId)
  ensureReviewerAccess(actor, caseRow)
  if (!caseRow.ai_draft) throw new ReviewWorkflowError('AI draft must exist before review starts', 400)
  if (caseRow.status === 'under_review' || caseRow.status === 'escalated') return caseRow.status
  if (caseRow.status !== 'ai_draft_ready') {
    throw new ReviewWorkflowError('Case is not ready for review', 400)
  }

  const openedAt = nowIso()
  await store.updateCase(caseId, {
    status: 'under_review',
    current_step: 'awaiting_review',
    updated_at: openedAt,
  })
  await store.insertAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'review_started',
    entityType: 'case',
    entityId: caseId,
    metadata: toJson({ previous_status: 'ai_draft_ready', new_status: 'under_review' }),
  })
  return 'under_review'
}

/**
 * Confirms one finding for reviewer sign-off.
 *
 * SIDE EFFECTS: updates findings and writes audit_log through ReviewStore
 * THROWS: ReviewWorkflowError for authorization
 * IDEMPOTENT: yes, confirming an already confirmed finding leaves it confirmed
 *
 * @param actor - Reviewer or admin confirming the finding
 * @param store - ReviewStore implementation
 * @param findingId - Finding to confirm
 * @returns Nothing
 */
export async function confirmFinding(
  actor: ReviewActor,
  store: ReviewStore,
  findingId: string
): Promise<void> {
  const finding = await readRequiredFinding(store, findingId)
  const caseRow = await readRequiredCase(store, finding.case_id)
  ensureReviewerAccess(actor, caseRow)
  const confirmedAt = nowIso()

  await store.updateFinding(findingId, {
    reviewer_confirmed: true,
    reviewer_confirmed_by: actor.id,
    reviewer_confirmed_at: confirmedAt,
    reviewer_unassessable: false,
    reviewer_unassessable_reason: null,
    reviewer_unassessable_by: null,
    reviewer_unassessable_at: null,
    updated_at: confirmedAt,
  })
  await store.insertAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'finding_confirmed',
    entityType: 'finding',
    entityId: findingId,
    metadata: toJson({ case_id: finding.case_id }),
  })
}

/**
 * Saves reviewer edits to a finding explanation and confirms that finding.
 *
 * SIDE EFFECTS: updates findings and writes audit_log through ReviewStore
 * THROWS: ReviewWorkflowError for authorization or validation
 * IDEMPOTENT: no, every different edit changes review evidence
 *
 * @param actor - Reviewer or admin editing the explanation
 * @param store - ReviewStore implementation
 * @param findingId - Finding to edit
 * @param explanation - Replacement plain-language explanation
 * @returns Nothing
 */
export async function editFindingExplanation(
  actor: ReviewActor,
  store: ReviewStore,
  findingId: string,
  explanation: string
): Promise<void> {
  const finding = await readRequiredFinding(store, findingId)
  const caseRow = await readRequiredCase(store, finding.case_id)
  ensureReviewerAccess(actor, caseRow)
  const nextExplanation = requireText(explanation, 'Explanation')
  const editedAt = nowIso()

  await store.updateFinding(findingId, {
    plain_language_explanation: nextExplanation,
    reviewer_confirmed: true,
    reviewer_confirmed_by: actor.id,
    reviewer_confirmed_at: editedAt,
    reviewer_unassessable: false,
    reviewer_unassessable_reason: null,
    reviewer_unassessable_by: null,
    reviewer_unassessable_at: null,
    reviewer_edited: true,
    updated_at: editedAt,
  })
  await store.insertAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'finding_explanation_edited',
    entityType: 'finding',
    entityId: findingId,
    metadata: toJson({
      case_id: finding.case_id,
      old_value: finding.plain_language_explanation,
      new_value: nextExplanation,
    }),
  })
}

/**
 * Marks a finding explicitly unassessable with a reviewer reason.
 *
 * SIDE EFFECTS: updates findings and writes audit_log through ReviewStore
 * THROWS: ReviewWorkflowError for authorization or missing reason
 * IDEMPOTENT: yes for the same reason, with a fresh audit entry
 *
 * @param actor - Reviewer or admin marking the finding
 * @param store - ReviewStore implementation
 * @param findingId - Finding to mark
 * @param reason - Human review reason explaining why it cannot be assessed
 * @returns Nothing
 */
export async function markFindingUnassessable(
  actor: ReviewActor,
  store: ReviewStore,
  findingId: string,
  reason: string
): Promise<void> {
  const finding = await readRequiredFinding(store, findingId)
  const caseRow = await readRequiredCase(store, finding.case_id)
  ensureReviewerAccess(actor, caseRow)
  const cleanReason = requireText(reason, 'Unassessable reason')
  const markedAt = nowIso()

  await store.updateFinding(findingId, {
    reviewer_confirmed: false,
    reviewer_confirmed_by: null,
    reviewer_confirmed_at: null,
    reviewer_unassessable: true,
    reviewer_unassessable_reason: cleanReason,
    reviewer_unassessable_by: actor.id,
    reviewer_unassessable_at: markedAt,
    updated_at: markedAt,
  })
  await store.insertAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'finding_marked_unassessable',
    entityType: 'finding',
    entityId: findingId,
    metadata: toJson({ case_id: finding.case_id, reason: cleanReason }),
  })
}

/**
 * Stores reviewer edits to a draft section in cases.ai_draft.
 *
 * SIDE EFFECTS: updates cases.ai_draft and writes audit_log through ReviewStore
 * THROWS: ReviewWorkflowError for authorization or missing AI draft
 * IDEMPOTENT: yes for identical section content, with a fresh audit entry
 *
 * @param actor - Reviewer or admin editing the draft
 * @param store - ReviewStore implementation
 * @param caseId - Case containing the draft
 * @param section - Draft section to update
 * @param value - Replacement JSON-compatible section value
 * @returns Nothing
 */
export async function updateDraftSection(
  actor: ReviewActor,
  store: ReviewStore,
  caseId: string,
  section: ReviewDraftSection,
  value: Json
): Promise<void> {
  const caseRow = await readRequiredCase(store, caseId)
  ensureReviewerAccess(actor, caseRow)
  if (!caseRow.ai_draft) {
    throw new ReviewWorkflowError('AI draft must exist before reviewer edits', 400)
  }
  const nextDraft = mergeAiDraftSection(caseRow.ai_draft, section, value)

  await store.updateCase(caseId, { ai_draft: nextDraft, updated_at: nowIso() })
  await store.insertAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'draft_section_edited',
    entityType: 'case',
    entityId: caseId,
    metadata: toJson({ section, new_value: value }),
  })
}

/**
 * Records a reviewer missing-document request without exposing it to patients.
 *
 * SIDE EFFECTS: updates cases.ai_draft review metadata and writes audit_log
 * THROWS: ReviewWorkflowError for authorization or missing request
 * IDEMPOTENT: no, each request is preserved as review evidence
 *
 * @param actor - Reviewer or admin requesting the document
 * @param store - ReviewStore implementation
 * @param caseId - Case needing more information
 * @param requestText - Missing-document request text
 * @returns Nothing
 */
export async function requestMissingDocument(
  actor: ReviewActor,
  store: ReviewStore,
  caseId: string,
  requestText: string
): Promise<void> {
  const caseRow = await readRequiredCase(store, caseId)
  ensureReviewerAccess(actor, caseRow)
  if (!caseRow.ai_draft) {
    throw new ReviewWorkflowError('AI draft must exist before review edits', 400)
  }
  const cleanRequest = requireText(requestText, 'Missing document request')
  const draft = isRecord(caseRow.ai_draft) ? caseRow.ai_draft : {}
  const previousRequests = Array.isArray(draft.missing_document_requests)
    ? draft.missing_document_requests
    : []
  const nextDraft = toJson({
    ...draft,
    missing_document_requests: [
      ...previousRequests,
      {
        requested_by: actor.id,
        requested_at: nowIso(),
        request_text: cleanRequest,
      },
    ],
  })

  await store.updateCase(caseId, { ai_draft: nextDraft, updated_at: nowIso() })
  await store.insertAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'missing_document_requested',
    entityType: 'case',
    entityId: caseId,
    metadata: toJson({ request_text: cleanRequest }),
  })
}

/**
 * Escalates a finding or whole case to an assigned expert.
 *
 * SIDE EFFECTS: inserts escalations/reviewer_notifications, updates case status, writes audit
 * THROWS: ReviewWorkflowError for authorization, validation, or missing expert
 * IDEMPOTENT: no, each distinct question creates a new escalation
 *
 * @param actor - Reviewer or admin creating the escalation
 * @param store - ReviewStore implementation
 * @param input - Escalation payload
 * @returns Created escalation id
 */
export async function createEscalation(
  actor: ReviewActor,
  store: ReviewStore,
  input: CreateEscalationInput
): Promise<string> {
  const caseRow = await readRequiredCase(store, input.caseId)
  ensureReviewerAccess(actor, caseRow)
  const questionText = requireText(input.questionText, 'Escalation question')
  const expertId = input.expertId ?? caseRow.assigned_expert_id
  if (!expertId) throw new ReviewWorkflowError('An expert must be assigned before escalation', 400)
  const escalationType = input.findingId ? 'finding' : 'full_case'

  if (input.findingId) {
    const finding = await readRequiredFinding(store, input.findingId)
    if (finding.case_id !== input.caseId) {
      throw new ReviewWorkflowError('Finding does not belong to this case', 400)
    }
  }

  const escalationId = await store.insertEscalation({
    caseId: input.caseId,
    findingId: input.findingId ?? null,
    escalationType,
    fromReviewerId: actor.id,
    toExpertId: expertId,
    questionText,
    priority: input.priority ?? 'normal',
  })
  await store.insertNotification({
    recipientId: expertId,
    notificationType: 'escalation_received',
    caseId: input.caseId,
    escalationId,
    message: `Escalation received for case ${caseRow.case_ref}`,
  })
  await store.updateCase(input.caseId, { status: 'escalated', updated_at: nowIso() })
  await store.insertAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'case_escalated',
    entityType: 'escalation',
    entityId: escalationId,
    metadata: toJson({
      case_id: input.caseId,
      finding_id: input.findingId ?? null,
      escalation_type: escalationType,
    }),
  })
  return escalationId
}

/**
 * Records an expert response and returns the case to under_review.
 *
 * SIDE EFFECTS: updates escalations/cases, inserts notification, writes audit_log
 * THROWS: ReviewWorkflowError for authorization or closed escalation
 * IDEMPOTENT: no, only open escalations can be responded to
 *
 * @param actor - Expert assigned to the escalation or admin
 * @param store - ReviewStore implementation
 * @param input - Expert response payload
 * @returns Nothing
 */
export async function respondToEscalation(
  actor: ReviewActor,
  store: ReviewStore,
  input: RespondEscalationInput
): Promise<void> {
  const responseText = requireText(input.responseText, 'Expert response')
  const escalation = await store.readEscalation(input.escalationId)
  if (!escalation) throw new ReviewWorkflowError('Escalation not found', 404)
  ensureExpertAccess(actor, escalation)
  const caseRow = await readRequiredCase(store, escalation.case_id)
  const respondedAt = nowIso()

  await store.updateEscalation(input.escalationId, {
    status: 'responded',
    expert_response: responseText,
    confidence_recommendation: input.confidenceRecommendation,
    responded_at: respondedAt,
  })
  await store.insertNotification({
    recipientId: escalation.from_reviewer_id,
    notificationType: 'escalation_responded',
    caseId: escalation.case_id,
    escalationId: escalation.id,
    message: `Expert response received for case ${caseRow.case_ref}`,
  })
  await store.updateCase(escalation.case_id, {
    status: 'under_review',
    current_step: 'awaiting_review',
    updated_at: respondedAt,
  })
  await store.insertAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'expert_response_submitted',
    entityType: 'escalation',
    entityId: escalation.id,
    metadata: toJson({
      case_id: escalation.case_id,
      confidence_recommendation: input.confidenceRecommendation,
    }),
  })
}

function isFindingReviewComplete(finding: ReviewFinding): boolean {
  if (finding.reviewer_confirmed === true) return true
  return (
    finding.reviewer_unassessable === true &&
    typeof finding.reviewer_unassessable_reason === 'string' &&
    finding.reviewer_unassessable_reason.trim().length > 0
  )
}

/**
 * Runs all server-side Module 7 sign-off gates and queues report generation.
 *
 * SIDE EFFECTS: updates cases/reports, queues processing_jobs, writes audit_log
 * THROWS: ReviewWorkflowError for authorization or failed sign-off gates
 * IDEMPOTENT: report_generation is keyed by report_gen:{caseId}; case approval is one-way
 *
 * @param actor - Assigned reviewer or admin signing off
 * @param store - ReviewStore implementation
 * @param caseId - Case to approve
 * @returns Nothing
 */
export async function signOffCase(
  actor: ReviewActor,
  store: ReviewStore,
  caseId: string
): Promise<void> {
  const caseRow = await readRequiredCase(store, caseId)
  ensureReviewerAccess(actor, caseRow)

  if (caseRow.status !== 'under_review') {
    throw new ReviewWorkflowError('Case must be under_review before sign-off', 400)
  }
  if (!caseRow.ai_draft) throw new ReviewWorkflowError('AI draft must exist before sign-off', 400)

  const [findings, openEscalations, hasReport] = await Promise.all([
    store.listFindings(caseId),
    store.listOpenEscalations(caseId),
    store.reportExists(caseId),
  ])
  const incomplete = findings.filter((finding) => !isFindingReviewComplete(finding))
  if (incomplete.length > 0) {
    throw new ReviewWorkflowError('All findings must be confirmed or marked unassessable', 400)
  }
  if (openEscalations.length > 0) {
    throw new ReviewWorkflowError('Open escalations must be resolved before sign-off', 400)
  }
  const highValueInsufficientInfo = findings.find(
    (finding) =>
      finding.confidence_label === 'insufficient_information' &&
      (finding.bill_amount_inr ?? 0) > HIGH_VALUE_INSUFFICIENT_INFO_THRESHOLD_PAISE
  )
  if (highValueInsufficientInfo) {
    throw new ReviewWorkflowError('High-value insufficient-information finding blocks approval', 400)
  }
  if (!hasReport) throw new ReviewWorkflowError('Report row must exist before sign-off', 400)

  const signedOffAt = nowIso()
  await store.signOffReport(caseId, actor.id, signedOffAt)
  await store.queueReportGeneration(caseId)
  await store.updateCase(caseId, { status: 'approved', updated_at: signedOffAt })
  await store.insertAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'case_signed_off',
    entityType: 'case',
    entityId: caseId,
    metadata: toJson({ report_job_idempotency_key: `report_gen:${caseId}` }),
  })
}
