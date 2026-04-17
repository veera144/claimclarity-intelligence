/**
 * @file report-download.ts
 * @module web/lib
 *
 * Module 8 login-gated report download authorization and signed URL creation.
 *
 * DEPENDENCIES:
 *   - @claimclarity/db (typed Supabase client)
 *
 * CALLED BY:
 *   - /apps/web/app/api/cases/[caseId]/report/download/route.ts
 *   - /apps/processor/tests/module8.test.ts
 *
 * CALLS:
 *   - Supabase cases, reports, storage, and audit_log
 */

import type { DbClient, Json } from '@claimclarity/db'

const REPORT_BUCKET_NAME = 'reports'
const SIGNED_URL_TTL_SECONDS = 3600

export type ReportDownloadStore = {
  readCaseOwner(caseId: string): Promise<{ patientId: string } | null>
  readDeliveredReport(caseId: string): Promise<{
    pdfStoragePath: string | null
    deliveredAt: string | null
  } | null>
  createSignedUrl(storagePath: string, expiresInSeconds: number): Promise<string>
  insertAudit(input: {
    patientId: string
    caseId: string
    expiresAt: string
  }): Promise<void>
}

export class ReportDownloadError extends Error {
  public readonly statusCode: number

  public constructor(message: string, statusCode: number) {
    super(message)
    this.name = 'ReportDownloadError'
    this.statusCode = statusCode
  }
}

function toJson(value: unknown): Json {
  return value as Json
}

function objectPathFromStoragePath(storagePath: string): string {
  return storagePath.startsWith(`${REPORT_BUCKET_NAME}/`)
    ? storagePath.slice(REPORT_BUCKET_NAME.length + 1)
    : storagePath
}

function throwIfDbError(error: { message: string } | null): void {
  if (error) throw new Error(error.message)
}

/**
 * Creates a Supabase-backed report download store.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, factory only
 *
 * @param client - Service-role Supabase client
 * @returns Store used by the download helper
 */
export function createSupabaseReportDownloadStore(client: DbClient): ReportDownloadStore {
  return {
    async readCaseOwner(caseId: string): Promise<{ patientId: string } | null> {
      const { data, error } = await client
        .from('cases')
        .select('id, patient_id')
        .eq('id', caseId)
        .maybeSingle()
      throwIfDbError(error)
      return data ? { patientId: data.patient_id } : null
    },

    async readDeliveredReport(caseId: string): Promise<{
      pdfStoragePath: string | null
      deliveredAt: string | null
    } | null> {
      const { data, error } = await client
        .from('reports')
        .select('pdf_storage_path, delivered_at')
        .eq('case_id', caseId)
        .maybeSingle()
      throwIfDbError(error)
      return data
        ? { pdfStoragePath: data.pdf_storage_path, deliveredAt: data.delivered_at }
        : null
    },

    async createSignedUrl(storagePath: string, expiresInSeconds: number): Promise<string> {
      const { data, error } = await client.storage
        .from(REPORT_BUCKET_NAME)
        .createSignedUrl(objectPathFromStoragePath(storagePath), expiresInSeconds)
      throwIfDbError(error)
      if (!data?.signedUrl) throw new Error('Supabase Storage returned no signed URL')
      return data.signedUrl
    },

    async insertAudit(input): Promise<void> {
      const { error } = await client.from('audit_log').insert({
        actor_id: input.patientId,
        actor_role: 'patient',
        action: 'report_download_url_generated',
        entity_type: 'case',
        entity_id: input.caseId,
        metadata: toJson({ expires_at: input.expiresAt }),
      })
      throwIfDbError(error)
    },
  }
}

/**
 * Authorizes a patient report download against an injectable store.
 *
 * SIDE EFFECTS: creates a transient signed URL and writes audit_log through the store
 * THROWS: ReportDownloadError for auth/ownership/delivery failures; Error for infra failures
 * IDEMPOTENT: no, every successful call creates a new transient signed URL
 *
 * @param input - Authenticated patient id, case id, and report download store
 * @returns Signed URL and expiry timestamp
 */
export async function createReportDownloadSignedUrlFromStore(input: {
  store: ReportDownloadStore
  caseId: string
  patientId: string | null
  now?: Date
}): Promise<{ signedUrl: string; expiresAt: string }> {
  if (!input.patientId) {
    throw new ReportDownloadError('Authentication required', 401)
  }

  const caseOwner = await input.store.readCaseOwner(input.caseId)
  if (!caseOwner || caseOwner.patientId !== input.patientId) {
    throw new ReportDownloadError('Report not found', 404)
  }

  const report = await input.store.readDeliveredReport(input.caseId)
  if (!report || !report.deliveredAt || !report.pdfStoragePath) {
    throw new ReportDownloadError('Report is not available', 403)
  }

  const signedUrl = await input.store.createSignedUrl(report.pdfStoragePath, SIGNED_URL_TTL_SECONDS)
  const baseTime = input.now?.getTime() ?? Date.now()
  const expiresAt = new Date(baseTime + SIGNED_URL_TTL_SECONDS * 1000).toISOString()
  await input.store.insertAudit({ patientId: input.patientId, caseId: input.caseId, expiresAt })

  return { signedUrl, expiresAt }
}

/**
 * Authorizes a patient report download and creates a one-hour signed URL.
 *
 * SIDE EFFECTS: creates a transient Supabase Storage signed URL and writes audit_log
 * THROWS: ReportDownloadError for auth/ownership/delivery failures; Error for infra failures
 * IDEMPOTENT: no, every successful call creates a new transient signed URL
 *
 * @param input - Authenticated patient id, case id, and service-role client
 * @returns Signed URL and expiry timestamp
 */
export async function createReportDownloadSignedUrl(input: {
  client: DbClient
  caseId: string
  patientId: string | null
}): Promise<{ signedUrl: string; expiresAt: string }> {
  return createReportDownloadSignedUrlFromStore({
    store: createSupabaseReportDownloadStore(input.client),
    caseId: input.caseId,
    patientId: input.patientId,
  })
}

export { SIGNED_URL_TTL_SECONDS }
