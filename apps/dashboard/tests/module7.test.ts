/**
 * @file module7.test.ts
 * @module dashboard/tests
 *
 * Executable Module 7 reviewer workflow checkpoints.
 */

import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

import type { Json } from '@claimclarity/db'

import {
  confirmFinding,
  createEscalation,
  editFindingExplanation,
  markFindingUnassessable,
  respondToEscalation,
  signOffCase,
  startCaseReview,
  type ReviewActor,
  type ReviewAuditInput,
  type ReviewCase,
  type ReviewCaseUpdate,
  type ReviewEscalation,
  type ReviewEscalationUpdate,
  type ReviewFinding,
  type ReviewFindingUpdate,
  type ReviewNotificationInput,
  type ReviewStore,
} from '../lib/review/workflow'

type CheckpointName =
  | 'ai_draft_ready_opens_under_review'
  | 'finding_confirmation_audited'
  | 'edit_logs_old_value'
  | 'signoff_blocks_unconfirmed'
  | 'signoff_blocks_open_escalation'
  | 'high_value_insufficient_information_blocks'
  | 'signoff_succeeds_when_gates_pass'
  | 'report_generation_idempotent'
  | 'cross_reviewer_access_denied'
  | 'patient_access_denied'
  | 'expert_escalation_access'
  | 'module8_delivery_not_triggered'

type CheckpointResult = { pass: boolean; detail?: string }

const CHECKPOINTS: readonly CheckpointName[] = [
  'ai_draft_ready_opens_under_review',
  'finding_confirmation_audited',
  'edit_logs_old_value',
  'signoff_blocks_unconfirmed',
  'signoff_blocks_open_escalation',
  'high_value_insufficient_information_blocks',
  'signoff_succeeds_when_gates_pass',
  'report_generation_idempotent',
  'cross_reviewer_access_denied',
  'patient_access_denied',
  'expert_escalation_access',
  'module8_delivery_not_triggered',
]

const reviewer: ReviewActor = { id: 'reviewer-a', role: 'reviewer' }
const otherReviewer: ReviewActor = { id: 'reviewer-b', role: 'reviewer' }
const expert: ReviewActor = { id: 'expert-a', role: 'expert' }
const otherExpert: ReviewActor = { id: 'expert-b', role: 'expert' }
const patientActor = { id: 'patient-a', role: 'patient' } as unknown as ReviewActor

function toJson(value: unknown): Json {
  return value as Json
}

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

class MemoryReviewStore implements ReviewStore {
  public readonly cases = new Map<string, ReviewCase>()
  public readonly findings = new Map<string, ReviewFinding>()
  public readonly escalations = new Map<string, ReviewEscalation>()
  public readonly audits: ReviewAuditInput[] = []
  public readonly notifications: ReviewNotificationInput[] = []
  public readonly reportRows = new Set<string>()
  public readonly signedReports = new Map<string, { signedOffBy: string; signedOffAt: string }>()
  public readonly jobs = new Map<string, { caseId: string; jobType: string; status: string }>()
  public readonly deliveryEvents: string[] = []

  public readCase(caseId: string): Promise<ReviewCase | null> {
    return Promise.resolve(this.cases.get(caseId) ?? null)
  }

  public readFinding(findingId: string): Promise<ReviewFinding | null> {
    return Promise.resolve(this.findings.get(findingId) ?? null)
  }

  public listFindings(caseId: string): Promise<ReviewFinding[]> {
    return Promise.resolve([...this.findings.values()].filter((finding) => finding.case_id === caseId))
  }

  public listOpenEscalations(caseId: string): Promise<ReviewEscalation[]> {
    return Promise.resolve(
      [...this.escalations.values()].filter(
        (escalation) => escalation.case_id === caseId && escalation.status === 'open'
      )
    )
  }

  public readEscalation(escalationId: string): Promise<ReviewEscalation | null> {
    return Promise.resolve(this.escalations.get(escalationId) ?? null)
  }

  public reportExists(caseId: string): Promise<boolean> {
    return Promise.resolve(this.reportRows.has(caseId))
  }

  public updateCase(caseId: string, updates: ReviewCaseUpdate): Promise<void> {
    const current = this.cases.get(caseId)
    if (!current) throw new Error('case missing')
    this.cases.set(caseId, { ...current, ...updates })
    return Promise.resolve()
  }

  public updateFinding(findingId: string, updates: ReviewFindingUpdate): Promise<void> {
    const current = this.findings.get(findingId)
    if (!current) throw new Error('finding missing')
    this.findings.set(findingId, { ...current, ...updates })
    return Promise.resolve()
  }

  public insertEscalation(input: {
    caseId: string
    findingId: string | null
    escalationType: 'finding' | 'full_case'
    fromReviewerId: string
    toExpertId: string
    questionText: string
    priority: 'normal' | 'high'
  }): Promise<string> {
    const id = randomUUID()
    this.escalations.set(id, {
      id,
      case_id: input.caseId,
      finding_id: input.findingId,
      escalation_type: input.escalationType,
      from_reviewer_id: input.fromReviewerId,
      to_expert_id: input.toExpertId,
      question_text: input.questionText,
      priority: input.priority,
      status: 'open',
      expert_response: null,
      confidence_recommendation: null,
    })
    return Promise.resolve(id)
  }

  public updateEscalation(
    escalationId: string,
    updates: ReviewEscalationUpdate
  ): Promise<void> {
    const current = this.escalations.get(escalationId)
    if (!current) throw new Error('escalation missing')
    this.escalations.set(escalationId, { ...current, ...updates })
    return Promise.resolve()
  }

  public insertNotification(input: ReviewNotificationInput): Promise<void> {
    this.notifications.push(input)
    return Promise.resolve()
  }

  public insertAudit(input: ReviewAuditInput): Promise<void> {
    this.audits.push(input)
    return Promise.resolve()
  }

  public signOffReport(
    caseId: string,
    reviewerId: string,
    signedOffAt: string
  ): Promise<void> {
    this.signedReports.set(caseId, { signedOffBy: reviewerId, signedOffAt })
    return Promise.resolve()
  }

  public queueReportGeneration(caseId: string): Promise<void> {
    this.jobs.set(`report_gen:${caseId}`, {
      caseId,
      jobType: 'report_generation',
      status: 'queued',
    })
    return Promise.resolve()
  }
}

function finding(input: Partial<ReviewFinding> & { id: string; case_id: string }): ReviewFinding {
  return {
    finding_type: 'deducted',
    bill_line_item: 'Room charges',
    bill_amount_inr: 500_000,
    confidence_label: 'clause_found_matched',
    plain_language_explanation: 'AI explanation',
    appeal_strength: 'strong',
    appeal_basis: 'Policy clause',
    reviewer_confirmed: false,
    reviewer_confirmed_by: null,
    reviewer_confirmed_at: null,
    reviewer_unassessable: false,
    reviewer_unassessable_reason: null,
    reviewer_unassessable_by: null,
    reviewer_unassessable_at: null,
    reviewer_edited: false,
    sort_order: 1,
    ...input,
  }
}

function fixtureStore(): { store: MemoryReviewStore; caseId: string; findingIds: string[] } {
  const store = new MemoryReviewStore()
  const caseId = 'case-a'
  const findingIds = ['finding-a', 'finding-b']
  store.cases.set(caseId, {
    id: caseId,
    case_ref: 'CC-M7-001',
    status: 'ai_draft_ready',
    assigned_reviewer_id: reviewer.id,
    assigned_expert_id: expert.id,
    ai_draft: toJson({
      hospital_questions: ['Question for hospital'],
      insurer_questions: ['Question for insurer'],
      appeal_points: [{ point: 'Appeal point', strength: 'strong', basis: 'Policy' }],
      appeal_letter_draft: 'Draft letter',
      scope_notes: 'Reviewer-facing only',
    }),
    insurer_name: 'Module 7 Health',
    claim_amount_inr: 125_000,
    confidence_overall: 'mixed',
    sla_deadline: null,
    sla_breached: false,
  })
  store.findings.set(findingIds[0]!, finding({ id: findingIds[0]!, case_id: caseId }))
  store.findings.set(
    findingIds[1]!,
    finding({
      id: findingIds[1]!,
      case_id: caseId,
      bill_line_item: 'Missing discharge summary',
      bill_amount_inr: null,
      confidence_label: 'insufficient_information',
      sort_order: 2,
    })
  )
  store.reportRows.add(caseId)
  return { store, caseId, findingIds }
}

async function confirmAll(store: MemoryReviewStore, findingIds: string[]): Promise<void> {
  for (const findingId of findingIds) await confirmFinding(reviewer, store, findingId)
}

async function expectFailure(check: () => Promise<unknown>, includes: string): Promise<void> {
  try {
    await check()
  } catch (error) {
    assertCondition(errorMessage(error).includes(includes), `Expected failure containing ${includes}`)
    return
  }
  throw new Error('Expected workflow failure did not occur')
}

async function runCheckpoint(
  name: CheckpointName,
  results: Partial<Record<CheckpointName, CheckpointResult>>,
  check: () => Promise<void>
): Promise<void> {
  try {
    await check()
    results[name] = { pass: true }
  } catch (error) {
    results[name] = { pass: false, detail: errorMessage(error) }
  }
}

function printReport(results: Partial<Record<CheckpointName, CheckpointResult>>): number {
  console.log('\nMODULE 7 CHECKPOINT REPORT')
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

export async function runModule7Checkpoints(): Promise<number> {
  const results: Partial<Record<CheckpointName, CheckpointResult>> = {}

  await runCheckpoint('ai_draft_ready_opens_under_review', results, async () => {
    const { store, caseId } = fixtureStore()
    await startCaseReview(reviewer, store, caseId)
    assertCondition(store.cases.get(caseId)?.status === 'under_review', 'Case was not opened')
    assertCondition(store.audits.some((audit) => audit.action === 'review_started'), 'Audit missing')
  })

  await runCheckpoint('finding_confirmation_audited', results, async () => {
    const { store, findingIds } = fixtureStore()
    await confirmFinding(reviewer, store, findingIds[0]!)
    const row = store.findings.get(findingIds[0]!)
    assertCondition(row !== undefined, 'Finding row missing')
    assertCondition(row.reviewer_confirmed === true, 'Finding not confirmed')
    assertCondition(row.reviewer_confirmed_by === reviewer.id, 'Reviewer not recorded')
    assertCondition(store.audits.some((audit) => audit.action === 'finding_confirmed'), 'Audit missing')
  })

  await runCheckpoint('edit_logs_old_value', results, async () => {
    const { store, findingIds } = fixtureStore()
    await editFindingExplanation(reviewer, store, findingIds[0]!, 'Reviewer explanation')
    const row = store.findings.get(findingIds[0]!)
    assertCondition(row?.reviewer_edited === true, 'reviewer_edited not set')
    const audit = store.audits.find((entry) => entry.action === 'finding_explanation_edited')
    assertCondition(JSON.stringify(audit?.metadata).includes('AI explanation'), 'Old value missing')
  })

  await runCheckpoint('signoff_blocks_unconfirmed', results, async () => {
    const { store, caseId } = fixtureStore()
    await startCaseReview(reviewer, store, caseId)
    await expectFailure(() => signOffCase(reviewer, store, caseId), 'All findings')
    assertCondition(store.cases.get(caseId)?.status === 'under_review', 'Case status changed')
  })

  await runCheckpoint('signoff_blocks_open_escalation', results, async () => {
    const { store, caseId, findingIds } = fixtureStore()
    await startCaseReview(reviewer, store, caseId)
    await confirmAll(store, findingIds)
    await store.insertEscalation({
      caseId,
      findingId: null,
      escalationType: 'full_case',
      fromReviewerId: reviewer.id,
      toExpertId: expert.id,
      questionText: 'Please review',
      priority: 'normal',
    })
    await expectFailure(() => signOffCase(reviewer, store, caseId), 'Open escalations')
  })

  await runCheckpoint('high_value_insufficient_information_blocks', results, async () => {
    const { store, caseId, findingIds } = fixtureStore()
    await startCaseReview(reviewer, store, caseId)
    await confirmFinding(reviewer, store, findingIds[0]!)
    await markFindingUnassessable(reviewer, store, findingIds[1]!, 'Needs missing document')
    await store.updateFinding(findingIds[1]!, { bill_amount_inr: 25_000_000 })
    await expectFailure(() => signOffCase(reviewer, store, caseId), 'High-value')
  })

  await runCheckpoint('signoff_succeeds_when_gates_pass', results, async () => {
    const { store, caseId, findingIds } = fixtureStore()
    await startCaseReview(reviewer, store, caseId)
    await confirmAll(store, findingIds)
    await signOffCase(reviewer, store, caseId)
    assertCondition(store.cases.get(caseId)?.status === 'approved', 'Case not approved')
    assertCondition(store.signedReports.has(caseId), 'Report sign-off missing')
    assertCondition(store.audits.some((audit) => audit.action === 'case_signed_off'), 'Audit missing')
  })

  await runCheckpoint('report_generation_idempotent', results, async () => {
    const { store, caseId, findingIds } = fixtureStore()
    await startCaseReview(reviewer, store, caseId)
    await confirmAll(store, findingIds)
    await signOffCase(reviewer, store, caseId)
    await store.queueReportGeneration(caseId)
    assertCondition(store.jobs.size === 1, 'Duplicate report_generation jobs were queued')
  })

  await runCheckpoint('cross_reviewer_access_denied', results, async () => {
    const { store, caseId } = fixtureStore()
    await expectFailure(() => startCaseReview(otherReviewer, store, caseId), 'not assigned')
  })

  await runCheckpoint('patient_access_denied', results, async () => {
    const { store, findingIds } = fixtureStore()
    await expectFailure(() => confirmFinding(patientActor, store, findingIds[0]!), 'Reviewer access')
  })

  await runCheckpoint('expert_escalation_access', results, async () => {
    const { store, caseId } = fixtureStore()
    await startCaseReview(reviewer, store, caseId)
    const escalationId = await createEscalation(reviewer, store, {
      caseId,
      questionText: 'Please advise',
      expertId: expert.id,
    })
    await expectFailure(
      () =>
        respondToEscalation(otherExpert, store, {
          escalationId,
          responseText: 'Not assigned',
          confidenceRecommendation: 'insufficient_information',
        }),
      'not open'
    )
    await respondToEscalation(expert, store, {
      escalationId,
      responseText: 'Use the matched clause',
      confidenceRecommendation: 'clause_found_matched',
    })
    assertCondition(store.escalations.get(escalationId)?.status === 'responded', 'Response missing')
    assertCondition(store.cases.get(caseId)?.status === 'under_review', 'Case not returned')
  })

  await runCheckpoint('module8_delivery_not_triggered', results, async () => {
    const { store, caseId, findingIds } = fixtureStore()
    await startCaseReview(reviewer, store, caseId)
    await confirmAll(store, findingIds)
    await signOffCase(reviewer, store, caseId)
    assertCondition(store.deliveryEvents.length === 0, 'Delivery event triggered')
    assertCondition(
      [...store.jobs.values()].every((job) => job.jobType !== 'email_delivery'),
      'Email delivery job queued'
    )
  })

  return printReport(results)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runModule7Checkpoints()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error: unknown) => {
      console.error('Module 7 checkpoint runner crashed:', error)
      process.exit(1)
    })
}
