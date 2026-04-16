/**
 * @file route.ts
 * @module web/api/payments/create
 *
 * Creates Razorpay report-payment orders for authenticated patients.
 *
 * DEPENDENCIES:
 *   - /apps/web/lib/errors.ts
 *   - /apps/web/lib/payments/razorpay.ts
 *   - /apps/web/lib/rateLimit.ts
 *   - /apps/web/lib/validation/payment.schemas.ts
 *   - /packages/db/src/queries/payments.queries.ts
 *
 * CALLED BY:
 *   - /apps/web/app/app/cases/[caseRef]/pay/payment-checkout.tsx
 *
 * CALLS:
 *   - Supabase cases and payments tables
 *   - Razorpay orders API
 */

import {
  createPendingReportPayment,
  createServerClient,
  createServiceClient,
  getActivePaymentForCase,
  getPaymentCaseById,
} from '@claimclarity/db'
import { REPORT_PRICE_PAISE } from '@claimclarity/shared/constants'

import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
  toApiResponse,
} from '../../../../lib/errors'
import { createRazorpayOrder, getRazorpayKeyId } from '../../../../lib/payments/razorpay'
import { rateLimitIdentifier } from '../../../../lib/rateLimit'
import { CREATE_PAYMENT_ORDER_SCHEMA } from '../../../../lib/validation/payment.schemas'

export const runtime = 'nodejs'

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
    const parsed = CREATE_PAYMENT_ORDER_SCHEMA.safeParse(body)
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

    if (caseRow.patient_id !== user.id) {
      throw new AuthorizationError('Case access denied')
    }

    if (caseRow.payment_waived || caseRow.payment_mode !== 'real_payment') {
      throw new ValidationError('Payment is waived for this case')
    }

    if (caseRow.status !== 'payment_pending') {
      throw new ValidationError('Payment is not available for this case')
    }

    const activePayment = await getActivePaymentForCase({
      client: serviceClient,
      caseId: caseRow.id,
    })
    if (activePayment) {
      throw new ConflictError('Payment already exists for this case', {
        caseId: caseRow.id,
        paymentId: activePayment.id,
      })
    }

    const order = await createRazorpayOrder({
      amount: REPORT_PRICE_PAISE,
      receipt: caseRow.case_ref,
      notes: {
        case_id: caseRow.id,
      },
    })

    await createPendingReportPayment({
      client: serviceClient,
      caseId: caseRow.id,
      patientId: user.id,
      razorpayOrderId: order.id,
    })

    return Response.json({
      orderId: order.id,
      amount: REPORT_PRICE_PAISE,
      currency: 'INR',
      keyId: getRazorpayKeyId(),
    })
  } catch (error) {
    return toApiResponse(error)
  }
}
