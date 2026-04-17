/**
 * @file reportGenerationJob.ts
 * @module processor/jobs
 *
 * Module 8 report generation, private storage delivery, and notification email jobs.
 *
 * DEPENDENCIES:
 *   - @claimclarity/db (service-role DB and storage)
 *   - @claimclarity/shared/constants (follow-up timing)
 *   - /apps/processor/src/reports/*.ts
 *
 * CALLED BY:
 *   - /apps/processor/tests/module8.test.ts
 *   - future processor job runner
 *
 * CALLS:
 *   - Supabase cases, reports, documents, findings, follow_up_schedule, processing_jobs
 *   - Supabase private reports storage bucket
 *   - Resend HTTP email API
 */

import { createServiceClient, type DbClient, type Json } from '@claimclarity/db'
import { FOLLOW_UP_DAYS } from '@claimclarity/shared/constants'

import {
  buildApprovedReportContent,
  type ApprovedReportCase,
  type ApprovedReportDocument,
  type ApprovedReportFinding,
  type ApprovedReportRow,
} from '../reports/approved-report-content'
import { renderReportPdfBuffer } from '../reports/report-pdf'

type ReportJobRow = {
  id: string
  case_id: string
  job_type: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'retrying' | 'cancelled'
  attempt_count: number | null
  max_attempts: number | null
}

type ApprovedRows = {
  caseRow: ApprovedReportCase
  report: ApprovedReportRow
  findings: ApprovedReportFinding[]
  documents: ApprovedReportDocument[]
}

export type ReportReadyEmail = {
  to: string
  subject: string
  html: string
  text: string
  appLink: string
}

export type EmailSender = {
  send(input: ReportReadyEmail): Promise<{ id: string }>
}

export type ReportGenerationStore = {
  readJob(jobId: string): Promise<ReportJobRow | null>
  listQueuedJobs(jobType: 'report_generation' | 'email_delivery', caseId?: string): Promise<ReportJobRow[]>
  markJobRunning(jobId: string): Promise<void>
  markJobCompleted(jobId: string, result?: Json): Promise<void>
  markJobFailed(jobId: string, message: string): Promise<void>
  markEmailJobRetry(input: {
    job: ReportJobRow
    message: string
    retryDelaySeconds: number | null
  }): Promise<void>
  loadApprovedRows(caseId: string): Promise<ApprovedRows>
  transitionApprovedToGenerating(caseId: string): Promise<void>
  uploadPdf(storagePath: string, buffer: Buffer): Promise<void>
  markDelivered(input: {
    caseId: string
    reportId: string
    reportVersion: number
    correctionOfVersion: number | null
    storagePath: string
    deliveredAt: string
  }): Promise<void>
  markGenerationFailure(caseId: string, message: string): Promise<void>
  createFollowUpSchedule(caseId: string, deliveredAt: string): Promise<number>
  queueEmailDelivery(caseId: string): Promise<void>
  loadEmailDeliveryRows(caseId: string): Promise<{
    caseRef: string
    patientEmail: string
    deliveredAt: string | null
  }>
  storeDeliveryEmailId(caseId: string, messageId: string): Promise<void>
  insertAudit(input: {
    action: string
    entityType: string
    entityId: string
    metadata?: Json
  }): Promise<void>
}

const EMAIL_RETRY_DELAYS_SECONDS = [30, 60, 120] as const
const DEFAULT_APP_URL = 'https://claimclarity.in'
const REPORT_BUCKET_NAME = 'reports'

function toJson(value: unknown): Json {
  return value as Json
}

function sanitizeFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 300)
}

function reportObjectPath(caseId: string, reportVersion: number): string {
  return `${caseId}/${String(reportVersion)}.pdf`
}

function reportStoragePath(caseId: string, reportVersion: number): string {
  return `${REPORT_BUCKET_NAME}/${reportObjectPath(caseId, reportVersion)}`
}

function storageObjectPath(storagePath: string): string {
  return storagePath.startsWith(`${REPORT_BUCKET_NAME}/`)
    ? storagePath.slice(REPORT_BUCKET_NAME.length + 1)
    : storagePath
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Required environment variable ${name} is not set`)
  return value
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL
}

function addDays(dateIso: string, days: number): string {
  const date = new Date(dateIso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString()
}

function throwIfDbError(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

function emailRetryDelay(job: ReportJobRow): number | null {
  const nextAttempt = (job.attempt_count ?? 0) + 1
  const maxAttempts = job.max_attempts ?? 3
  if (nextAttempt >= maxAttempts) return null
  return EMAIL_RETRY_DELAYS_SECONDS[Math.min(nextAttempt - 1, EMAIL_RETRY_DELAYS_SECONDS.length - 1)] ?? 120
}

/**
 * Builds the notification-only report email.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, pure formatting
 *
 * @param input - Patient destination and case reference
 * @returns HTML and text email payload with app link only
 */
export function buildReportReadyEmail(input: {
  patientEmail: string
  caseRef: string
  baseUrl?: string
}): ReportReadyEmail {
  const baseUrl = (input.baseUrl ?? appUrl()).replace(/\/$/, '')
  const appLink = `${baseUrl}/app/cases/${encodeURIComponent(input.caseRef)}/report`
  const subject = `Your ClaimClarity Report is Ready — Case ${input.caseRef}`
  const disclaimer =
    'ClaimClarity provides informational support only and is not insurance, legal, or medical advice.'

  return {
    to: input.patientEmail,
    subject,
    appLink,
    text: [
      `Your claim analysis report for Case ${input.caseRef} is ready.`,
      '',
      `View Your Report: ${appLink}`,
      '',
      'You will need to log in to download your report.',
      'This link does not expire — you can log in any time to access it.',
      '',
      disclaimer,
    ].join('\n'),
    html: [
      `<p>Your claim analysis report for Case ${input.caseRef} is ready.</p>`,
      `<p><a href="${appLink}">View Your Report</a></p>`,
      '<p>You will need to log in to download your report.</p>',
      '<p>This link does not expire — you can log in any time to access it.</p>',
      `<p>${disclaimer}</p>`,
    ].join(''),
  }
}

export class ResendHttpEmailSender implements EmailSender {
  private readonly apiKey: string
  private readonly fromEmail: string

  public constructor(input: { apiKey?: string; fromEmail?: string } = {}) {
    this.apiKey = input.apiKey ?? getRequiredEnv('RESEND_API_KEY')
    this.fromEmail = input.fromEmail ?? getRequiredEnv('RESEND_FROM_EMAIL')
  }

  /**
   * Sends a report-ready notification through Resend.
   *
   * SIDE EFFECTS: calls Resend email API
   * THROWS: Error when Resend rejects or returns no message id
   * IDEMPOTENT: no, each success sends an email
   *
   * @param input - Notification-only email payload
   * @returns Resend message id
   */
  public async send(input: ReportReadyEmail): Promise<{ id: string }> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.fromEmail,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    })

    if (!response.ok) {
      throw new Error(`Resend send failed with status ${String(response.status)}`)
    }

    const payload = (await response.json()) as { id?: unknown }
    if (typeof payload.id !== 'string' || payload.id.length === 0) {
      throw new Error('Resend returned no message id')
    }

    return { id: payload.id }
  }
}

/**
 * Creates a Supabase-backed Module 8 store.
 *
 * SIDE EFFECTS: reads service-role environment when no client is supplied
 * THROWS: Error when required environment variables are missing
 * IDEMPOTENT: yes, factory only
 *
 * @param client - Optional Supabase client used by tests
 * @returns ReportGenerationStore backed by Supabase
 */
export function createSupabaseReportGenerationStore(
  client: DbClient = createServiceClient()
): ReportGenerationStore {
  return {
    async readJob(jobId: string): Promise<ReportJobRow | null> {
      const { data, error } = await client
        .from('processing_jobs')
        .select('id, case_id, job_type, status, attempt_count, max_attempts')
        .eq('id', jobId)
        .maybeSingle()
      throwIfDbError(error)
      return data as ReportJobRow | null
    },

    async listQueuedJobs(
      jobType: 'report_generation' | 'email_delivery',
      caseId?: string
    ): Promise<ReportJobRow[]> {
      let query = client
        .from('processing_jobs')
        .select('id, case_id, job_type, status, attempt_count, max_attempts')
        .eq('job_type', jobType)
        .eq('status', 'queued')
        .order('queued_at', { ascending: true })

      if (caseId) query = query.eq('case_id', caseId)

      const { data, error } = await query
      throwIfDbError(error)
      return data as ReportJobRow[]
    },

    async markJobRunning(jobId: string): Promise<void> {
      const { error } = await client
        .from('processing_jobs')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('id', jobId)
      throwIfDbError(error)
    },

    async markJobCompleted(jobId: string, result?: Json): Promise<void> {
      const { error } = await client
        .from('processing_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          result: result ?? null,
          error_message: null,
        })
        .eq('id', jobId)
      throwIfDbError(error)
    },

    async markJobFailed(jobId: string, message: string): Promise<void> {
      const { error } = await client
        .from('processing_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: message,
        })
        .eq('id', jobId)
      throwIfDbError(error)
    },

    async markEmailJobRetry(input): Promise<void> {
      const nextAttempt = (input.job.attempt_count ?? 0) + 1
      const retryAt =
        input.retryDelaySeconds === null
          ? null
          : new Date(Date.now() + input.retryDelaySeconds * 1000).toISOString()
      const { error } = await client
        .from('processing_jobs')
        .update({
          status: input.retryDelaySeconds === null ? 'failed' : 'retrying',
          attempt_count: nextAttempt,
          error_message: input.message,
          completed_at: input.retryDelaySeconds === null ? new Date().toISOString() : null,
          next_retry_at: retryAt,
        })
        .eq('id', input.job.id)
      throwIfDbError(error)
    },

    async loadApprovedRows(caseId: string): Promise<ApprovedRows> {
      const [caseResult, reportResult, findingsResult, documentsResult] = await Promise.all([
        client
          .from('cases')
          .select(
            'id, case_ref, status, patient_id, insurer_name, claim_amount_inr, is_partial_report, partial_reason, ai_draft'
          )
          .eq('id', caseId)
          .single(),
        client
          .from('reports')
          .select(
            'id, case_id, report_version, is_partial, partial_reason, pdf_storage_path, signed_off_by, signed_off_at, delivered_at, correction_of_version'
          )
          .eq('case_id', caseId)
          .single(),
        client
          .from('findings')
          .select(
            'id, finding_type, bill_line_item, bill_amount_inr, clause_reference, operative_reason, plain_language_explanation, confidence_label, appeal_strength, appeal_basis, reviewer_confirmed, reviewer_unassessable, sort_order'
          )
          .eq('case_id', caseId)
          .order('sort_order', { ascending: true }),
        client
          .from('documents')
          .select('doc_type, is_required, quality_status, ocr_status')
          .eq('case_id', caseId),
      ])

      throwIfDbError(caseResult.error)
      throwIfDbError(reportResult.error)
      throwIfDbError(findingsResult.error)
      throwIfDbError(documentsResult.error)

      return {
        caseRow: caseResult.data as ApprovedReportCase,
        report: reportResult.data as ApprovedReportRow,
        findings: findingsResult.data as ApprovedReportFinding[],
        documents: documentsResult.data as ApprovedReportDocument[],
      }
    },

    async transitionApprovedToGenerating(caseId: string): Promise<void> {
      const { data, error } = await client
        .from('cases')
        .update({
          status: 'generating_report',
          current_step: 'report_generation',
          updated_at: new Date().toISOString(),
          generation_failed: false,
          generation_failure_reason: null,
        })
        .eq('id', caseId)
        .eq('status', 'approved')
        .select('id')
      throwIfDbError(error)
      if ((data ?? []).length !== 1) throw new Error('Approved case transition failed closed.')
    },

    async uploadPdf(storagePath: string, buffer: Buffer): Promise<void> {
      const { error } = await client.storage
        .from(REPORT_BUCKET_NAME)
        .upload(storageObjectPath(storagePath), buffer, {
          contentType: 'application/pdf',
          upsert: false,
        })
      throwIfDbError(error)
    },

    async markDelivered(input): Promise<void> {
      const [reportUpdate, caseUpdate] = await Promise.all([
        client
          .from('reports')
          .update({
            pdf_storage_path: input.storagePath,
            delivered_at: input.deliveredAt,
            report_version: input.reportVersion,
            correction_of_version: input.correctionOfVersion,
          })
          .eq('id', input.reportId),
        client
          .from('cases')
          .update({
            status: 'delivered',
            current_step: 'complete',
            updated_at: input.deliveredAt,
            generation_failed: false,
            generation_failure_reason: null,
          })
          .eq('id', input.caseId),
      ])
      throwIfDbError(reportUpdate.error)
      throwIfDbError(caseUpdate.error)
    },

    async markGenerationFailure(caseId: string, message: string): Promise<void> {
      const { error } = await client
        .from('cases')
        .update({
          current_step: 'failed',
          generation_failed: true,
          generation_failure_reason: message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', caseId)
      throwIfDbError(error)
    },

    async createFollowUpSchedule(caseId: string, deliveredAt: string): Promise<number> {
      const rows = FOLLOW_UP_DAYS.map((days, index) => ({
        case_id: caseId,
        sequence_number: (index + 1) as 1 | 2 | 3,
        scheduled_at: addDays(deliveredAt, days),
      }))
      const { data, error } = await client
        .from('follow_up_schedule')
        .upsert(rows, { onConflict: 'case_id,sequence_number' })
        .select('id')
      throwIfDbError(error)
      return (data ?? []).length
    },

    async queueEmailDelivery(caseId: string): Promise<void> {
      const { error } = await client.from('processing_jobs').upsert(
        {
          case_id: caseId,
          job_type: 'email_delivery',
          status: 'queued',
          idempotency_key: `email_delivery:${caseId}`,
          payload: toJson({ source: 'module8_report_delivery' }),
        },
        { onConflict: 'idempotency_key', ignoreDuplicates: true }
      )
      throwIfDbError(error)
    },

    async loadEmailDeliveryRows(caseId: string): Promise<{
      caseRef: string
      patientEmail: string
      deliveredAt: string | null
    }> {
      const { data: caseRow, error: caseError } = await client
        .from('cases')
        .select('case_ref, patient_id')
        .eq('id', caseId)
        .single()
      throwIfDbError(caseError)
      if (!caseRow) throw new Error('Email delivery case not found')

      const { data: report, error: reportError } = await client
        .from('reports')
        .select('delivered_at')
        .eq('case_id', caseId)
        .single()
      throwIfDbError(reportError)
      if (!report) throw new Error('Email delivery report not found')

      const { data: user, error: userError } = await client
        .from('users')
        .select('email')
        .eq('id', caseRow.patient_id)
        .single()
      throwIfDbError(userError)
      if (!user) throw new Error('Email delivery patient not found')

      return {
        caseRef: caseRow.case_ref,
        patientEmail: user.email,
        deliveredAt: report.delivered_at,
      }
    },

    async storeDeliveryEmailId(caseId: string, messageId: string): Promise<void> {
      const { error } = await client
        .from('reports')
        .update({ delivery_email_id: messageId })
        .eq('case_id', caseId)
      throwIfDbError(error)
    },

    async insertAudit(input): Promise<void> {
      const { error } = await client.from('audit_log').insert({
        actor_role: 'processor',
        action: input.action,
        entity_type: input.entityType,
        entity_id: input.entityId,
        metadata: input.metadata ?? null,
      })
      throwIfDbError(error)
    },
  }
}

/**
 * Runs one Module 8 report_generation job.
 *
 * SIDE EFFECTS: writes PDF to private storage, updates cases/reports/jobs, queues email job,
 * inserts follow_up_schedule rows and audit_log entries
 * THROWS: Error for invalid jobs or failed generation/upload
 * IDEMPOTENT: storage paths are versioned; completed jobs are not rerun
 *
 * @param jobId - processing_jobs id for a report_generation job
 * @param store - Optional injectable store for tests
 * @returns Delivery summary
 */
export async function runReportGenerationJob(
  jobId: string,
  store: ReportGenerationStore = createSupabaseReportGenerationStore()
): Promise<{ storagePath: string; reportVersion: number; deliveredAt: string }> {
  const job = await store.readJob(jobId)
  if (!job || job.job_type !== 'report_generation' || job.status !== 'queued') {
    throw new Error('Invalid report_generation job.')
  }

  await store.markJobRunning(job.id)

  try {
    const rows = await store.loadApprovedRows(job.case_id)
    const previousVersion = rows.report.delivered_at ? rows.report.report_version ?? 1 : null
    const nextVersion = previousVersion === null ? rows.report.report_version ?? 1 : previousVersion + 1
    const deliveredAt = new Date().toISOString()
    const content = buildApprovedReportContent({
      ...rows,
      deliveryDate: new Date(deliveredAt),
      nextReportVersion: nextVersion,
    })

    await store.transitionApprovedToGenerating(job.case_id)
    await store.insertAudit({
      action: 'report_generation_started',
      entityType: 'case',
      entityId: job.case_id,
      metadata: toJson({ report_version: nextVersion }),
    })

    const pdf = await renderReportPdfBuffer(content)
    const storagePath = reportStoragePath(job.case_id, nextVersion)
    await store.uploadPdf(storagePath, pdf)
    await store.insertAudit({
      action: 'report_pdf_generated_uploaded',
      entityType: 'case',
      entityId: job.case_id,
      metadata: toJson({ report_version: nextVersion, storage_path: storagePath }),
    })

    await store.markDelivered({
      caseId: job.case_id,
      reportId: rows.report.id,
      reportVersion: nextVersion,
      correctionOfVersion: previousVersion,
      storagePath,
      deliveredAt,
    })
    await store.insertAudit({
      action: 'case_delivered',
      entityType: 'case',
      entityId: job.case_id,
      metadata: toJson({ delivered_at: deliveredAt, report_version: nextVersion }),
    })

    const followUpRows = await store.createFollowUpSchedule(job.case_id, deliveredAt)
    await store.insertAudit({
      action: 'follow_up_schedule_created',
      entityType: 'case',
      entityId: job.case_id,
      metadata: toJson({ rows_created: followUpRows, sequences: [30, 60, 90] }),
    })

    await store.queueEmailDelivery(job.case_id)
    await store.insertAudit({
      action: 'delivery_email_queued',
      entityType: 'case',
      entityId: job.case_id,
      metadata: toJson({ idempotency_key: `email_delivery:${job.case_id}` }),
    })

    await store.markJobCompleted(
      job.id,
      toJson({ storage_path: storagePath, report_version: nextVersion })
    )
    return { storagePath, reportVersion: nextVersion, deliveredAt }
  } catch (error) {
    const message = sanitizeFailure(error)
    await store.markJobFailed(job.id, message)
    await store.markGenerationFailure(job.case_id, message).catch(() => undefined)
    await store.insertAudit({
      action: 'report_generation_failure',
      entityType: 'case',
      entityId: job.case_id,
      metadata: toJson({ reason: message }),
    }).catch(() => undefined)
    throw error
  }
}

/**
 * Processes queued Module 8 report_generation jobs.
 *
 * SIDE EFFECTS: runs report generation for queued jobs
 * THROWS: never for individual job failures
 * IDEMPOTENT: yes, only queued jobs are processed
 *
 * @param store - Optional injectable store for tests
 * @param caseId - Optional case id filter
 * @returns Number of report jobs delivered
 */
export async function processQueuedReportGenerationJobs(
  store: ReportGenerationStore = createSupabaseReportGenerationStore(),
  caseId?: string
): Promise<number> {
  const jobs = await store.listQueuedJobs('report_generation', caseId)
  let delivered = 0
  for (const job of jobs) {
    try {
      await runReportGenerationJob(job.id, store)
      delivered += 1
    } catch (error) {
      console.error('[module8] report_generation failed', sanitizeFailure(error))
    }
  }
  return delivered
}

/**
 * Runs one notification-only Module 8 email_delivery job.
 *
 * SIDE EFFECTS: sends Resend email, updates processing_jobs/reports, writes audit_log
 * THROWS: Error when email preflight or send fails
 * IDEMPOTENT: no, only queued jobs should call this
 *
 * @param jobId - processing_jobs id for email_delivery
 * @param store - Optional injectable store for tests
 * @param sender - Optional injectable email sender for tests
 * @returns Resend or mock message id
 */
export async function runEmailDeliveryJob(
  jobId: string,
  store: ReportGenerationStore = createSupabaseReportGenerationStore(),
  sender: EmailSender = new ResendHttpEmailSender()
): Promise<string> {
  const job = await store.readJob(jobId)
  if (!job || job.job_type !== 'email_delivery' || job.status !== 'queued') {
    throw new Error('Invalid email_delivery job.')
  }

  await store.markJobRunning(job.id)

  try {
    const rows = await store.loadEmailDeliveryRows(job.case_id)
    if (!rows.deliveredAt) {
      throw new Error('Email delivery requires delivered report.')
    }

    const email = buildReportReadyEmail({
      patientEmail: rows.patientEmail,
      caseRef: rows.caseRef,
    })
    const sent = await sender.send(email)
    await store.storeDeliveryEmailId(job.case_id, sent.id)
    await store.markJobCompleted(job.id, toJson({ delivery_email_id: sent.id }))
    await store.insertAudit({
      action: 'delivery_email_sent',
      entityType: 'case',
      entityId: job.case_id,
      metadata: toJson({ delivery_email_id: sent.id, app_link: email.appLink }),
    })
    return sent.id
  } catch (error) {
    const message = sanitizeFailure(error)
    const retryDelaySeconds = emailRetryDelay(job)
    await store.markEmailJobRetry({ job, message, retryDelaySeconds })
    await store.insertAudit({
      action: 'delivery_email_failed',
      entityType: 'case',
      entityId: job.case_id,
      metadata: toJson({ reason: message, will_retry: retryDelaySeconds !== null }),
    }).catch(() => undefined)
    throw error
  }
}

/**
 * Processes queued Module 8 email_delivery jobs.
 *
 * SIDE EFFECTS: sends notification emails for queued jobs
 * THROWS: never for individual email failures
 * IDEMPOTENT: no, successful sends mark jobs completed
 *
 * @param store - Optional injectable store
 * @param sender - Optional injectable email sender
 * @param caseId - Optional case id filter
 * @returns Number of emails sent
 */
export async function processQueuedEmailDeliveryJobs(
  store: ReportGenerationStore = createSupabaseReportGenerationStore(),
  sender: EmailSender = new ResendHttpEmailSender(),
  caseId?: string
): Promise<number> {
  const jobs = await store.listQueuedJobs('email_delivery', caseId)
  let sent = 0
  for (const job of jobs) {
    try {
      await runEmailDeliveryJob(job.id, store, sender)
      sent += 1
    } catch (error) {
      console.error('[module8] email_delivery failed', sanitizeFailure(error))
    }
  }
  return sent
}
