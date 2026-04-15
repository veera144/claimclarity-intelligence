/**
 * @file route.ts
 * @module web/api/payments/controls
 *
 * Hidden Module 3 payment controls for admin waiver, internal access-code waiver, and test simulation.
 *
 * DEPENDENCIES:
 *   - /apps/web/lib/errors.ts
 *   - /apps/web/lib/payments/access-code.ts
 *   - /apps/web/lib/payments/payment-flow.ts
 *   - /apps/web/lib/rateLimit.ts
 *   - /apps/web/lib/validation/payment.schemas.ts
 *   - /packages/db/src/queries/payments.queries.ts
 *
 * CALLED BY:
 *   - Internal operational tooling and Module 3 checkpoint tests
 *
 * CALLS:
 *   - Supabase cases, payments, users, processing_jobs, and audit_log tables
 */

import {
  createServerClient,
  createServiceClient,
  getActivePaymentForCase,
  getPaymentCaseById,
  getUserRoleForPaymentAdmin,
  logAudit,
} from '@claimclarity/db'
import { FEATURES } from '@claimclarity/shared/features'

import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
  toApiResponse,
} from '../../../../lib/errors'
import {
  isInternalAccessCodeAllowlisted,
  isTestSimulatedPaymentAllowed,
} from '../../../../lib/payments/access-code'
import { confirmWithoutPaymentAndActivateCase } from '../../../../lib/payments/payment-flow'
import { rateLimitIdentifier } from '../../../../lib/rateLimit'
import { PAYMENT_CONTROLS_SCHEMA } from '../../../../lib/validation/payment.schemas'

export const runtime = 'nodejs'

async function logControlFailure(input: {
  actorId: string
  action: string
  caseId: string
  caseRef: string
  reason: string
}): Promise<void> {
  await logAudit({
    actorId: input.actorId,
    actorRole: 'patient',
    action: input.action,
    entityType: 'case',
    entityId: input.caseId,
    metadata: {
      case_ref: input.caseRef,
      reason: input.reason,
    },
  })
}

function isFeatureEnabled(enabled: boolean): boolean {
  return enabled
}

export async function POST(request: Request): Promise<Response> {
  try {
    const sessionClient = await createServerClient()
    const {
      data: { user },
    } = await sessionClient.auth.getUser()

    if (!user) {
      throw new AuthorizationError('Authentication required')
    }

    const limited = await rateLimitIdentifier('payment', user.id)
    if (limited) {
      return limited
    }

    const body = (await request.json().catch(() => null)) as unknown
    const parsed = PAYMENT_CONTROLS_SCHEMA.safeParse(body)
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { issues: parsed.error.issues })
    }

    const serviceClient = createServiceClient()
    const caseRow = await getPaymentCaseById({
      client: serviceClient,
      caseId: parsed.data.caseId,
    })
    if (!caseRow) {
      throw new NotFoundError('Case', parsed.data.caseId)
    }

    const role = await getUserRoleForPaymentAdmin({
      client: serviceClient,
      userId: user.id,
    })
    const isAdminMode = parsed.data.mode === 'admin_waived'
    const actorRole = isAdminMode ? 'admin' : 'patient'

    if (isAdminMode) {
      if (role?.role !== 'admin') {
        await logControlFailure({
          actorId: user.id,
          action: 'payment_admin_waiver_failed',
          caseId: caseRow.id,
          caseRef: caseRow.case_ref,
          reason: 'admin_required',
        })
        throw new AuthorizationError('Admin access required')
      }
    } else if (caseRow.patient_id !== user.id) {
      await logControlFailure({
        actorId: user.id,
        action: `payment_${parsed.data.mode}_failed`,
        caseId: caseRow.id,
        caseRef: caseRow.case_ref,
        reason: 'case_access_denied',
      })
      throw new AuthorizationError('Case access denied')
    }

    if (
      caseRow.status !== 'payment_pending' ||
      caseRow.payment_waived ||
      caseRow.payment_mode !== 'real_payment'
    ) {
      await logControlFailure({
        actorId: user.id,
        action: `payment_${parsed.data.mode}_failed`,
        caseId: caseRow.id,
        caseRef: caseRow.case_ref,
        reason: 'payment_not_available',
      })
      throw new ValidationError('Payment control is not available for this case')
    }

    const activePayment = await getActivePaymentForCase({
      client: serviceClient,
      caseId: caseRow.id,
    })
    if (activePayment) {
      await logControlFailure({
        actorId: user.id,
        action: `payment_${parsed.data.mode}_failed`,
        caseId: caseRow.id,
        caseRef: caseRow.case_ref,
        reason: 'active_payment_exists',
      })
      throw new ConflictError('Payment already exists for this case', {
        caseId: caseRow.id,
        paymentId: activePayment.id,
      })
    }

    if (parsed.data.mode === 'internal_access_code') {
      if (
        !isFeatureEnabled(FEATURES.INTERNAL_ACCESS_CODE_WAIVER) ||
        !isInternalAccessCodeAllowlisted(parsed.data.accessCode)
      ) {
        await logControlFailure({
          actorId: user.id,
          action: 'payment_internal_access_code_failed',
          caseId: caseRow.id,
          caseRef: caseRow.case_ref,
          reason: 'not_allowlisted',
        })
        throw new AuthorizationError('Access code is not valid')
      }

      const result = await confirmWithoutPaymentAndActivateCase({
        client: serviceClient,
        caseId: caseRow.id,
        caseRef: caseRow.case_ref,
        mode: 'internal_access_code',
        reason: 'internal_access_code',
        auditAction: 'payment_internal_access_code_redeemed',
        actorId: user.id,
        actorRole,
      })

      return Response.json({ success: result.success, caseRef: result.caseRef })
    }

    if (parsed.data.mode === 'test_simulated') {
      if (!isFeatureEnabled(FEATURES.TEST_SIMULATED_PAYMENT) || !isTestSimulatedPaymentAllowed()) {
        await logControlFailure({
          actorId: user.id,
          action: 'payment_test_simulated_failed',
          caseId: caseRow.id,
          caseRef: caseRow.case_ref,
          reason: 'not_enabled',
        })
        throw new ValidationError('Simulated payment is not enabled')
      }

      const result = await confirmWithoutPaymentAndActivateCase({
        client: serviceClient,
        caseId: caseRow.id,
        caseRef: caseRow.case_ref,
        mode: 'test_simulated',
        reason: 'test_simulated',
        auditAction: 'payment_test_simulated',
        actorId: user.id,
        actorRole,
      })

      return Response.json({ success: result.success, caseRef: result.caseRef })
    }

    const result = await confirmWithoutPaymentAndActivateCase({
      client: serviceClient,
      caseId: caseRow.id,
      caseRef: caseRow.case_ref,
      mode: 'admin_waived',
      reason: parsed.data.reason,
      auditAction: 'payment_admin_waived',
      actorId: user.id,
      actorRole,
    })

    return Response.json({ success: result.success, caseRef: result.caseRef })
  } catch (error) {
    return toApiResponse(error)
  }
}
