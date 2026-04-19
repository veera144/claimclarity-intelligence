/**
 * @file route.ts
 * @module web/api/cases
 *
 * Creates authenticated patient cases after consent completion.
 *
 * DEPENDENCIES:
 *   - /apps/web/lib/consent.ts
 *   - /apps/web/lib/errors.ts
 *   - /apps/web/lib/rateLimit.ts
 *   - /packages/db/src/client.server.ts
 *   - /packages/db/src/queries/cases.queries.ts
 *
 * CALLED BY:
 *   - /apps/web/app/app/upload/page.tsx
 *
 * CALLS:
 *   - Supabase cases, outcomes, reports, and audit_log tables
 */

import {
  createServerClient,
  createServiceClient,
  generateCaseRef,
  getNextCaseRefSeq,
  logAudit,
} from '@claimclarity/db'

import { hasCompleteConsent } from '../../../lib/consent'
import { AuthorizationError, ExternalServiceError, toApiResponse } from '../../../lib/errors'
import { rateLimitRequest } from '../../../lib/rateLimit'
import { getRequestIp } from '../../../lib/request'

export const runtime = 'nodejs'

const PATIENT_CASE_SELECT = [
  'id',
  'case_ref',
  'status',
  'current_step',
  'insurer_name',
  'claim_amount_inr',
  'case_type',
  'created_at',
  'updated_at',
].join(', ')

export async function GET(request: Request): Promise<Response> {
  try {
    const sessionClient = await createServerClient()
    const {
      data: { user },
    } = await sessionClient.auth.getUser()

    if (!user) {
      throw new AuthorizationError('Authentication required')
    }

    const url = new URL(request.url)
    const caseId = url.searchParams.get('caseId')
    const serviceClient = createServiceClient()

    if (caseId) {
      const { data, error } = await serviceClient
        .from('cases')
        .select(PATIENT_CASE_SELECT)
        .eq('id', caseId)
        .eq('patient_id', user.id)
        .maybeSingle()

      if (error) {
        throw new ExternalServiceError('Supabase', error.message, { caseId })
      }

      return Response.json({ case: data ?? null })
    }

    const { data, error } = await serviceClient
      .from('cases')
      .select(PATIENT_CASE_SELECT)
      .eq('patient_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      throw new ExternalServiceError('Supabase', error.message, { userId: user.id })
    }

    return Response.json({ cases: data })
  } catch (error) {
    return toApiResponse(error)
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const limited = await rateLimitRequest(request, 'upload')
    if (limited) {
      return limited
    }

    const sessionClient = await createServerClient()
    const {
      data: { user },
    } = await sessionClient.auth.getUser()

    if (!user) {
      throw new AuthorizationError('Authentication required')
    }

    const consentComplete = await hasCompleteConsent({
      client: sessionClient,
      userId: user.id,
    })

    if (!consentComplete) {
      throw new AuthorizationError('Consent is required before case creation')
    }

    const serviceClient = createServiceClient()
    const sequence = await getNextCaseRefSeq(serviceClient)
    const caseRef = generateCaseRef(new Date().getFullYear(), sequence)

    const { data: caseRow, error: caseError } = await serviceClient
      .from('cases')
      .insert({
        patient_id: user.id,
        case_ref: caseRef,
        intake_channel: 'patient_web',
        status: 'documents_pending',
      })
      .select('id, case_ref')
      .single()

    if (caseError) {
      throw new ExternalServiceError('Supabase', caseError.message, {
        userId: user.id,
      })
    }

    const [outcomeResult, reportResult] = await Promise.all([
      serviceClient.from('outcomes').insert({
        case_id: caseRow.id,
        outcome_type: 'pending',
      }),
      serviceClient.from('reports').insert({
        case_id: caseRow.id,
        report_version: 1,
        appeal_letter_included: true,
      }),
    ])

    const failedChildInsert = outcomeResult.error ?? reportResult.error
    if (failedChildInsert) {
      throw new ExternalServiceError('Supabase', failedChildInsert.message, {
        caseId: caseRow.id,
      })
    }

    const auditIp = getRequestIp(request)
    await logAudit({
      actorId: user.id,
      actorRole: 'patient',
      action: 'case_created',
      entityType: 'case',
      entityId: caseRow.id,
      metadata: { case_ref: caseRow.case_ref },
      ...(auditIp ? { ipAddress: auditIp } : {}),
    })

    return Response.json({ caseId: caseRow.id, caseRef: caseRow.case_ref })
  } catch (error) {
    return toApiResponse(error)
  }
}
