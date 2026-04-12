/**
 * @file route.ts
 * @module web/api/consents
 *
 * Captures DPDP consent rows for authenticated patients.
 *
 * DEPENDENCIES:
 *   - zod (request validation)
 *   - /apps/web/lib/consent.ts
 *   - /apps/web/lib/rateLimit.ts
 *   - /packages/db/src/client.server.ts
 *
 * CALLED BY:
 *   - /apps/web/app/app/consent/page.tsx
 *
 * CALLS:
 *   - Supabase consents table
 *   - /packages/db/src/audit.ts
 */

import { z } from 'zod'
import { createServerClient, logAudit } from '@claimclarity/db'
import { REQUIRED_CONSENT_TYPES } from '@claimclarity/shared/constants'

import { getMissingSubmittedConsentTypes } from '../../../lib/consent'
import {
  AuthorizationError,
  ExternalServiceError,
  ValidationError,
  toApiResponse,
} from '../../../lib/errors'
import { rateLimitRequest } from '../../../lib/rateLimit'
import { getRequestIp, maskIpAddress } from '../../../lib/request'

const CONSENT_SCHEMA = z.object({
  consents: z.array(
    z.object({
      type: z.string(),
      given: z.boolean(),
    })
  ),
  privacyPolicyVersion: z.string().min(1),
  termsVersion: z.string().min(1),
})

function getServerPrivacyPolicyVersion(): string {
  return process.env.PRIVACY_POLICY_VERSION ?? 'v1.0-2024-04-01'
}

function getServerTermsVersion(): string {
  return process.env.TERMS_VERSION ?? 'v1.0-2024-04-01'
}

export async function POST(request: Request): Promise<Response> {
  try {
    const limited = await rateLimitRequest(request, 'auth')
    if (limited) {
      return limited
    }

    const client = await createServerClient()
    const {
      data: { user },
    } = await client.auth.getUser()

    if (!user) {
      throw new AuthorizationError('Authentication required')
    }

    const body: unknown = await request.json()
    const parsed = CONSENT_SCHEMA.safeParse(body)
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { issues: parsed.error.issues })
    }

    const missing = getMissingSubmittedConsentTypes(parsed.data.consents)
    if (missing.length > 0) {
      throw new ValidationError('All required consents must be accepted', { missing })
    }

    const privacyPolicyVersion = getServerPrivacyPolicyVersion()
    const termsVersion = getServerTermsVersion()
    const maskedIp = maskIpAddress(getRequestIp(request))
    const auditIp = getRequestIp(request)
    const userAgent = request.headers.get('user-agent')
    const rows = REQUIRED_CONSENT_TYPES.map((consentType) => ({
      user_id: user.id,
      consent_type: consentType,
      consent_given: true,
      privacy_policy_version: privacyPolicyVersion,
      terms_version: termsVersion,
      source_channel: 'patient_web' as const,
      ip_address: maskedIp,
      user_agent: userAgent,
    }))

    const { error } = await client.from('consents').insert(rows)
    if (error) {
      throw new ExternalServiceError('Supabase', error.message, { userId: user.id })
    }

    await logAudit({
      actorId: user.id,
      actorRole: 'patient',
      action: 'consents_captured',
      entityType: 'user',
      entityId: user.id,
      metadata: {
        consent_types: [...REQUIRED_CONSENT_TYPES],
        privacy_policy_version: privacyPolicyVersion,
        terms_version: termsVersion,
      },
      ...(auditIp ? { ipAddress: auditIp } : {}),
    })

    return Response.json({ ok: true, redirectTo: '/app/upload' })
  } catch (error) {
    return toApiResponse(error)
  }
}
