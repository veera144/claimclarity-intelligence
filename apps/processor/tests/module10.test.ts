/**
 * @file module10.test.ts
 * @module processor/tests
 *
 * Executable Module 10 operations, monitoring, analytics, and pilot admin checkpoints.
 */

import { pathToFileURL } from 'node:url'

import type { DbClient, Json } from '@claimclarity/db'
import { MODULE10_PRODUCT_ANALYTICS_SQL, MODULE10_SEGMENTATION_SQL } from '@claimclarity/db'
import { scrubSentryEvent, trackSentryErrorBurst } from '@claimclarity/shared/sentry'

import { isAdminActor } from '../../dashboard/lib/ops/admin'
import { safeMetadata } from '../../dashboard/lib/ops/redaction'
import {
  startCaseReview,
  type ReviewActor,
  type ReviewCase,
  type ReviewEscalation,
  type ReviewFinding,
  type ReviewStore,
} from '../../dashboard/lib/review/workflow'
import { submitQuickOutcome } from '../../web/lib/outcomes/outcome-service'
import type { EmailSender, ReportReadyEmail } from '../src/jobs/reportGenerationJob'
import { getProcessorHealth } from '../src/health'
import {
  runSlaMonitor,
  runStaleProcessingJobMonitor,
  type SlaCaseRow,
  type SlaMonitorStore,
  type StaleJobMonitorStore,
  type StaleJobRow,
} from '../src/ops/sla-monitor'
import {
  processDueFollowUpReminders,
  type FollowUpReminderStore,
} from '../src/outcomes/follow-up-reminders'

type CheckpointName =
  | 'sla_warning_behavior'
  | 'sla_breach_behavior'
  | 'idempotent_monitor_behavior'
  | 'followup_email_dispatch_rules'
  | 'no_followup_before_delivery'
  | 'failed_reminder_retry_behavior'
  | 'stale_processing_job_monitor'
  | 'health_degraded_status'
  | 'admin_audit_access_allowed'
  | 'non_admin_patient_audit_access_denied'
  | 'reviewer_cannot_see_unassigned_cases'
  | 'dashboard_redaction_checks'
  | 'analytics_whole_rupee_recovery'
  | 'test_simulated_cases_excluded_by_default'
  | 'outcome_token_authorization_regression'
  | 'payment_segmentation_regression'

type CheckpointResult = { pass: boolean; detail?: string }

const CHECKPOINTS: readonly CheckpointName[] = [
  'sla_warning_behavior',
  'sla_breach_behavior',
  'idempotent_monitor_behavior',
  'followup_email_dispatch_rules',
  'no_followup_before_delivery',
  'failed_reminder_retry_behavior',
  'stale_processing_job_monitor',
  'health_degraded_status',
  'admin_audit_access_allowed',
  'non_admin_patient_audit_access_denied',
  'reviewer_cannot_see_unassigned_cases',
  'dashboard_redaction_checks',
  'analytics_whole_rupee_recovery',
  'test_simulated_cases_excluded_by_default',
  'outcome_token_authorization_regression',
  'payment_segmentation_regression',
]

type FollowUpRow = {
  id: string
  case_id: string
  sequence_number: 1 | 2 | 3
  scheduled_at: string
  sent_at: string | null
  email_message_id: string | null
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

class MemoryEmailSender implements EmailSender {
  public readonly sentEmails: ReportReadyEmail[] = []
  public fail = false

  public send(input: ReportReadyEmail): Promise<{ id: string }> {
    if (this.fail) return Promise.reject(new Error('Resend unavailable'))
    this.sentEmails.push(input)
    return Promise.resolve({ id: `message-${String(this.sentEmails.length)}` })
  }
}

class MemorySlaStore implements SlaMonitorStore {
  public readonly notifications: Array<{ type: string; caseId: string }> = []
  public readonly audits: Array<{ action: string; caseId: string }> = []
  public readonly patients = new Map([['patient-1', 'patient@example.com']])

  public constructor(public readonly cases: SlaCaseRow[]) {}

  public listSlaCases(): Promise<SlaCaseRow[]> {
    return Promise.resolve(this.cases.filter((caseRow) => caseRow.sla_breached !== true))
  }

  public markSlaWarning(caseId: string): Promise<boolean> {
    const row = this.cases.find((caseRow) => caseRow.id === caseId)
    if (!row || row.sla_warning_sent === true || row.sla_breached === true) return Promise.resolve(false)
    row.sla_warning_sent = true
    return Promise.resolve(true)
  }

  public markSlaBreached(caseId: string): Promise<boolean> {
    const row = this.cases.find((caseRow) => caseRow.id === caseId)
    if (!row || row.sla_breached === true) return Promise.resolve(false)
    row.sla_breached = true
    return Promise.resolve(true)
  }

  public insertNotification(input: { notificationType: string; caseId: string }): Promise<void> {
    this.notifications.push({ type: input.notificationType, caseId: input.caseId })
    return Promise.resolve()
  }

  public loadPatientEmail(patientId: string): Promise<string | null> {
    return Promise.resolve(this.patients.get(patientId) ?? null)
  }

  public insertAudit(input: { action: string; caseId: string }): Promise<void> {
    this.audits.push(input)
    return Promise.resolve()
  }
}

class MemoryFollowUpStore implements FollowUpReminderStore {
  public readonly audits: Array<{ action: string; caseId: string }> = []
  public readonly tokens: Array<{ caseId: string; tokenType: string }> = []
  public deliveredAt: string | null = '2026-01-01T00:00:00.000Z'
  public outcomeType: string | null = 'pending'
  public rows: FollowUpRow[] = [
    {
      id: 'followup-1',
      case_id: 'case-1',
      sequence_number: 1,
      scheduled_at: '2026-02-01T00:00:00.000Z',
      sent_at: null,
      email_message_id: null,
    },
  ]

  public listDueFollowUps(): Promise<FollowUpRow[]> {
    return Promise.resolve(this.rows.filter((row) => row.sent_at === null))
  }

  public loadContext(): Promise<{
    caseRef: string
    patientEmail: string
    deliveredAt: string | null
    caseStatus: string
    outcomeType: string | null
    patientActionType: string | null
  }> {
    return Promise.resolve({
      caseRef: 'CC-2026-0001',
      patientEmail: 'patient@example.com',
      deliveredAt: this.deliveredAt,
      caseStatus: 'delivered',
      outcomeType: this.outcomeType,
      patientActionType: 'none',
    })
  }

  public markSent(input: { scheduleId: string; sentAt: string; emailMessageId: string }): Promise<void> {
    const row = this.rows.find((followUp) => followUp.id === input.scheduleId)
    assertCondition(row !== undefined, 'Follow-up row missing')
    row.sent_at = input.sentAt
    row.email_message_id = input.emailMessageId
    return Promise.resolve()
  }

  public insertAudit(input: { action: string; caseId: string }): Promise<void> {
    this.audits.push(input)
    return Promise.resolve()
  }

  public generateToken(caseId: string, tokenType: 'quick_update' | 'full_outcome'): Promise<string> {
    this.tokens.push({ caseId, tokenType })
    return Promise.resolve(`${tokenType}-token`)
  }
}

class MemoryStaleStore implements StaleJobMonitorStore {
  public readonly notifications: string[] = []
  public readonly audits: string[] = []

  public constructor(public readonly jobs: StaleJobRow[]) {}

  public listStaleRunningJobs(): Promise<StaleJobRow[]> {
    return Promise.resolve(this.jobs)
  }

  public markStaleJobFailed(input: { jobId: string }): Promise<boolean> {
    const job = this.jobs.find((row) => row.id === input.jobId)
    if (!job) return Promise.resolve(false)
    this.jobs.splice(this.jobs.indexOf(job), 1)
    return Promise.resolve(true)
  }

  public loadAssignedReviewer(): Promise<{ caseRef: string; reviewerId: string | null }> {
    return Promise.resolve({ caseRef: 'CC-2026-0001', reviewerId: 'reviewer-1' })
  }

  public insertNotification(input: { caseId: string }): Promise<void> {
    this.notifications.push(input.caseId)
    return Promise.resolve()
  }

  public insertAudit(input: { action: string }): Promise<void> {
    this.audits.push(input.action)
    return Promise.resolve()
  }
}

class MinimalReviewStore implements ReviewStore {
  public readCase(): Promise<ReviewCase | null> {
    return Promise.resolve(null)
  }
  public listFindings(): Promise<ReviewFinding[]> {
    return Promise.resolve([])
  }
  public listOpenEscalations(): Promise<ReviewEscalation[]> {
    return Promise.resolve([])
  }
  public reportExists(): Promise<boolean> {
    return Promise.resolve(true)
  }
  public readFinding(): Promise<null> {
    return Promise.resolve(null)
  }
  public readEscalation(): Promise<ReviewEscalation | null> {
    return Promise.resolve(null)
  }
  public updateCase(): Promise<void> {
    return Promise.resolve()
  }
  public updateFinding(): Promise<void> {
    return Promise.resolve()
  }
  public insertEscalation(): Promise<string> {
    return Promise.resolve('escalation-1')
  }
  public updateEscalation(): Promise<void> {
    return Promise.resolve()
  }
  public insertNotification(): Promise<void> {
    return Promise.resolve()
  }
  public insertAudit(): Promise<void> {
    return Promise.resolve()
  }
  public signOffReport(): Promise<void> {
    return Promise.resolve()
  }
  public queueReportGeneration(): Promise<void> {
    return Promise.resolve()
  }
}

function unassignedReviewStore(): ReviewStore {
  return Object.assign(new MinimalReviewStore(), {
    readCase: () =>
      Promise.resolve({
        id: 'case-1',
        case_ref: 'CC-2026-0001',
        status: 'ai_draft_ready',
        assigned_reviewer_id: 'reviewer-2',
        assigned_expert_id: null,
        ai_draft: toJson({ appeal_points: [] }),
        insurer_name: null,
        claim_amount_inr: null,
        confidence_overall: null,
        sla_deadline: null,
        sla_breached: false,
      }),
  })
}

function healthDb(counts: { queued: number; running: number; failed: number }): DbClient {
  return {
    from: () => ({
      select: () => ({
        eq: (_field: string, value: string) => ({
          gte: () =>
            Promise.resolve({
              count: value === 'failed' ? counts.failed : 0,
              error: null,
            }),
          then: <TResult1>(
            onfulfilled?: ((value: { count: number; error: null }) => TResult1 | PromiseLike<TResult1>) | null
          ) =>
            Promise.resolve({
              count: value === 'queued' ? counts.queued : value === 'running' ? counts.running : counts.failed,
              error: null,
            }).then(onfulfilled),
        }),
      }),
    }),
  } as unknown as DbClient
}

function noTokenOutcomeDb(): DbClient {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data:
                table === 'cases'
                  ? {
                      id: 'case-1',
                      case_ref: 'CC-2026-0001',
                      patient_id: 'patient-1',
                      status: 'delivered',
                      claim_amount_inr: 250000,
                      original_approved_inr: 80000,
                      originally_deducted_inr: 20000,
                    }
                  : null,
              error: null,
            }),
        }),
      }),
    }),
  } as unknown as DbClient
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
  console.log('\nMODULE 10 CHECKPOINT REPORT')
  console.log('===========================')
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

export async function runModule10Checkpoints(): Promise<number> {
  const results: Partial<Record<CheckpointName, CheckpointResult>> = {}
  const now = new Date('2026-01-01T20:00:00.000Z')

  await runCheckpoint('sla_warning_behavior', results, async () => {
    const store = new MemorySlaStore([
      {
        id: 'case-warning',
        case_ref: 'CC-2026-0001',
        patient_id: 'patient-1',
        assigned_reviewer_id: 'reviewer-1',
        sla_deadline: new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString(),
        sla_warning_sent: false,
        sla_breached: false,
      },
    ])
    const summary = await runSlaMonitor(store, new MemoryEmailSender(), now)
    assertCondition(summary.warningsSent === 1, 'SLA warning did not fire')
    assertCondition(store.cases[0]?.sla_warning_sent === true, 'Warning flag not set')
    assertCondition(store.notifications.some((item) => item.type === 'sla_warning'), 'Warning notification missing')
  })

  await runCheckpoint('sla_breach_behavior', results, async () => {
    const store = new MemorySlaStore([
      {
        id: 'case-breach',
        case_ref: 'CC-2026-0002',
        patient_id: 'patient-1',
        assigned_reviewer_id: 'reviewer-1',
        sla_deadline: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
        sla_warning_sent: false,
        sla_breached: false,
      },
    ])
    const sender = new MemoryEmailSender()
    const summary = await runSlaMonitor(store, sender, now)
    assertCondition(summary.breachesSent === 1, 'SLA breach did not fire')
    assertCondition(store.cases[0]?.sla_breached === true, 'Breach flag not set')
    assertCondition(store.audits.some((audit) => audit.action === 'sla_breached'), 'Breach audit missing')
    assertCondition(sender.sentEmails.length === 2, 'Admin and patient emails were not sent')
  })

  await runCheckpoint('idempotent_monitor_behavior', results, async () => {
    const store = new MemorySlaStore([
      {
        id: 'case-once',
        case_ref: 'CC-2026-0003',
        patient_id: 'patient-1',
        assigned_reviewer_id: 'reviewer-1',
        sla_deadline: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
        sla_warning_sent: false,
        sla_breached: false,
      },
    ])
    await runSlaMonitor(store, new MemoryEmailSender(), now)
    await runSlaMonitor(store, new MemoryEmailSender(), now)
    assertCondition(
      store.notifications.filter((item) => item.type === 'sla_warning').length === 1,
      'Duplicate SLA warning notification inserted'
    )
  })

  await runCheckpoint('followup_email_dispatch_rules', results, async () => {
    const store = new MemoryFollowUpStore()
    const sender = new MemoryEmailSender()
    const sent = await processDueFollowUpReminders(store, sender, now)
    const followUp = store.rows[0]
    assertCondition(followUp !== undefined, 'Follow-up row missing')
    assertCondition(sent === 1, 'Due follow-up was not sent')
    assertCondition(followUp.sent_at === now.toISOString(), 'sent_at not set')
    assertCondition(followUp.email_message_id === 'message-1', 'email_message_id not set')
  })

  await runCheckpoint('no_followup_before_delivery', results, async () => {
    const store = new MemoryFollowUpStore()
    store.deliveredAt = null
    const sender = new MemoryEmailSender()
    const sent = await processDueFollowUpReminders(store, sender, now)
    assertCondition(sent === 0, 'Follow-up sent before report delivery')
    assertCondition(sender.sentEmails.length === 0, 'Email sent before report delivery')
  })

  await runCheckpoint('failed_reminder_retry_behavior', results, async () => {
    const store = new MemoryFollowUpStore()
    const sender = new MemoryEmailSender()
    sender.fail = true
    const failed = await processDueFollowUpReminders(store, sender, now)
    assertCondition(failed === 0, 'Failed send counted as sent')
    const followUp = store.rows[0]
    assertCondition(followUp !== undefined, 'Follow-up row missing')
    assertCondition(followUp.sent_at === null, 'Failed reminder marked sent')
    sender.fail = false
    const retried = await processDueFollowUpReminders(store, sender, now)
    assertCondition(retried === 1, 'Retry did not send reminder')
  })

  await runCheckpoint('health_degraded_status', results, async () => {
    const health = await getProcessorHealth({ db: healthDb({ queued: 3, running: 1, failed: 6 }) })
    assertCondition(health.status === 'degraded', 'Health did not degrade after failed job threshold')
    assertCondition(health.checks.jobQueue.queued === 3, 'Queued count wrong')
    assertCondition(health.checks.jobQueue.running === 1, 'Running count wrong')
  })

  await runCheckpoint('admin_audit_access_allowed', results, () => {
    assertCondition(isAdminActor({ id: 'admin-1', role: 'admin' }), 'Admin actor rejected')
  })

  await runCheckpoint('non_admin_patient_audit_access_denied', results, () => {
    assertCondition(!isAdminActor({ id: 'reviewer-1', role: 'reviewer' }), 'Reviewer allowed')
    assertCondition(!isAdminActor({ id: 'patient-1', role: 'patient' } as unknown as ReviewActor), 'Patient allowed')
  })

  await runCheckpoint('reviewer_cannot_see_unassigned_cases', results, async () => {
    await expectFailure(
      () => startCaseReview({ id: 'reviewer-1', role: 'reviewer' }, unassignedReviewStore(), 'case-1'),
      'not assigned'
    )
  })

  await runCheckpoint('dashboard_redaction_checks', results, () => {
    const metadata = safeMetadata(
      toJson({
        case_ref: 'CC-2026-0001',
        patient_email: 'patient@example.com',
        raw_ocr_text: 'document text',
        token_hash: 'secret',
        email_message_id: 'message-1',
      })
    )
    assertCondition(metadata.case_ref === 'CC-2026-0001', 'Safe case_ref removed')
    assertCondition(!('patient_email' in metadata), 'Patient email leaked')
    assertCondition(!('raw_ocr_text' in metadata), 'OCR text leaked')
    const sentry = scrubSentryEvent({
      case_id: 'case-1',
      patient_email: 'patient@example.com',
      prompt: 'AI prompt',
      signed_url: 'https://signed.example',
    })
    assertCondition(sentry.case_id === 'case-1', 'Safe Sentry case_id removed')
    assertCondition(sentry.patient_email === '[Filtered]', 'Sentry email not scrubbed')
    assertCondition(sentry.prompt === '[Filtered]', 'Sentry prompt not scrubbed')
    assertCondition(sentry.signed_url === '[Filtered]', 'Sentry signed URL not scrubbed')
    const alertEvents = [0, 1, 2, 3].map((offset) =>
      trackSentryErrorBurst({ message: 'RepeatedError' }, new Date(now.getTime() + offset))
    )
    assertCondition(alertEvents[3]?.shouldAlert === true, 'Sentry burst alert did not arm')
  })

  await runCheckpoint('analytics_whole_rupee_recovery', results, () => {
    const sql = MODULE10_PRODUCT_ANALYTICS_SQL.recoveryAmount
    assertCondition(sql.includes('SUM(o.reversal_amount_inr)'), 'Recovery SQL does not sum rupee field')
    assertCondition(!sql.includes('/ 100'), 'Recovery SQL divides whole-rupee outcomes')
  })

  await runCheckpoint('test_simulated_cases_excluded_by_default', results, () => {
    for (const sql of Object.values(MODULE10_PRODUCT_ANALYTICS_SQL)) {
      assertCondition(
        sql.includes("c.payment_reporting_category != 'test'"),
        'Product proof SQL does not exclude test cases'
      )
    }
  })

  await runCheckpoint('outcome_token_authorization_regression', results, async () => {
    await expectFailure(
      () =>
        submitQuickOutcome({
          caseId: 'case-1',
          serviceClient: noTokenOutcomeDb(),
          action: 'submitted_appeal',
          now,
        }),
      'Authentication required'
    )
  })

  await runCheckpoint('payment_segmentation_regression', results, () => {
    assertCondition(
      MODULE10_SEGMENTATION_SQL.casePaymentSegmentation.includes('payment_reporting_category'),
      'Case segmentation missing payment reporting category'
    )
    assertCondition(
      MODULE10_SEGMENTATION_SQL.paymentRevenueSegmentation.includes('payments p'),
      'Revenue segmentation is not sourced from payments'
    )
    assertCondition(
      !MODULE10_SEGMENTATION_SQL.paymentRevenueSegmentation.includes('FROM outcomes') &&
        !MODULE10_SEGMENTATION_SQL.paymentRevenueSegmentation.includes('JOIN outcomes'),
      'Revenue segmentation mixes product outcomes'
    )
  })

  await runCheckpoint('stale_processing_job_monitor', results, async () => {
    const staleStore = new MemoryStaleStore([
      {
        id: 'job-1',
        case_id: 'case-1',
        job_type: 'ocr',
        started_at: '2026-01-01T19:00:00.000Z',
        attempt_count: 1,
      },
    ])
    const result = await runStaleProcessingJobMonitor(staleStore, now)
    assertCondition(result.jobsMarkedFailed === 1, 'Stale job was not marked failed')
    assertCondition(result.notificationsInserted === 1, 'Reviewer was not notified for stale job')
  })

  return printReport(results)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runModule10Checkpoints()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error: unknown) => {
      console.error('Module 10 checkpoint runner crashed:', error)
      process.exit(1)
    })
}
