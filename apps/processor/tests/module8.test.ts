/**
 * @file module8.test.ts
 * @module processor/tests
 *
 * Executable Module 8 report generation and delivery checkpoints.
 */

import { pathToFileURL } from 'node:url'

import type { Json } from '@claimclarity/db'

import {
  buildReportReadyEmail,
  runEmailDeliveryJob,
  runReportGenerationJob,
  type EmailSender,
  type ReportGenerationStore,
} from '../src/jobs/reportGenerationJob'
import {
  buildApprovedReportContent,
  CANNOT_TELL_YOU_ITEMS,
  MODULE8_REQUIRED_SECTION_HEADINGS,
  type ApprovedReportCase,
  type ApprovedReportDocument,
  type ApprovedReportFinding,
  type ApprovedReportRow,
} from '../src/reports/approved-report-content'
import { getReportSearchText, renderReportPdfBuffer } from '../src/reports/report-pdf'
import {
  createReportDownloadSignedUrlFromStore,
  ReportDownloadError,
  type ReportDownloadStore,
  SIGNED_URL_TTL_SECONDS,
} from '../../web/lib/report-download'

type CheckpointName =
  | 'pdf_contains_required_sections'
  | 'fail_closed_preflight'
  | 'no_raw_ocr_or_extracted_text'
  | 'no_unreviewed_ai_output'
  | 'email_app_link_only'
  | 'unauthenticated_download_401'
  | 'wrong_patient_cannot_download'
  | 'undelivered_report_cannot_download'
  | 'signed_url_expires_about_one_hour'
  | 'follow_up_rows_30_60_90'
  | 'email_failure_preserves_delivered_state'
  | 'pdf_upload_failure_no_delivered_at'
  | 'correction_increments_version_preserves_prior_pdf'
  | 'required_audit_events_written'

type CheckpointResult = { pass: boolean; detail?: string }

const CHECKPOINTS: readonly CheckpointName[] = [
  'pdf_contains_required_sections',
  'fail_closed_preflight',
  'no_raw_ocr_or_extracted_text',
  'no_unreviewed_ai_output',
  'email_app_link_only',
  'unauthenticated_download_401',
  'wrong_patient_cannot_download',
  'undelivered_report_cannot_download',
  'signed_url_expires_about_one_hour',
  'follow_up_rows_30_60_90',
  'email_failure_preserves_delivered_state',
  'pdf_upload_failure_no_delivered_at',
  'correction_increments_version_preserves_prior_pdf',
  'required_audit_events_written',
]

type MemoryJob = {
  id: string
  case_id: string
  job_type: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'retrying' | 'cancelled'
  attempt_count: number | null
  max_attempts: number | null
  result?: Json | undefined
  error_message?: string | null
}

function toJson(value: unknown): Json {
  return value as Json
}

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function daysBetween(leftIso: string, rightIso: string): number {
  const left = new Date(leftIso).getTime()
  const right = new Date(rightIso).getTime()
  return Math.round((left - right) / 86_400_000)
}

class MemoryReportStore implements ReportGenerationStore {
  public readonly jobs = new Map<string, MemoryJob>()
  public readonly uploads = new Map<string, Buffer>()
  public readonly audits: Array<{ action: string; entityId: string; metadata?: Json }> = []
  public readonly followUps: Array<{ caseId: string; sequence: 1 | 2 | 3; scheduledAt: string }> = []
  public caseRow: ApprovedReportCase
  public report: ApprovedReportRow
  public findings: ApprovedReportFinding[]
  public documents: ApprovedReportDocument[]
  public patientEmail = 'patient@example.com'
  public failUpload = false

  public constructor() {
    const caseId = 'case-module8'
    this.caseRow = {
      id: caseId,
      case_ref: 'CC-M8-001',
      status: 'approved',
      patient_id: 'patient-a',
      insurer_name: 'Module 8 Health',
      claim_amount_inr: 125000,
      is_partial_report: false,
      partial_reason: null,
      ai_draft: toJson({
        hospital_questions: ['Please share the room category breakup.'],
        insurer_questions: ['Please explain how the room rent clause was applied.'],
        appeal_points: [
          {
            point: 'Ask for clause-wise calculation of the deduction.',
            strength: 'strong',
            basis: 'Clause 4.2',
          },
        ],
        appeal_letter_draft:
          'To the Claims Review Team,\nPlease review the deductions shown in this report.\nReference: bimabharosa.irdai.gov.in',
        scope_notes: 'RAW OCR SENTINEL SHOULD NOT APPEAR',
        provider_metadata: { input_tokens: 1000 },
      }),
    }
    this.report = {
      id: 'report-module8',
      case_id: caseId,
      report_version: 1,
      is_partial: false,
      partial_reason: null,
      pdf_storage_path: null,
      signed_off_by: 'reviewer-a',
      signed_off_at: new Date('2026-04-17T09:00:00.000Z').toISOString(),
      delivered_at: null,
      correction_of_version: null,
    }
    this.findings = [
      {
        id: 'finding-covered',
        finding_type: 'covered',
        bill_line_item: 'Nursing charges',
        bill_amount_inr: 250000,
        clause_reference: 'Clause 2.1',
        operative_reason: 'Covered under hospitalization expenses.',
        plain_language_explanation: 'This appears payable under hospitalization expenses.',
        confidence_label: 'clause_found_matched',
        appeal_strength: 'moderate',
        appeal_basis: 'Hospitalization expense clause',
        reviewer_confirmed: true,
        reviewer_unassessable: false,
        sort_order: 1,
      },
      {
        id: 'finding-deducted',
        finding_type: 'deducted',
        bill_line_item: 'Room rent',
        bill_amount_inr: 500000,
        clause_reference: 'Clause 4.2',
        operative_reason: 'Possible room rent sublimit.',
        plain_language_explanation: 'The deduction appears tied to room rent sublimit wording.',
        confidence_label: 'clause_found_matched',
        appeal_strength: 'strong',
        appeal_basis: 'Room rent sublimit calculation should be shared.',
        reviewer_confirmed: true,
        reviewer_unassessable: false,
        sort_order: 2,
      },
      {
        id: 'finding-missing',
        finding_type: 'missing_document',
        bill_line_item: 'Discharge summary',
        bill_amount_inr: null,
        clause_reference: null,
        operative_reason: null,
        plain_language_explanation: 'Discharge summary may clarify the billed stay.',
        confidence_label: 'insufficient_information',
        appeal_strength: null,
        appeal_basis: null,
        reviewer_confirmed: true,
        reviewer_unassessable: false,
        sort_order: 3,
      },
    ]
    this.documents = [
      { doc_type: 'policy', is_required: true, quality_status: 'pass', ocr_status: 'completed' },
      {
        doc_type: 'hospital_bill',
        is_required: true,
        quality_status: 'pass',
        ocr_status: 'completed',
      },
      {
        doc_type: 'insurer_response',
        is_required: true,
        quality_status: 'pass',
        ocr_status: 'completed',
      },
    ]
    this.jobs.set('report-job', {
      id: 'report-job',
      case_id: caseId,
      job_type: 'report_generation',
      status: 'queued',
      attempt_count: 0,
      max_attempts: 3,
    })
  }

  public readJob(jobId: string): Promise<MemoryJob | null> {
    return Promise.resolve(this.jobs.get(jobId) ?? null)
  }

  public listQueuedJobs(
    jobType: 'report_generation' | 'email_delivery',
    caseId?: string
  ): Promise<MemoryJob[]> {
    return Promise.resolve(
      [...this.jobs.values()].filter(
        (job) =>
          job.job_type === jobType &&
          job.status === 'queued' &&
          (!caseId || job.case_id === caseId)
      )
    )
  }

  public markJobRunning(jobId: string): Promise<void> {
    const job = this.jobs.get(jobId)
    if (!job) throw new Error('job missing')
    job.status = 'running'
    return Promise.resolve()
  }

  public markJobCompleted(jobId: string, result?: Json): Promise<void> {
    const job = this.jobs.get(jobId)
    if (!job) throw new Error('job missing')
    job.status = 'completed'
    job.result = result
    job.error_message = null
    return Promise.resolve()
  }

  public markJobFailed(jobId: string, message: string): Promise<void> {
    const job = this.jobs.get(jobId)
    if (!job) throw new Error('job missing')
    job.status = 'failed'
    job.error_message = message
    return Promise.resolve()
  }

  public markEmailJobRetry(input: {
    job: MemoryJob
    message: string
    retryDelaySeconds: number | null
  }): Promise<void> {
    input.job.attempt_count = (input.job.attempt_count ?? 0) + 1
    input.job.status = input.retryDelaySeconds === null ? 'failed' : 'retrying'
    input.job.error_message = input.message
    return Promise.resolve()
  }

  public loadApprovedRows(): Promise<{
    caseRow: ApprovedReportCase
    report: ApprovedReportRow
    findings: ApprovedReportFinding[]
    documents: ApprovedReportDocument[]
  }> {
    return Promise.resolve({
      caseRow: this.caseRow,
      report: this.report,
      findings: this.findings,
      documents: this.documents,
    })
  }

  public transitionApprovedToGenerating(caseId: string): Promise<void> {
    if (this.caseRow.id !== caseId || this.caseRow.status !== 'approved') {
      throw new Error('Approved case transition failed closed.')
    }
    this.caseRow.status = 'generating_report'
    return Promise.resolve()
  }

  public uploadPdf(storagePath: string, buffer: Buffer): Promise<void> {
    if (this.failUpload) throw new Error('PDF upload failed')
    this.uploads.set(storagePath, buffer)
    return Promise.resolve()
  }

  public markDelivered(input: {
    caseId: string
    reportId: string
    reportVersion: number
    correctionOfVersion: number | null
    storagePath: string
    deliveredAt: string
  }): Promise<void> {
    assertCondition(input.caseId === this.caseRow.id, 'wrong case delivered')
    assertCondition(input.reportId === this.report.id, 'wrong report delivered')
    this.report.report_version = input.reportVersion
    this.report.correction_of_version = input.correctionOfVersion
    this.report.pdf_storage_path = input.storagePath
    this.report.delivered_at = input.deliveredAt
    this.caseRow.status = 'delivered'
    return Promise.resolve()
  }

  public markGenerationFailure(_caseId: string, message: string): Promise<void> {
    this.audits.push({
      action: 'generation_failure_state_recorded',
      entityId: _caseId,
      metadata: message,
    })
    return Promise.resolve()
  }

  public createFollowUpSchedule(caseId: string, deliveredAt: string): Promise<number> {
    const days = [30, 60, 90] as const
    for (const [index, day] of days.entries()) {
      const date = new Date(deliveredAt)
      date.setUTCDate(date.getUTCDate() + day)
      const sequence = (index + 1) as 1 | 2 | 3
      const existing = this.followUps.find(
        (row) => row.caseId === caseId && row.sequence === sequence
      )
      if (existing) {
        existing.scheduledAt = date.toISOString()
      } else {
        this.followUps.push({ caseId, sequence, scheduledAt: date.toISOString() })
      }
    }
    return Promise.resolve(3)
  }

  public queueEmailDelivery(caseId: string): Promise<void> {
    if (![...this.jobs.values()].some((job) => job.job_type === 'email_delivery')) {
      this.jobs.set('email-job', {
        id: 'email-job',
        case_id: caseId,
        job_type: 'email_delivery',
        status: 'queued',
        attempt_count: 0,
        max_attempts: 3,
      })
    }
    return Promise.resolve()
  }

  public loadEmailDeliveryRows(): Promise<{
    caseRef: string
    patientEmail: string
    deliveredAt: string | null
  }> {
    return Promise.resolve({
      caseRef: this.caseRow.case_ref,
      patientEmail: this.patientEmail,
      deliveredAt: this.report.delivered_at,
    })
  }

  public storeDeliveryEmailId(_caseId: string, messageId: string): Promise<void> {
    this.report.delivery_email_id = messageId
    return Promise.resolve()
  }

  public insertAudit(input: {
    action: string
    entityType: string
    entityId: string
    metadata?: Json
  }): Promise<void> {
    const audit = { action: input.action, entityId: input.entityId } as {
      action: string
      entityId: string
      metadata?: Json
    }
    if (input.metadata !== undefined) audit.metadata = input.metadata
    this.audits.push(audit)
    return Promise.resolve()
  }
}

class MemoryDownloadStore implements ReportDownloadStore {
  public audits: Array<{ caseId: string; patientId: string; expiresAt: string }> = []
  public ownerPatientId = 'patient-a'
  public deliveredAt: string | null = new Date('2026-04-17T09:00:00.000Z').toISOString()
  public pdfStoragePath: string | null = 'reports/case-module8/1.pdf'
  public lastExpirySeconds = 0

  public readCaseOwner(): Promise<{ patientId: string } | null> {
    return Promise.resolve({ patientId: this.ownerPatientId })
  }

  public readDeliveredReport(): Promise<{
    pdfStoragePath: string | null
    deliveredAt: string | null
  } | null> {
    return Promise.resolve({
      pdfStoragePath: this.pdfStoragePath,
      deliveredAt: this.deliveredAt,
    })
  }

  public createSignedUrl(_storagePath: string, expiresInSeconds: number): Promise<string> {
    this.lastExpirySeconds = expiresInSeconds
    return Promise.resolve('https://storage.supabase.co/signed/report-token')
  }

  public insertAudit(input: {
    patientId: string
    caseId: string
    expiresAt: string
  }): Promise<void> {
    this.audits.push(input)
    return Promise.resolve()
  }
}

class FailingEmailSender implements EmailSender {
  public send(): Promise<{ id: string }> {
    return Promise.reject(new Error('Resend unavailable'))
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

async function expectDownloadFailure(
  check: () => Promise<unknown>,
  statusCode: number
): Promise<void> {
  try {
    await check()
  } catch (error) {
    assertCondition(error instanceof ReportDownloadError, 'Expected ReportDownloadError')
    assertCondition(error.statusCode === statusCode, `Expected ${String(statusCode)}`)
    return
  }
  throw new Error('Expected download failure did not occur')
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
  console.log('\nMODULE 8 CHECKPOINT REPORT')
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

export async function runModule8Checkpoints(): Promise<number> {
  const results: Partial<Record<CheckpointName, CheckpointResult>> = {}

  await runCheckpoint('pdf_contains_required_sections', results, async () => {
    const store = new MemoryReportStore()
    const content = buildApprovedReportContent({
      caseRow: store.caseRow,
      report: store.report,
      findings: store.findings,
      documents: store.documents,
      deliveryDate: new Date('2026-04-17T09:00:00.000Z'),
    })
    const pdf = await renderReportPdfBuffer(content)
    assertCondition(pdf.length > 1000, 'PDF buffer too small')
    const text = getReportSearchText(content)
    for (const heading of MODULE8_REQUIRED_SECTION_HEADINGS) {
      assertCondition(text.includes(heading), `${heading} missing`)
    }
    for (const item of CANNOT_TELL_YOU_ITEMS) {
      assertCondition(text.includes(item), `Cannot-tell item missing: ${item}`)
    }
  })

  await runCheckpoint('fail_closed_preflight', results, async () => {
    const invalidJobStore = new MemoryReportStore()
    await expectFailure(() => runReportGenerationJob('missing-job', invalidJobStore), 'Invalid')

    const statusStore = new MemoryReportStore()
    statusStore.caseRow.status = 'under_review'
    await expectFailure(() => runReportGenerationJob('report-job', statusStore), 'approved')
    assertCondition(statusStore.report.delivered_at === null, 'Preflight set delivered_at')

    const signoffStore = new MemoryReportStore()
    signoffStore.report.signed_off_at = null
    await expectFailure(() => runReportGenerationJob('report-job', signoffStore), 'sign-off')
    assertCondition(signoffStore.report.delivered_at === null, 'Missing sign-off set delivered_at')
  })

  await runCheckpoint('no_raw_ocr_or_extracted_text', results, () => {
    const store = new MemoryReportStore()
    const content = buildApprovedReportContent({
      caseRow: store.caseRow,
      report: store.report,
      findings: store.findings,
      documents: store.documents,
      deliveryDate: new Date('2026-04-17T09:00:00.000Z'),
    })
    const text = getReportSearchText(content)
    assertCondition(!text.includes('RAW OCR SENTINEL'), 'Raw OCR-like scope note leaked')
    assertCondition(!text.toLowerCase().includes('extracted_text'), 'extracted_text leaked')
    assertCondition(!text.toLowerCase().includes('extracted_json'), 'extracted_json leaked')
  })

  await runCheckpoint('no_unreviewed_ai_output', results, async () => {
    const store = new MemoryReportStore()
    store.findings.push({
      ...store.findings[1]!,
      id: 'unreviewed-finding',
      reviewer_confirmed: false,
      reviewer_unassessable: false,
      plain_language_explanation: 'UNREVIEWED_SENTINEL',
    })
    await expectFailure(() => runReportGenerationJob('report-job', store), 'unreviewed')
    assertCondition(store.report.delivered_at === null, 'Unreviewed output was delivered')
  })

  await runCheckpoint('email_app_link_only', results, () => {
    const email = buildReportReadyEmail({
      patientEmail: 'patient@example.com',
      caseRef: 'CC-M8-001',
      baseUrl: 'https://claimclarity.in',
    })
    assertCondition(email.html.includes('/app/cases/CC-M8-001/report'), 'App link missing')
    assertCondition(email.text.includes('/app/cases/CC-M8-001/report'), 'Text app link missing')
    assertCondition(!email.html.includes('storage.supabase.co'), 'Storage URL leaked in HTML')
    assertCondition(!email.text.includes('storage.supabase.co'), 'Storage URL leaked in text')
    assertCondition(!email.html.toLowerCase().includes('attachment'), 'Attachment language found')
  })

  await runCheckpoint('unauthenticated_download_401', results, async () => {
    await expectDownloadFailure(
      () =>
        createReportDownloadSignedUrlFromStore({
          store: new MemoryDownloadStore(),
          caseId: 'case-module8',
          patientId: null,
        }),
      401
    )
  })

  await runCheckpoint('wrong_patient_cannot_download', results, async () => {
    await expectDownloadFailure(
      () =>
        createReportDownloadSignedUrlFromStore({
          store: new MemoryDownloadStore(),
          caseId: 'case-module8',
          patientId: 'patient-b',
        }),
      404
    )
  })

  await runCheckpoint('undelivered_report_cannot_download', results, async () => {
    const store = new MemoryDownloadStore()
    store.deliveredAt = null
    await expectDownloadFailure(
      () =>
        createReportDownloadSignedUrlFromStore({
          store,
          caseId: 'case-module8',
          patientId: 'patient-a',
        }),
      403
    )
  })

  await runCheckpoint('signed_url_expires_about_one_hour', results, async () => {
    const store = new MemoryDownloadStore()
    const now = new Date('2026-04-17T09:00:00.000Z')
    const result = await createReportDownloadSignedUrlFromStore({
      store,
      caseId: 'case-module8',
      patientId: 'patient-a',
      now,
    })
    const deltaSeconds = Math.round((new Date(result.expiresAt).getTime() - now.getTime()) / 1000)
    assertCondition(deltaSeconds === SIGNED_URL_TTL_SECONDS, 'Signed URL expiry is not one hour')
    assertCondition(store.lastExpirySeconds === SIGNED_URL_TTL_SECONDS, 'Storage TTL was not one hour')
    assertCondition(store.audits.length === 1, 'Signed URL audit missing')
  })

  await runCheckpoint('follow_up_rows_30_60_90', results, async () => {
    const store = new MemoryReportStore()
    await runReportGenerationJob('report-job', store)
    assertCondition(store.followUps.length === 3, 'Expected exactly three follow-up rows')
    const deliveredAt = store.report.delivered_at
    assertCondition(deliveredAt !== null, 'Delivered timestamp missing')
    const deltas = store.followUps
      .slice()
      .sort((left, right) => left.sequence - right.sequence)
      .map((row) => daysBetween(row.scheduledAt, deliveredAt))
    assertCondition(JSON.stringify(deltas) === JSON.stringify([30, 60, 90]), 'Follow-up days wrong')
  })

  await runCheckpoint('email_failure_preserves_delivered_state', results, async () => {
    const store = new MemoryReportStore()
    await runReportGenerationJob('report-job', store)
    const deliveredAt = store.report.delivered_at
    await expectFailure(
      () => runEmailDeliveryJob('email-job', store, new FailingEmailSender()),
      'Resend unavailable'
    )
    assertCondition(store.report.delivered_at === deliveredAt, 'Email failure unset delivered_at')
    assertCondition(store.caseRow.status === 'delivered', 'Email failure changed delivered status')
    assertCondition(store.report.delivery_email_id === undefined, 'Failed email stored message id')
  })

  await runCheckpoint('pdf_upload_failure_no_delivered_at', results, async () => {
    const store = new MemoryReportStore()
    store.failUpload = true
    await expectFailure(() => runReportGenerationJob('report-job', store), 'PDF upload failed')
    assertCondition(store.report.delivered_at === null, 'PDF failure set delivered_at')
    assertCondition(store.caseRow.status !== 'delivered', 'PDF failure delivered case')
  })

  await runCheckpoint('correction_increments_version_preserves_prior_pdf', results, async () => {
    const store = new MemoryReportStore()
    await runReportGenerationJob('report-job', store)
    const firstPath = store.report.pdf_storage_path
    assertCondition(firstPath === 'reports/case-module8/1.pdf', 'Initial PDF path wrong')
    store.caseRow.status = 'approved'
    store.jobs.set('report-job-2', {
      id: 'report-job-2',
      case_id: store.caseRow.id,
      job_type: 'report_generation',
      status: 'queued',
      attempt_count: 0,
      max_attempts: 3,
    })
    await runReportGenerationJob('report-job-2', store)
    assertCondition(store.report.report_version === 2, 'Correction version did not increment')
    assertCondition(store.report.correction_of_version === 1, 'Correction predecessor missing')
    assertCondition(store.uploads.has('reports/case-module8/1.pdf'), 'Prior PDF missing')
    assertCondition(store.uploads.has('reports/case-module8/2.pdf'), 'Correction PDF missing')
  })

  await runCheckpoint('required_audit_events_written', results, async () => {
    const store = new MemoryReportStore()
    await runReportGenerationJob('report-job', store)
    const actions = new Set(store.audits.map((audit) => audit.action))
    for (const action of [
      'report_generation_started',
      'report_pdf_generated_uploaded',
      'case_delivered',
      'follow_up_schedule_created',
      'delivery_email_queued',
    ]) {
      assertCondition(actions.has(action), `${action} audit missing`)
    }
    await expectFailure(
      () => runEmailDeliveryJob('email-job', store, new FailingEmailSender()),
      'Resend unavailable'
    )
    assertCondition(
      store.audits.some((audit) => audit.action === 'delivery_email_failed'),
      'delivery_email_failed audit missing'
    )
  })

  return printReport(results)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runModule8Checkpoints()
    .then((exitCode) => {
      process.exit(exitCode)
    })
    .catch((error: unknown) => {
      console.error('Module 8 checkpoint runner crashed:', error)
      process.exit(1)
    })
}
