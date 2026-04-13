/**
 * @file route.ts
 * @module web/api/payments/verify
 *
 * Verifies Razorpay checkout signatures and activates paid cases.
 *
 * DEPENDENCIES:
 *   - /apps/web/lib/errors.ts
 *   - /apps/web/lib/payments/payment-flow.ts
 *   - /apps/web/lib/payments/razorpay.ts
 *   - /apps/web/lib/validation/payment.schemas.ts
 *   - /packages/db/src/queries/payments.queries.ts
 *
 * CALLED BY:
 *   - /apps/web/app/app/cases/[caseRef]/pay/payment-checkout.tsx
 *
 * CALLS:
 *   - Supabase payments, cases, documents, processing_jobs, users, and audit_log tables
 */

import {
  createServerClient,
  createServiceClient,
  getPaymentCaseById,
  getPaymentForVerification,
  logAudit,
} from '@claimclarity/db'
import { REPORT_PRICE_PAISE } from '@claimclarity/shared/constants'

import {
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
  toApiResponse,
} from '../../../../lib/errors'
import { confirmPaymentAndActivateCase } from '../../../../lib/payments/payment-flow'
import { verifyCheckoutSignature } from '../../../../lib/payments/razorpay'
import { VERIFY_PAYMENT_SCHEMA } from '../../../../lib/validation/payment.schemas'

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

    const body = (await request.json().catch(() => null)) as unknown
    const parsed = VERIFY_PAYMENT_SCHEMA.safeParse(body)
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

    const payment = await getPaymentForVerification({
      client: serviceClient,
      caseId: parsed.data.caseId,
      razorpayOrderId: parsed.data.razorpay_order_id,
    })
    if (!payment) {
      throw new NotFoundError('Payment', parsed.data.razorpay_order_id)
    }

    if (payment.patient_id !== user.id) {
      throw new AuthorizationError('Payment access denied')
    }

    if (payment.amount_inr !== REPORT_PRICE_PAISE) {
      throw new ConflictError('Payment amount mismatch', { paymentId: payment.id })
    }

    if (payment.status === 'paid') {
      if (payment.razorpay_payment_id !== parsed.data.razorpay_payment_id) {
        throw new ConflictError('Payment already verified with a different payment id', {
          paymentId: payment.id,
        })
      }

      return Response.json({ success: true, caseRef: caseRow.case_ref })
    }

    if (caseRow.payment_waived || caseRow.status !== 'payment_pending') {
      throw new ValidationError('Payment is not available for this case')
    }

    const signatureValid = verifyCheckoutSignature({
      razorpayOrderId: parsed.data.razorpay_order_id,
      razorpayPaymentId: parsed.data.razorpay_payment_id,
      signature: parsed.data.razorpay_signature,
    })

    if (!signatureValid) {
      await logAudit({
        actorId: user.id,
        actorRole: 'patient',
        action: 'payment_verification_failed',
        entityType: 'payment',
        entityId: payment.id,
        metadata: { case_ref: caseRow.case_ref },
      })
      throw new ValidationError('Payment verification failed')
    }

    const result = await confirmPaymentAndActivateCase({
      client: serviceClient,
      payment,
      caseRef: caseRow.case_ref,
      razorpayPaymentId: parsed.data.razorpay_payment_id,
      razorpaySignature: parsed.data.razorpay_signature,
      actorId: user.id,
    })

    return Response.json({ success: result.success, caseRef: result.caseRef })
  } catch (error) {
    return toApiResponse(error)
  }
}
