/**
 * @file sla-monitor.ts
 * @module processor/ops
 *
 * Module 10 SLA monitoring, follow-up dispatch, email retry, and stale job checks.
 *
 * DEPENDENCIES:
 *   - @claimclarity/db (service-role database client)
 *   - @claimclarity/shared/constants (SLA thresholds)
 *   - /apps/processor/src/jobs/reportGenerationJob.ts
 *   - /apps/processor/src/outcomes/follow-up-reminders.ts
 *
 * CALLED BY:
 *   - Railway cron entrypoints
 *   - /apps/processor/tests/module10.test.ts
 *
 * CALLS:
 *   - Supabase cases, users, reviewer_notifications, audit_log, processing_jobs
 */

import { createServiceClient, type DbClient, type Json } from '@claimclarity/db'
import { SLA_WARNING_HOURS } from '@claimclarity/shared/constants'

import {
  processQueuedEmailDeliveryJobs,
  ResendHttpEmailSender,
  type EmailSender,
  type ReportReadyEmail,
} from '../jobs/reportGenerationJob'
import { processDueFollowUpReminders } from '../outcomes/follow-up-reminders'

const SLA_MONITORED_STATUSES = ['processing', 'ai_draft_ready', 'under_review', 'escalated'] as const
const STALE_RUNNING_JOB_MINUTES = 30

export type SlaCaseRow = {
  id: string
  case_ref: string
  patient_id: string
  assigned_reviewer_id: string | null
  sla_deadline: string | null
  sla_warning_sent: boolean | null
  sla_breached: boolean | null
}

export type StaleJobRow = {
  id: string
  case_id: string
  job_type: string
  started_at: string | null
  attempt_count: number | null
}

export type SlaMonitorResult = {
  warningsSent: number
  breachesSent: number
  adminEmailsSent: number
  patientEmailsSent: number
}

export type StaleJobMonitorResult = {
  jobsMarkedFailed: number
  notificationsInserted: number
}

export type OpsDispatcherResult = {
  sla: SlaMonitorResult
  followUpEmailsSent: number
  failedDeliveryEmailsRetried: number
  staleJobs: StaleJobMonitorResult
}

export type SlaMonitorStore = {
  listSlaCases(now: Date): Promise<SlaCaseRow[]>
  markSlaWarning(caseId: string, now: Date): Promise<boolean>
  markSlaBreached(caseId: string, now: Date): Promise<boolean>
  insertNotification(input: {
    recipientId: string
    notificationType: 'sla_warning' | 'sla_breached' | 'processing_failed'
    caseId: string
    message: string
  }): Promise<void>
  loadPatientEmail(patientId: string): Promise<string | null>
  insertAudit(input: { action: string; caseId: string; metadata?: Json }): Promise<void>
}

export type StaleJobMonitorStore = {
  listStaleRunningJobs(cutoff: Date): Promise<StaleJobRow[]>
  markStaleJobFailed(input: { jobId: string; now: Date; message: string }): Promise<boolean>
  loadAssignedReviewer(caseId: string): Promise<{ caseRef: string; reviewerId: string | null } | null>
  insertNotification(input: {
    recipientId: string
    notificationType: 'processing_failed'
    caseId: string
    message: string
  }): Promise<void>
  insertAudit(input: { action: string; caseId: string; metadata?: Json }): Promise<void>
}

function toJson(value: unknown): Json {
  return value as Json
}

function throwIfDbError(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

function adminEmail(): string {
  return process.env.ADMIN_EMAIL || 'admin@claimclarity.in'
}

function safeEmail(input: {
  to: string
  subject: string
  body: string
}): ReportReadyEmail {
  return {
    to: input.to,
    subject: input.subject,
    appLink: '',
    text: input.body,
    html: `<p>${input.body}</p>`,
  }
}

function hoursUntil(deadline: string | null, now: Date): number | null {
  if (!deadline) return null
  return (new Date(deadline).getTime() - now.getTime()) / 3_600_000
}

function staleCutoff(now: Date): Date {
  return new Date(now.getTime() - STALE_RUNNING_JOB_MINUTES * 60_000)
}

/**
 * Creates the Supabase-backed SLA monitor store.
 *
 * SIDE EFFECTS: reads service-role environment when no client is supplied
 * THROWS: Error when required environment variables are missing
 * IDEMPOTENT: yes, factory only
 *
 * @param client - Optional service-role database client
 * @returns Store used by Module 10 SLA monitoring
 */
export function createSupabaseSlaMonitorStore(client: DbClient = createServiceClient()): SlaMonitorStore {
  return {
    async listSlaCases(): Promise<SlaCaseRow[]> {
      const { data, error } = await client
        .from('cases')
        .select(
          'id, case_ref, patient_id, assigned_reviewer_id, sla_deadline, sla_warning_sent, sla_breached'
        )
        .in('status', [...SLA_MONITORED_STATUSES])
        .eq('sla_breached', false)
        .order('sla_deadline', { ascending: true })
      throwIfDbError(error)
      return data as SlaCaseRow[]
    },

    async markSlaWarning(caseId, now): Promise<boolean> {
      const { data, error } = await client
        .from('cases')
        .update({ sla_warning_sent: true, updated_at: now.toISOString() })
        .eq('id', caseId)
        .eq('sla_warning_sent', false)
        .eq('sla_breached', false)
        .select('id')
      throwIfDbError(error)
      return (data ?? []).length === 1
    },

    async markSlaBreached(caseId, now): Promise<boolean> {
      const { data, error } = await client
        .from('cases')
        .update({ sla_breached: true, updated_at: now.toISOString() })
        .eq('id', caseId)
        .eq('sla_breached', false)
        .select('id')
      throwIfDbError(error)
      return (data ?? []).length === 1
    },

    async insertNotification(input): Promise<void> {
      const { error } = await client.from('reviewer_notifications').insert({
        recipient_id: input.recipientId,
        notification_type: input.notificationType,
        case_id: input.caseId,
        message: input.message,
      })
      throwIfDbError(error)
    },

    async loadPatientEmail(patientId): Promise<string | null> {
      const { data, error } = await client.from('users').select('email').eq('id', patientId).maybeSingle()
      throwIfDbError(error)
      return data?.email ?? null
    },

    async insertAudit(input): Promise<void> {
      const { error } = await client.from('audit_log').insert({
        actor_role: 'processor',
        action: input.action,
        entity_type: 'case',
        entity_id: input.caseId,
        metadata: input.metadata ?? null,
      })
      throwIfDbError(error)
    },
  }
}

/**
 * Creates the Supabase-backed stale job monitor store.
 *
 * SIDE EFFECTS: reads service-role environment when no client is supplied
 * THROWS: Error when required environment variables are missing
 * IDEMPOTENT: yes, factory only
 *
 * @param client - Optional service-role database client
 * @returns Store used by stale processing job monitoring
 */
export function createSupabaseStaleJobMonitorStore(
  client: DbClient = createServiceClient()
): StaleJobMonitorStore {
  return {
    async listStaleRunningJobs(cutoff): Promise<StaleJobRow[]> {
      const { data, error } = await client
        .from('processing_jobs')
        .select('id, case_id, job_type, started_at, attempt_count')
        .eq('status', 'running')
        .lte('started_at', cutoff.toISOString())
        .order('started_at', { ascending: true })
      throwIfDbError(error)
      return data as StaleJobRow[]
    },

    async markStaleJobFailed(input): Promise<boolean> {
      const { data, error } = await client
        .from('processing_jobs')
        .update({
          status: 'failed',
          completed_at: input.now.toISOString(),
          error_message: input.message,
        })
        .eq('id', input.jobId)
        .eq('status', 'running')
        .select('id')
      throwIfDbError(error)
      return (data ?? []).length === 1
    },

    async loadAssignedReviewer(caseId): Promise<{ caseRef: string; reviewerId: string | null } | null> {
      const { data, error } = await client
        .from('cases')
        .select('case_ref, assigned_reviewer_id')
        .eq('id', caseId)
        .maybeSingle()
      throwIfDbError(error)
      if (!data) return null
      return { caseRef: data.case_ref, reviewerId: data.assigned_reviewer_id }
    },

    async insertNotification(input): Promise<void> {
      const { error } = await client.from('reviewer_notifications').insert({
        recipient_id: input.recipientId,
        notification_type: input.notificationType,
        case_id: input.caseId,
        message: input.message,
      })
      throwIfDbError(error)
    },

    async insertAudit(input): Promise<void> {
      const { error } = await client.from('audit_log').insert({
        actor_role: 'processor',
        action: input.action,
        entity_type: 'case',
        entity_id: input.caseId,
        metadata: input.metadata ?? null,
      })
      throwIfDbError(error)
    },
  }
}

/**
 * Runs the 15-minute Module 10 SLA monitor.
 *
 * SIDE EFFECTS: updates cases, inserts reviewer notifications and audit rows, sends admin/patient email
 * THROWS: never for an individual case; unexpected list failures bubble to caller
 * IDEMPOTENT: yes, case flags gate duplicate warning and breach side effects
 *
 * @param store - SLA monitor store
 * @param sender - Email sender
 * @param now - Optional clock injection
 * @returns SLA monitor summary
 */
export async function runSlaMonitor(
  store: SlaMonitorStore = createSupabaseSlaMonitorStore(),
  sender: EmailSender = new ResendHttpEmailSender(),
  now: Date = new Date()
): Promise<SlaMonitorResult> {
  const result: SlaMonitorResult = {
    warningsSent: 0,
    breachesSent: 0,
    adminEmailsSent: 0,
    patientEmailsSent: 0,
  }
  const rows = await store.listSlaCases(now)

  for (const row of rows) {
    const remaining = hoursUntil(row.sla_deadline, now)
    if (remaining === null) continue

    if (remaining <= 0) {
      const marked = await store.markSlaBreached(row.id, now)
      if (!marked) continue

      if (row.assigned_reviewer_id) {
        await store.insertNotification({
          recipientId: row.assigned_reviewer_id,
          notificationType: 'sla_breached',
          caseId: row.id,
          message: `SLA breached for case ${row.case_ref}`,
        })
      }
      await store.insertAudit({
        action: 'sla_breached',
        caseId: row.id,
        metadata: toJson({ case_ref: row.case_ref, hours_remaining: remaining }),
      })
      result.breachesSent += 1

      await sender.send(
        safeEmail({
          to: adminEmail(),
          subject: `ClaimClarity SLA breach - Case ${row.case_ref}`,
          body: `SLA breached for Case ${row.case_ref}.`,
        })
      )
      result.adminEmailsSent += 1

      const patientEmail = await store.loadPatientEmail(row.patient_id)
      if (patientEmail) {
        await sender.send(
          safeEmail({
            to: patientEmail,
            subject: `Update on your ClaimClarity report - Case ${row.case_ref}`,
            body:
              'We are sorry - your report is taking longer than our 24-hour commitment. You will receive it within the next 4 hours. Questions: support@claimclarity.in',
          })
        )
        result.patientEmailsSent += 1
      }
      continue
    }

    if (remaining <= SLA_WARNING_HOURS && row.sla_warning_sent !== true) {
      const marked = await store.markSlaWarning(row.id, now)
      if (!marked) continue
      if (row.assigned_reviewer_id) {
        await store.insertNotification({
          recipientId: row.assigned_reviewer_id,
          notificationType: 'sla_warning',
          caseId: row.id,
          message: `SLA warning for case ${row.case_ref}`,
        })
      }
      await store.insertAudit({
        action: 'sla_warning_sent',
        caseId: row.id,
        metadata: toJson({ case_ref: row.case_ref, hours_remaining: remaining }),
      })
      result.warningsSent += 1
    }
  }

  return result
}

/**
 * Retries failed reminder delivery by rerunning the idempotent follow-up dispatcher.
 *
 * SIDE EFFECTS: sends eligible follow-up emails and marks sent_at only after success
 * THROWS: upstream dispatcher errors
 * IDEMPOTENT: yes, already sent rows are skipped
 *
 * @param sender - Email sender
 * @param now - Optional clock injection
 * @returns Number of retry emails sent
 */
export async function retryFailedReminderEmails(
  sender: EmailSender = new ResendHttpEmailSender(),
  now: Date = new Date()
): Promise<number> {
  return processDueFollowUpReminders(undefined, sender, now)
}

/**
 * Marks stale running processor jobs failed and notifies the assigned reviewer.
 *
 * SIDE EFFECTS: updates processing_jobs, inserts notifications and audit rows
 * THROWS: never for individual stale job failures
 * IDEMPOTENT: yes, only rows still running are marked
 *
 * @param store - Stale job monitor store
 * @param now - Optional clock injection
 * @returns Stale job monitor summary
 */
export async function runStaleProcessingJobMonitor(
  store: StaleJobMonitorStore = createSupabaseStaleJobMonitorStore(),
  now: Date = new Date()
): Promise<StaleJobMonitorResult> {
  const result = { jobsMarkedFailed: 0, notificationsInserted: 0 }
  const jobs = await store.listStaleRunningJobs(staleCutoff(now))

  for (const job of jobs) {
    const message = `Stale ${job.job_type} job exceeded ${String(STALE_RUNNING_JOB_MINUTES)} minutes.`
    try {
      const marked = await store.markStaleJobFailed({ jobId: job.id, now, message })
      if (!marked) continue
      result.jobsMarkedFailed += 1

      const assignment = await store.loadAssignedReviewer(job.case_id)
      if (assignment?.reviewerId) {
        await store.insertNotification({
          recipientId: assignment.reviewerId,
          notificationType: 'processing_failed',
          caseId: job.case_id,
          message: `Processing failed for case ${assignment.caseRef}`,
        })
        result.notificationsInserted += 1
      }

      await store.insertAudit({
        action: 'stale_processing_job_failed',
        caseId: job.case_id,
        metadata: toJson({
          job_id: job.id,
          job_type: job.job_type,
          started_at: job.started_at,
        }),
      })
    } catch (error) {
      await store
        .insertAudit({
          action: 'stale_processing_job_monitor_failed',
          caseId: job.case_id,
          metadata: toJson({
            job_id: job.id,
            reason: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
          }),
        })
        .catch(() => undefined)
    }
  }

  return result
}

/**
 * Runs all scheduled/dispatchable Module 10 operations.
 *
 * SIDE EFFECTS: delegates to SLA, follow-up, retry, email delivery, and stale job dispatchers
 * THROWS: Error when a top-level dispatcher fails before per-row handling
 * IDEMPOTENT: yes, each dispatcher is gated by durable row state
 *
 * @param now - Optional clock injection
 * @returns Operations dispatcher summary
 */
export async function runOpsDispatchers(now: Date = new Date()): Promise<OpsDispatcherResult> {
  const sender = new ResendHttpEmailSender()
  const [sla, followUpEmailsSent, failedDeliveryEmailsRetried, staleJobs] = await Promise.all([
    runSlaMonitor(undefined, sender, now),
    processDueFollowUpReminders(undefined, sender, now),
    processQueuedEmailDeliveryJobs(undefined, sender),
    runStaleProcessingJobMonitor(undefined, now),
  ])

  return { sla, followUpEmailsSent, failedDeliveryEmailsRetried, staleJobs }
}
