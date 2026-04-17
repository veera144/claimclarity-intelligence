/**
 * @file route.ts
 * @module web/api/outcomes/case
 *
 * Full Module 9 outcome submission endpoint.
 *
 * DEPENDENCIES:
 *   - @claimclarity/db (Supabase clients)
 *   - /apps/web/lib/outcomes/outcome-service.ts
 *   - /apps/web/lib/validation/outcome.schemas.ts
 *
 * CALLED BY:
 *   - /apps/web/app/app/outcomes/[caseRef]/outcome-form.tsx
 *
 * CALLS:
 *   - Supabase outcomes, outcome_tokens, follow_up_schedule, audit_log
 */

import { createServerClient, createServiceClient } from '@claimclarity/db'

import { toApiResponse, ValidationError } from '../../../../lib/errors'
import { submitFullOutcome } from '../../../../lib/outcomes/outcome-service'
import { rateLimitRequest } from '../../../../lib/rateLimit'
import { getRequestIp } from '../../../../lib/request'
import { fullOutcomeSubmissionSchema } from '../../../../lib/validation/outcome.schemas'

export const runtime = 'nodejs'

type OutcomeRouteContext = {
  params: {
    caseId: string
  }
}

export async function POST(request: Request, context: OutcomeRouteContext): Promise<Response> {
  try {
    const limited = await rateLimitRequest(request, 'outcome')
    if (limited) return limited

    const payload = fullOutcomeSubmissionSchema.safeParse(await request.json())
    if (!payload.success) {
      throw new ValidationError('Invalid outcome submission', {
        issues: payload.error.flatten(),
      })
    }

    const sessionClient = await createServerClient()
    const {
      data: { user },
    } = await sessionClient.auth.getUser()
    const serviceClient = createServiceClient()
    const result = await submitFullOutcome({
      caseId: context.params.caseId,
      serviceClient,
      patientId: user?.id ?? null,
      body: payload.data,
      ipAddress: getRequestIp(request),
    })

    return Response.json({
      ok: true,
      outcomeType: result.outcomeType,
      patientActionType: result.patientActionType,
      evidenceType: result.evidenceType,
    })
  } catch (error) {
    return toApiResponse(error)
  }
}
