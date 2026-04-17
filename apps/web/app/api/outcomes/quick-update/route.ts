/**
 * @file route.ts
 * @module web/api/outcomes/quick-update
 *
 * One-click Module 9 outcome update endpoint.
 *
 * DEPENDENCIES:
 *   - @claimclarity/db (service-role client)
 *   - /apps/web/lib/outcomes/outcome-service.ts
 *   - /apps/web/lib/validation/outcome.schemas.ts
 *
 * CALLED BY:
 *   - /apps/web/app/app/outcomes/update/page.tsx
 *
 * CALLS:
 *   - Supabase outcomes, outcome_tokens, follow_up_schedule, audit_log
 */

import { createServiceClient } from '@claimclarity/db'
import { inspectOutcomeToken } from '@claimclarity/db/outcome-tokens'

import { AuthorizationError, toApiResponse, ValidationError } from '../../../../lib/errors'
import { submitQuickOutcome } from '../../../../lib/outcomes/outcome-service'
import { rateLimitRequest } from '../../../../lib/rateLimit'
import { getRequestIp } from '../../../../lib/request'
import { quickOutcomeSubmissionSchema } from '../../../../lib/validation/outcome.schemas'

export const runtime = 'nodejs'

function thankYouHtml(): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head><meta charset="utf-8"><title>Outcome received</title></head>',
    '<body style="font-family:Arial,sans-serif;margin:40px;line-height:1.5">',
    '<h1>Thank you</h1>',
    '<p>Your update has been recorded.</p>',
    '</body></html>',
  ].join('')
}

export async function POST(request: Request): Promise<Response> {
  try {
    const limited = await rateLimitRequest(request, 'outcome')
    if (limited) return limited

    const payload = quickOutcomeSubmissionSchema.safeParse(await request.json())
    if (!payload.success) {
      throw new ValidationError('Invalid quick outcome update', {
        issues: payload.error.flatten(),
      })
    }

    const serviceClient = createServiceClient()
    const inspected = await inspectOutcomeToken(payload.data.token, serviceClient)
    if (!inspected || inspected.tokenType !== 'quick_update') {
      await serviceClient.from('audit_log').insert({
        actor_role: 'system',
        action: 'outcome_token_rejected',
        entity_type: 'outcome_token',
        metadata: {
          token_type: 'quick_update',
          reason: 'invalid_expired_or_used',
        },
      })
      throw new AuthorizationError('Invalid or expired outcome link')
    }

    await submitQuickOutcome({
      caseId: inspected.caseId,
      serviceClient,
      token: payload.data.token,
      action: payload.data.action,
      ipAddress: getRequestIp(request),
    })

    return new Response(thankYouHtml(), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
      },
    })
  } catch (error) {
    return toApiResponse(error)
  }
}
