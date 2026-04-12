/**
 * @file route.ts
 * @module web/api/patients/delete-my-data
 *
 * Performs authenticated patient data deletion and anonymization.
 *
 * DEPENDENCIES:
 *   - /packages/db/src/client.server.ts
 *   - /packages/shared/src/constants.ts
 *   - /apps/web/lib/errors.ts
 *
 * CALLED BY:
 *   - future patient account controls
 *
 * CALLS:
 *   - Supabase storage, cases, documents, reports, payments, consents, users, and auth admin APIs
 */

import { createServerClient, createServiceClient, logAudit } from '@claimclarity/db'
import { TOMBSTONE_USER_ID } from '@claimclarity/shared/constants'

import { AuthorizationError, ExternalServiceError, toApiResponse } from '../../../../lib/errors'
import { rateLimitRequest } from '../../../../lib/rateLimit'
import { getRequestIp } from '../../../../lib/request'

async function removeCaseFolder(
  bucket: 'case-documents' | 'reports',
  caseId: string
): Promise<void> {
  const serviceClient = createServiceClient()
  const { data, error } = await serviceClient.storage.from(bucket).list(caseId)

  if (error) {
    throw new ExternalServiceError('Supabase Storage', error.message, { bucket, caseId })
  }

  const paths = data.map((file) => `${caseId}/${file.name}`)
  if (paths.length === 0) {
    return
  }

  const { error: removeError } = await serviceClient.storage.from(bucket).remove(paths)
  if (removeError) {
    throw new ExternalServiceError('Supabase Storage', removeError.message, { bucket, caseId })
  }
}

async function sendDeletionConfirmation(email: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const fromEmail = process.env.RESEND_FROM_EMAIL

  if (!apiKey || !fromEmail) {
    console.warn('[delete-my-data] Resend is not configured; confirmation email skipped')
    return
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: email,
      subject: 'ClaimClarity data deletion completed',
      text: 'Your ClaimClarity data deletion request has been completed.',
    }),
  })

  if (!response.ok) {
    console.error('[delete-my-data] Confirmation email failed', await response.text())
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const limited = await rateLimitRequest(request, 'auth')
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

    const serviceClient = createServiceClient()
    const { data: userRow, error: userError } = await serviceClient
      .from('users')
      .select('email')
      .eq('id', user.id)
      .single()

    if (userError) {
      throw new ExternalServiceError('Supabase', userError.message, { userId: user.id })
    }

    const capturedEmail = userRow.email
    const { data: cases, error: casesError } = await serviceClient
      .from('cases')
      .select('id')
      .eq('patient_id', user.id)

    if (casesError) {
      throw new ExternalServiceError('Supabase', casesError.message, { userId: user.id })
    }

    const caseIds = cases.map((caseRow) => caseRow.id)

    await Promise.all(
      caseIds.flatMap((caseId) => [
        removeCaseFolder('case-documents', caseId),
        removeCaseFolder('reports', caseId),
      ])
    )

    if (caseIds.length > 0) {
      const updates = await Promise.all([
        serviceClient
          .from('documents')
          .update({
            extracted_json: null,
            extracted_text: null,
            storage_path: 'DELETED',
            original_filename_encrypted: null,
          })
          .in('case_id', caseIds),
        serviceClient
          .from('reports')
          .update({ pdf_storage_path: 'DELETED' })
          .in('case_id', caseIds),
        serviceClient.from('cases').update({ patient_id: TOMBSTONE_USER_ID }).in('id', caseIds),
      ])

      const failedUpdate = updates.find((result) => result.error)
      if (failedUpdate?.error) {
        throw new ExternalServiceError('Supabase', failedUpdate.error.message, { userId: user.id })
      }
    }

    const remainingUpdates = await Promise.all([
      serviceClient
        .from('payments')
        .update({ patient_id: TOMBSTONE_USER_ID })
        .eq('patient_id', user.id),
      serviceClient
        .from('consents')
        .update({
          revoked_at: new Date().toISOString(),
          revocation_reason: 'user_deletion_request',
        })
        .eq('user_id', user.id),
      serviceClient
        .from('users')
        .update({
          full_name: null,
          phone: null,
          email: `deleted-${user.id}@claimclarity.internal`,
        })
        .eq('id', user.id),
    ])

    const failedRemainingUpdate = remainingUpdates.find((result) => result.error)
    if (failedRemainingUpdate?.error) {
      throw new ExternalServiceError('Supabase', failedRemainingUpdate.error.message, {
        userId: user.id,
      })
    }

    const auditIp = getRequestIp(request)

    await logAudit({
      actorId: user.id,
      actorRole: 'patient',
      action: 'data_subject_deletion_completed',
      entityType: 'user',
      entityId: user.id,
      ...(auditIp ? { ipAddress: auditIp } : {}),
    })

    await serviceClient.auth.admin.signOut(user.id)
    await sendDeletionConfirmation(capturedEmail)

    return Response.json({ ok: true })
  } catch (error) {
    return toApiResponse(error)
  }
}
