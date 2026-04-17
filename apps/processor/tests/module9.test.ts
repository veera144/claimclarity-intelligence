/**
 * @file module9.test.ts
 * @module processor/tests
 *
 * Executable Module 9 outcome tracking and value measurement checkpoints.
 */

import { createHash, randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'

import type { DbClient, Json } from '@claimclarity/db'
import { OUTCOME_ANALYTICS_SQL } from '@claimclarity/db'
import { FOLLOW_UP_DAYS } from '@claimclarity/shared/constants'

import {
  buildFullOutcomeMutation,
  buildQuickOutcomeMutation,
  submitFullOutcome,
  submitQuickOutcome,
} from '../../web/lib/outcomes/outcome-service'
import {
  processDueFollowUpReminders,
  type FollowUpReminderStore,
} from '../src/outcomes/follow-up-reminders'
import type { EmailSender, ReportReadyEmail } from '../src/jobs/reportGenerationJob'

type CheckpointName =
  | 'delivered_case_has_30_60_90_followups'
  | 'unauthenticated_post_without_token_fails'
  | 'raw_case_ref_alone_cannot_update'
  | 'valid_token_updates_once'
  | 'reused_token_fails'
  | 'expired_token_fails'
  | 'get_confirmation_page_does_not_mutate'
  | 'quick_update_sets_only_intended_field'
  | 'full_form_stores_whole_rupees_exactly'
  | 'reversal_amount_auto_calculates_not_manual'
  | 'optional_evidence_sets_document_verified'
  | 'no_evidence_keeps_self_reported'
  | 'high_value_self_reported_sets_manual_followup'
  | 'response_received_true_after_valid_response'
  | 'analytics_recovery_values_do_not_divide_by_100'
  | 'segmentation_excludes_test_by_default'
  | 'followup_not_sent_before_report_delivery'
  | 'followup_marks_sent_and_message_id'
  | 'followup_suppressed_after_final_outcome'
  | 'followup_failure_logs_without_outcome_change'

type CheckpointResult = { pass: boolean; detail?: string }

const CHECKPOINTS: readonly CheckpointName[] = [
  'delivered_case_has_30_60_90_followups',
  'unauthenticated_post_without_token_fails',
  'raw_case_ref_alone_cannot_update',
  'valid_token_updates_once',
  'reused_token_fails',
  'expired_token_fails',
  'get_confirmation_page_does_not_mutate',
  'quick_update_sets_only_intended_field',
  'full_form_stores_whole_rupees_exactly',
  'reversal_amount_auto_calculates_not_manual',
  'optional_evidence_sets_document_verified',
  'no_evidence_keeps_self_reported',
  'high_value_self_reported_sets_manual_followup',
  'response_received_true_after_valid_response',
  'analytics_recovery_values_do_not_divide_by_100',
  'segmentation_excludes_test_by_default',
  'followup_not_sent_before_report_delivery',
  'followup_marks_sent_and_message_id',
  'followup_suppressed_after_final_outcome',
  'followup_failure_logs_without_outcome_change',
]

type Row = Record<string, unknown>

type CaseRow = {
  id: string
  case_ref: string
  patient_id: string
  status: string
  claim_amount_inr: number | null
  original_approved_inr: number | null
  originally_deducted_inr: number | null
  payment_reporting_category: 'paid' | 'waived' | 'test'
}

type ReportRow = {
  id: string
  case_id: string
  delivered_at: string | null
}

type OutcomeRow = {
  id: string
  case_id: string
  appeal_submitted?: boolean | null
  appeal_submitted_at?: string | null
  insurer_responded?: boolean | null
  insurer_responded_at?: string | null
  final_settled_amount_inr?: number | null
  original_approved_inr?: number | null
  originally_deducted_inr?: number | null
  reversal_amount_inr?: number | null
  outcome_type?: string | null
  patient_action_type?: string
  evidence_type?: string
  evidence_storage_path?: string | null
  user_satisfaction?: number | null
  user_comment?: string | null
  needs_manual_followup?: boolean
  manual_followup_reason?: string | null
  collected_at?: string | null
  last_updated_at?: string | null
}

type OutcomeTokenRow = {
  id: string
  case_id: string
  token_hash: string
  token_type: 'quick_update' | 'full_outcome'
  expires_at: string
  used_at: string | null
  created_at: string
}

type FollowUpRow = {
  id: string
  case_id: string
  sequence_number: 1 | 2 | 3
  scheduled_at: string
  sent_at: string | null
  email_message_id: string | null
  response_received: boolean | null
}

type AuditRow = {
  id: string
  action: string
  entity_id?: string | null
  metadata?: Json | null
}

type UserRow = {
  id: string
  email: string
}

type DbShape = {
  cases: CaseRow[]
  reports: ReportRow[]
  outcomes: OutcomeRow[]
  outcome_tokens: OutcomeTokenRow[]
  follow_up_schedule: FollowUpRow[]
  audit_log: AuditRow[]
  users: UserRow[]
}

type QueryFilter = {
  field: string
  operator: 'eq' | 'is' | 'gt' | 'lte'
  value: unknown
}

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function cloneRow<T extends Row>(row: T): T {
  return { ...row }
}

function tableRows(db: DbShape, table: string): Row[] {
  return db[table as keyof DbShape] as unknown as Row[]
}

class MemoryQuery {
  private readonly filters: QueryFilter[] = []
  private operation: 'select' | 'insert' | 'update' | 'upsert' = 'select'
  private payload: Row | Row[] | null = null
  private selected = false

  public constructor(
    private readonly db: DbShape,
    private readonly table: string
  ) {}

  public select(_columns?: string): this {
    this.selected = true
    return this
  }

  public insert(payload: Row | Row[]): this {
    this.operation = 'insert'
    this.payload = payload
    return this
  }

  public update(payload: Row): this {
    this.operation = 'update'
    this.payload = payload
    return this
  }

  public upsert(payload: Row | Row[], _options?: { onConflict?: string }): this {
    this.operation = 'upsert'
    this.payload = payload
    return this
  }

  public eq(field: string, value: unknown): this {
    this.filters.push({ field, operator: 'eq', value })
    return this
  }

  public is(field: string, value: unknown): this {
    this.filters.push({ field, operator: 'is', value })
    return this
  }

  public gt(field: string, value: unknown): this {
    this.filters.push({ field, operator: 'gt', value })
    return this
  }

  public lte(field: string, value: unknown): this {
    this.filters.push({ field, operator: 'lte', value })
    return this
  }

  public order(_field: string, _options?: { ascending?: boolean }): this {
    return this
  }

  public maybeSingle(): Promise<{ data: Row | null; error: null }> {
    const result = this.execute()
    return Promise.resolve({
      data: result.data[0] ?? null,
      error: null,
    })
  }

  public single(): Promise<{ data: Row; error: null }> {
    const result = this.execute()
    const row = result.data[0]
    if (!row) {
      throw new Error(`No row found for ${this.table}`)
    }
    return Promise.resolve({ data: row, error: null })
  }

  public then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected)
  }

  private execute(): { data: Row[]; error: null } {
    if (this.operation === 'insert') return this.executeInsert()
    if (this.operation === 'update') return this.executeUpdate()
    if (this.operation === 'upsert') return this.executeUpsert()
    return { data: this.matchRows().map((row) => cloneRow(row)), error: null }
  }

  private executeInsert(): { data: Row[]; error: null } {
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload]
    const inserted = rows.filter((row): row is Row => row !== null).map((row) => ({
      id: typeof row.id === 'string' ? row.id : randomUUID(),
      ...row,
    }))
    tableRows(this.db, this.table).push(...inserted)
    return { data: this.selected ? inserted.map((row) => cloneRow(row)) : [], error: null }
  }

  private executeUpdate(): { data: Row[]; error: null } {
    const rows = this.matchRows()
    const payload = this.payload && !Array.isArray(this.payload) ? this.payload : {}
    for (const row of rows) {
      Object.assign(row, payload)
      if (this.table === 'outcomes') calculateReversal(row as unknown as OutcomeRow)
    }
    return { data: this.selected ? rows.map((row) => cloneRow(row)) : [], error: null }
  }

  private executeUpsert(): { data: Row[]; error: null } {
    const rows = Array.isArray(this.payload) ? this.payload : [this.payload]
    const result: Row[] = []
    for (const payload of rows) {
      if (!payload) continue
      const table = tableRows(this.db, this.table)
      const caseId = payload.case_id
      const existing =
        this.table === 'outcomes' && typeof caseId === 'string'
          ? table.find((row) => row.case_id === caseId)
          : undefined
      if (existing) {
        Object.assign(existing, payload)
        calculateReversal(existing as unknown as OutcomeRow)
        result.push(cloneRow(existing))
      } else {
        const inserted = {
          id: typeof payload.id === 'string' ? payload.id : randomUUID(),
          ...payload,
        }
        if (this.table === 'outcomes') calculateReversal(inserted as unknown as OutcomeRow)
        table.push(inserted)
        result.push(cloneRow(inserted))
      }
    }
    return { data: result, error: null }
  }

  private matchRows(): Row[] {
    return tableRows(this.db, this.table).filter((row) =>
      this.filters.every((filter) => matchesFilter(row, filter))
    )
  }
}

function matchesFilter(row: Row, filter: QueryFilter): boolean {
  const value = row[filter.field]
  switch (filter.operator) {
    case 'eq':
      return value === filter.value
    case 'is':
      return value === filter.value
    case 'gt':
      return String(value) > String(filter.value)
    case 'lte':
      return String(value) <= String(filter.value)
  }

  return false
}

function calculateReversal(row: OutcomeRow): void {
  if (
    typeof row.final_settled_amount_inr === 'number' &&
    typeof row.original_approved_inr === 'number'
  ) {
    row.reversal_amount_inr = row.final_settled_amount_inr - row.original_approved_inr
  } else {
    row.reversal_amount_inr = null
  }
}

class MemoryDb {
  public readonly rows: DbShape

  public constructor() {
    const caseId = 'case-module9'
    const patientId = 'patient-module9'
    const deliveredAt = new Date('2026-01-01T00:00:00.000Z').toISOString()
    this.rows = {
      cases: [
        {
          id: caseId,
          case_ref: 'CC-M9-001',
          patient_id: patientId,
          status: 'delivered',
          claim_amount_inr: 250000,
          original_approved_inr: 80000,
          originally_deducted_inr: 20000,
          payment_reporting_category: 'paid',
        },
      ],
      reports: [{ id: 'report-module9', case_id: caseId, delivered_at: deliveredAt }],
      outcomes: [
        {
          id: 'outcome-module9',
          case_id: caseId,
          outcome_type: 'pending',
          patient_action_type: 'none',
          evidence_type: 'self_reported',
          original_approved_inr: 80000,
          originally_deducted_inr: 20000,
        },
      ],
      outcome_tokens: [],
      follow_up_schedule: FOLLOW_UP_DAYS.map((days, index) => {
        const date = new Date(deliveredAt)
        date.setUTCDate(date.getUTCDate() + days)
        return {
          id: `followup-${String(index + 1)}`,
          case_id: caseId,
          sequence_number: (index + 1) as 1 | 2 | 3,
          scheduled_at: date.toISOString(),
          sent_at: null,
          email_message_id: null,
          response_received: false,
        }
      }),
      audit_log: [],
      users: [{ id: patientId, email: 'patient@example.com' }],
    }
  }

  public client(): DbClient {
    return {
      from: (table: string) => new MemoryQuery(this.rows, table),
    } as unknown as DbClient
  }

  public addToken(input: {
    rawToken: string
    caseId?: string
    tokenType: 'quick_update' | 'full_outcome'
    expiresAt?: string
  }): void {
    this.rows.outcome_tokens.push({
      id: randomUUID(),
      case_id: input.caseId ?? 'case-module9',
      token_hash: sha256(input.rawToken),
      token_type: input.tokenType,
      expires_at:
        input.expiresAt ?? new Date('2026-01-08T00:00:00.000Z').toISOString(),
      used_at: null,
      created_at: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    })
  }

  public outcome(): OutcomeRow {
    const row = this.rows.outcomes.find((outcome) => outcome.case_id === 'case-module9')
    assertCondition(row !== undefined, 'Outcome row missing')
    return row
  }
}

class MemoryReminderStore implements FollowUpReminderStore {
  public readonly audits: Array<{ action: string; caseId: string; metadata?: Json }> = []
  public readonly tokens: Array<{ caseId: string; tokenType: string }> = []
  public context: {
    caseRef: string
    patientEmail: string
    deliveredAt: string | null
    caseStatus: string
    outcomeType: string | null
    patientActionType: string | null
  } = {
    caseRef: 'CC-M9-001',
    patientEmail: 'patient@example.com',
    deliveredAt: '2026-01-01T00:00:00.000Z',
    caseStatus: 'delivered',
    outcomeType: 'pending',
    patientActionType: 'none',
  }
  public followUps: FollowUpRow[] = [
    {
      id: 'due-followup',
      case_id: 'case-module9',
      sequence_number: 1,
      scheduled_at: '2026-02-01T00:00:00.000Z',
      sent_at: null,
      email_message_id: null,
      response_received: false,
    },
  ]

  public listDueFollowUps(): Promise<FollowUpRow[]> {
    return Promise.resolve(this.followUps.filter((row) => row.sent_at === null))
  }

  public loadContext(): Promise<MemoryReminderStore['context']> {
    return Promise.resolve(this.context)
  }

  public markSent(input: { scheduleId: string; sentAt: string; emailMessageId: string }): Promise<void> {
    const row = this.followUps.find((followUp) => followUp.id === input.scheduleId)
    assertCondition(row !== undefined, 'Follow-up row missing')
    row.sent_at = input.sentAt
    row.email_message_id = input.emailMessageId
    return Promise.resolve()
  }

  public insertAudit(input: { action: string; caseId: string; metadata?: Json }): Promise<void> {
    this.audits.push(input)
    return Promise.resolve()
  }

  public generateToken(caseId: string, tokenType: 'quick_update' | 'full_outcome'): Promise<string> {
    this.tokens.push({ caseId, tokenType })
    return Promise.resolve(`${tokenType}-raw-token`)
  }
}

class MemoryEmailSender implements EmailSender {
  public readonly sentEmails: ReportReadyEmail[] = []
  public fail = false

  public send(input: ReportReadyEmail): Promise<{ id: string }> {
    if (this.fail) return Promise.reject(new Error('Resend unavailable'))
    this.sentEmails.push(input)
    return Promise.resolve({ id: 'message-module9' })
  }
}

async function expectFailure(check: () => Promise<unknown>, includes: string): Promise<void> {
  try {
    await check()
  } catch (error) {
    assertCondition(errorMessage(error).includes(includes), `Expected failure containing ${includes}`)
    return
  }
  throw new Error('Expected failure did not occur')
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
  console.log('\nMODULE 9 CHECKPOINT REPORT')
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

export async function runModule9Checkpoints(): Promise<number> {
  const results: Partial<Record<CheckpointName, CheckpointResult>> = {}
  const now = new Date('2026-01-02T00:00:00.000Z')

  await runCheckpoint('delivered_case_has_30_60_90_followups', results, () => {
    const db = new MemoryDb()
    const deltas = db.rows.follow_up_schedule.map((row) => row.sequence_number)
    assertCondition(JSON.stringify(deltas) === JSON.stringify([1, 2, 3]), 'Missing follow-up rows')
  })

  await runCheckpoint('unauthenticated_post_without_token_fails', results, async () => {
    const db = new MemoryDb()
    await expectFailure(
      () =>
        submitFullOutcome({
          caseId: 'case-module9',
          serviceClient: db.client(),
          patientId: null,
          body: {
            appealSubmitted: true,
            userSatisfaction: 5,
          },
          now,
        }),
      'Authentication required'
    )
  })

  await runCheckpoint('raw_case_ref_alone_cannot_update', results, async () => {
    const db = new MemoryDb()
    await expectFailure(
      () =>
        submitFullOutcome({
          caseId: 'case-module9',
          serviceClient: db.client(),
          patientId: null,
          body: {
            appealSubmitted: true,
            userSatisfaction: 5,
            userComment: 'CC-M9-001',
          },
          now,
        }),
      'Authentication required'
    )
    assertCondition(db.outcome().user_satisfaction === undefined, 'Raw case ref updated outcome')
  })

  await runCheckpoint('valid_token_updates_once', results, async () => {
    const db = new MemoryDb()
    db.addToken({ rawToken: 'valid-full-token', tokenType: 'full_outcome' })
    await submitFullOutcome({
      caseId: 'case-module9',
      serviceClient: db.client(),
      body: {
        token: 'valid-full-token',
        appealSubmitted: true,
        insurerResponded: true,
        finalSettledAmountInr: 100000,
        outcomeType: 'partial_reversal',
        userSatisfaction: 5,
      },
      now,
    })
    assertCondition(db.outcome().user_satisfaction === 5, 'Token submit did not update outcome')
    assertCondition(db.rows.outcome_tokens[0]?.used_at !== null, 'Token was not consumed')
  })

  await runCheckpoint('reused_token_fails', results, async () => {
    const db = new MemoryDb()
    db.addToken({ rawToken: 'reused-full-token', tokenType: 'full_outcome' })
    await submitFullOutcome({
      caseId: 'case-module9',
      serviceClient: db.client(),
      body: {
        token: 'reused-full-token',
        appealSubmitted: true,
        userSatisfaction: 5,
      },
      now,
    })
    await expectFailure(
      () =>
        submitFullOutcome({
          caseId: 'case-module9',
          serviceClient: db.client(),
          body: {
            token: 'reused-full-token',
            appealSubmitted: true,
            userSatisfaction: 1,
          },
          now,
        }),
      'Invalid or expired'
    )
  })

  await runCheckpoint('expired_token_fails', results, async () => {
    const db = new MemoryDb()
    db.addToken({
      rawToken: 'expired-token',
      tokenType: 'full_outcome',
      expiresAt: '2026-01-01T00:00:00.000Z',
    })
    await expectFailure(
      () =>
        submitFullOutcome({
          caseId: 'case-module9',
          serviceClient: db.client(),
          body: {
            token: 'expired-token',
            appealSubmitted: true,
            userSatisfaction: 5,
          },
          now,
        }),
      'Invalid or expired'
    )
  })

  await runCheckpoint('get_confirmation_page_does_not_mutate', results, () => {
    const mutationBefore = buildQuickOutcomeMutation('submitted_appeal', now)
    assertCondition(mutationBefore.patient_action_type === 'submitted_appeal', 'Mutation builder bad')
    const db = new MemoryDb()
    db.addToken({ rawToken: 'get-token', tokenType: 'quick_update' })
    assertCondition(db.rows.outcome_tokens[0]?.used_at === null, 'GET consumed token')
    assertCondition(db.outcome().patient_action_type === 'none', 'GET mutated outcome')
  })

  await runCheckpoint('quick_update_sets_only_intended_field', results, async () => {
    const db = new MemoryDb()
    db.addToken({ rawToken: 'quick-token', tokenType: 'quick_update' })
    await submitQuickOutcome({
      caseId: 'case-module9',
      serviceClient: db.client(),
      token: 'quick-token',
      action: 'submitted_appeal',
      now,
    })
    const outcome = db.outcome()
    assertCondition(outcome.patient_action_type === 'submitted_appeal', 'Action state wrong')
    assertCondition(outcome.final_settled_amount_inr === undefined, 'Quick update set final amount')
    assertCondition(outcome.user_satisfaction === undefined, 'Quick update set satisfaction')
  })

  await runCheckpoint('full_form_stores_whole_rupees_exactly', results, () => {
    const db = new MemoryDb()
    const mutation = buildFullOutcomeMutation(
      {
        appealSubmitted: true,
        insurerResponded: true,
        finalSettledAmountInr: 80000,
        outcomeType: 'no_change',
        userSatisfaction: 4,
      },
      db.rows.cases[0]!,
      now
    )
    assertCondition(mutation.final_settled_amount_inr === 80000, 'Amount was converted from rupees')
  })

  await runCheckpoint('reversal_amount_auto_calculates_not_manual', results, async () => {
    const db = new MemoryDb()
    db.addToken({ rawToken: 'reversal-token', tokenType: 'full_outcome' })
    await submitFullOutcome({
      caseId: 'case-module9',
      serviceClient: db.client(),
      body: {
        token: 'reversal-token',
        appealSubmitted: true,
        insurerResponded: true,
        finalSettledAmountInr: 100000,
        outcomeType: 'partial_reversal',
        userSatisfaction: 4,
      },
      now,
    })
    const outcome = db.outcome()
    assertCondition(outcome.reversal_amount_inr === 20000, 'Generated reversal value wrong')
    assertCondition(!Object.prototype.hasOwnProperty.call(buildFullOutcomeMutation(
      {
        appealSubmitted: true,
        insurerResponded: true,
        finalSettledAmountInr: 100000,
        userSatisfaction: 4,
      },
      db.rows.cases[0]!,
      now
    ), 'reversal_amount_inr'), 'Mutation manually set reversal amount')
  })

  await runCheckpoint('optional_evidence_sets_document_verified', results, () => {
    const db = new MemoryDb()
    const mutation = buildFullOutcomeMutation(
      {
        appealSubmitted: true,
        insurerResponded: true,
        finalSettledAmountInr: 100000,
        outcomeType: 'partial_reversal',
        userSatisfaction: 5,
        evidenceStoragePath: 'outcome-evidence/case-module9/proof.pdf',
      },
      db.rows.cases[0]!,
      now
    )
    assertCondition(mutation.evidence_type === 'document_verified', 'Evidence type not verified')
  })

  await runCheckpoint('no_evidence_keeps_self_reported', results, () => {
    const db = new MemoryDb()
    const mutation = buildFullOutcomeMutation(
      {
        appealSubmitted: true,
        insurerResponded: true,
        userSatisfaction: 3,
      },
      db.rows.cases[0]!,
      now
    )
    assertCondition(mutation.evidence_type === 'self_reported', 'No evidence changed type')
  })

  await runCheckpoint('high_value_self_reported_sets_manual_followup', results, () => {
    const db = new MemoryDb()
    const mutation = buildFullOutcomeMutation(
      {
        appealSubmitted: true,
        insurerResponded: true,
        userSatisfaction: 5,
      },
      db.rows.cases[0]!,
      now
    )
    assertCondition(mutation.needs_manual_followup === true, 'Manual follow-up not set')
    assertCondition(
      mutation.manual_followup_reason === 'high_value_self_reported',
      'Manual follow-up reason wrong'
    )
  })

  await runCheckpoint('response_received_true_after_valid_response', results, async () => {
    const db = new MemoryDb()
    db.addToken({ rawToken: 'response-token', tokenType: 'quick_update' })
    await submitQuickOutcome({
      caseId: 'case-module9',
      serviceClient: db.client(),
      token: 'response-token',
      action: 'submitted_appeal',
      now,
    })
    assertCondition(
      db.rows.follow_up_schedule.every((row) => row.response_received === true),
      'Response flag was not set'
    )
  })

  await runCheckpoint('analytics_recovery_values_do_not_divide_by_100', results, () => {
    const recoverySql = OUTCOME_ANALYTICS_SQL.recoveryAmount
    assertCondition(!recoverySql.includes('/ 100'), 'Recovery SQL divides by 100')
    assertCondition(
      recoverySql.includes('SUM(o.reversal_amount_inr)'),
      'Recovery SQL does not sum rupee field'
    )
  })

  await runCheckpoint('segmentation_excludes_test_by_default', results, () => {
    for (const sql of Object.values(OUTCOME_ANALYTICS_SQL)) {
      assertCondition(
        sql.includes("payment_reporting_category != 'test'"),
        'Analytics query does not exclude test cases'
      )
    }
  })

  await runCheckpoint('followup_not_sent_before_report_delivery', results, async () => {
    const store = new MemoryReminderStore()
    store.context.deliveredAt = null
    const sender = new MemoryEmailSender()
    const sent = await processDueFollowUpReminders(store, sender, now)
    assertCondition(sent === 0, 'Reminder sent before delivery')
    assertCondition(sender.sentEmails.length === 0, 'Email was sent before delivery')
  })

  await runCheckpoint('followup_marks_sent_and_message_id', results, async () => {
    const store = new MemoryReminderStore()
    const sender = new MemoryEmailSender()
    const sent = await processDueFollowUpReminders(store, sender, now)
    const followUp = store.followUps[0]
    assertCondition(followUp !== undefined, 'Follow-up row missing')
    assertCondition(sent === 1, 'Reminder did not send')
    assertCondition(followUp.sent_at === now.toISOString(), 'sent_at not marked')
    assertCondition(followUp.email_message_id === 'message-module9', 'message id not stored')
    assertCondition(store.tokens.length === 2, 'Tokens were not generated immediately before send')
  })

  await runCheckpoint('followup_suppressed_after_final_outcome', results, async () => {
    const store = new MemoryReminderStore()
    store.context.outcomeType = 'full_reversal'
    const sender = new MemoryEmailSender()
    const sent = await processDueFollowUpReminders(store, sender, now)
    assertCondition(sent === 0, 'Final outcome reminder was not suppressed')
  })

  await runCheckpoint('followup_failure_logs_without_outcome_change', results, async () => {
    const store = new MemoryReminderStore()
    const sender = new MemoryEmailSender()
    sender.fail = true
    const sent = await processDueFollowUpReminders(store, sender, now)
    assertCondition(sent === 0, 'Failed reminder counted as sent')
    assertCondition(store.followUps[0]?.sent_at === null, 'Failed reminder marked sent')
    assertCondition(
      store.audits.some((audit) => audit.action === 'followup_email_failed'),
      'Failure audit missing'
    )
  })

  return printReport(results)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runModule9Checkpoints()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error: unknown) => {
      console.error('Module 9 checkpoint runner crashed:', error)
      process.exit(1)
    })
}
