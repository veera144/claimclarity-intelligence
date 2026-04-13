/**
 * @file route.ts
 * @module web/api/admin/payments/refund
 *
 * Processes admin-only Razorpay refunds for Module 3 report payments.
 *
 * DEPENDENCIES:
 *   - /apps/web/lib/errors.ts
 *   - /apps/web/lib/payments/razorpay.ts
 *   - /apps/web/lib/payments/resend.ts
 *   - /apps/web/lib/validation/payment.schemas.ts
 *   - /packages/db/src/queries/payments.queries.ts
 *
 * CALLED BY:
 *   - Admin payment operations
 *
 * CALLS:
 *   - Razorpay refunds API
 *   - Supabase payments, cases, users, and audit_log tables
 */

import {
  closeCaseAfterRefund,
  createServerClient,
  createServiceClient,
  getPatientEmail,
  getPaymentById,
  getUserRoleForPaymentAdmin,
  logAudit,
  markPaymentRefunded,
} from '@claimclarity/db'
import { REPORT_PRICE_PAISE } from '@claimclarity/shared/constants'

import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
  toApiResponse,
} from '../../../../../../lib/errors'
import { createRazorpayRefund } from '../../../../../../lib/payments/razorpay'
import { sendPaymentEmail } from '../../../../../../lib/payments/resend'
import { REFUND_PAYMENT_SCHEMA } from '../../../../../../lib/validation/payment.schemas'

export const runtime = 'nodejs'

type RouteContext = {
  params: {
    paymentId: string
  }
}

const PARTIAL_REFUND_AMOUNT_PAISE = 34950

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const sessionClient = await createServerClient()
    const {
      data: { user },
    } = await sessionClient.auth.getUser()

    if (!user) {
      throw new AuthorizationError('Authentication required')
    }

    const serviceClient = createServiceClient()
    const role = await getUserRoleForPaymentAdmin({
      client: serviceClient,
      userId: user.id,
    })
    if (role?.role !== 'admin') {
      throw new AuthorizationError('Admin access required')
    }

    const body = (await request.json().catch(() => null)) as unknown
    const parsed = REFUND_PAYMENT_SCHEMA.safeParse(body)
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { issues: parsed.error.issues })
    }

    const payment = await getPaymentById({
      client: serviceClient,
      paymentId: context.params.paymentId,
    })
    if (!payment) {
      throw new NotFoundError('Payment', context.params.paymentId)
    }

    if (payment.status !== 'paid') {
      throw new ConflictError('Only paid payments can be refunded', { paymentId: payment.id })
    }

    if (!payment.razorpay_payment_id) {
      throw new ConflictError('Payment is missing a Razorpay payment id', {
        paymentId: payment.id,
      })
    }

    const refundAmount =
      parsed.data.refundType === 'full' ? REPORT_PRICE_PAISE : PARTIAL_REFUND_AMOUNT_PAISE
    const refund = await createRazorpayRefund({
      razorpayPaymentId: payment.razorpay_payment_id,
      amount: refundAmount,
      reason: parsed.data.reason,
    })

    await markPaymentRefunded({
      client: serviceClient,
      paymentId: payment.id,
      status: parsed.data.refundType === 'full' ? 'refunded' : 'partial_refund',
      refundAmountInr: refundAmount,
      refundReason: parsed.data.reason,
      refundRazorpayId: refund.id,
    })

    await closeCaseAfterRefund({
      client: serviceClient,
      caseId: payment.case_id,
    })

    const patientEmail = await getPatientEmail({
      client: serviceClient,
      patientId: payment.patient_id,
    })

    if (patientEmail) {
      await sendPaymentEmail({
        to: patientEmail.email,
        subject: 'Refund processed',
        text: 'Your ClaimClarity refund has been processed.',
        html: '<p>Your ClaimClarity refund has been processed.</p>',
      })
    }

    await logAudit({
      actorId: user.id,
      actorRole: 'admin',
      action: 'payment_refunded',
      entityType: 'payment',
      entityId: payment.id,
      metadata: {
        refund_amount_inr: refundAmount,
        refund_type: parsed.data.refundType,
      },
    })

    return Response.json({
      success: true,
      paymentId: payment.id,
      refundId: refund.id,
      refundAmountInr: refundAmount,
    })
  } catch (error) {
    return toApiResponse(error)
  }
}
