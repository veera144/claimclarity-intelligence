/**
 * @file route.ts
 * @module web/api/webhooks/razorpay
 *
 * Handles signed Razorpay webhooks for Module 3 payment reconciliation.
 *
 * DEPENDENCIES:
 *   - /apps/web/lib/errors.ts
 *   - /apps/web/lib/payments/payment-flow.ts
 *   - /apps/web/lib/payments/razorpay.ts
 *   - /apps/web/lib/payments/resend.ts
 *   - /packages/db/src/queries/payments.queries.ts
 *
 * CALLED BY:
 *   - Razorpay webhook delivery
 *
 * CALLS:
 *   - Supabase payments, cases, documents, processing_jobs, users, and audit_log tables
 */

import {
  closeCaseAfterRefund,
  createServiceClient,
  getPatientEmail,
  getPaymentByRazorpayOrderId,
  getPaymentByRazorpayPaymentId,
  getPaymentCaseById,
  logAudit,
  markPaymentFailed,
  markPaymentRefunded,
} from '@claimclarity/db'

import { ValidationError, toApiResponse } from '../../../../lib/errors'
import { confirmPaymentAndActivateCase } from '../../../../lib/payments/payment-flow'
import { verifyWebhookSignature } from '../../../../lib/payments/razorpay'
import { sendPaymentEmail } from '../../../../lib/payments/resend'

export const runtime = 'nodejs'

type RazorpayWebhookEvent = 'payment.captured' | 'payment.failed' | 'refund.processed'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getWebhookEvent(payload: unknown): RazorpayWebhookEvent | null {
  if (!isRecord(payload)) {
    return null
  }

  return payload.event === 'payment.captured' ||
    payload.event === 'payment.failed' ||
    payload.event === 'refund.processed'
    ? payload.event
    : null
}

function getEntity(payload: unknown, name: 'payment' | 'refund'): Record<string, unknown> | null {
  if (!isRecord(payload) || !isRecord(payload.payload)) {
    return null
  }

  const container = payload.payload[name]
  if (!isRecord(container) || !isRecord(container.entity)) {
    return null
  }

  return container.entity
}

async function handleCapturedPayment(payload: unknown): Promise<void> {
  const entity = getEntity(payload, 'payment')
  const razorpayPaymentId = typeof entity?.id === 'string' ? entity.id : null
  const razorpayOrderId = typeof entity?.order_id === 'string' ? entity.order_id : null

  if (!razorpayPaymentId || !razorpayOrderId) {
    throw new ValidationError('Invalid Razorpay payment webhook')
  }

  const client = createServiceClient()
  const paymentById = await getPaymentByRazorpayPaymentId({
    client,
    razorpayPaymentId,
  })
  const payment =
    paymentById ??
    (await getPaymentByRazorpayOrderId({
      client,
      razorpayOrderId,
    }))

  if (!payment) {
    console.warn('[razorpay-webhook] Captured payment did not match a local payment row')
    return
  }

  const caseRow = await getPaymentCaseById({ client, caseId: payment.case_id })
  if (!caseRow) {
    throw new ValidationError('Payment case not found')
  }

  await confirmPaymentAndActivateCase({
    client,
    payment,
    caseRef: caseRow.case_ref,
    razorpayPaymentId,
  })
}

async function handleFailedPayment(payload: unknown): Promise<void> {
  const entity = getEntity(payload, 'payment')
  const razorpayPaymentId = typeof entity?.id === 'string' ? entity.id : null
  const razorpayOrderId = typeof entity?.order_id === 'string' ? entity.order_id : null

  if (!razorpayPaymentId && !razorpayOrderId) {
    throw new ValidationError('Invalid Razorpay payment webhook')
  }

  const client = createServiceClient()
  const payment = razorpayPaymentId
    ? await getPaymentByRazorpayPaymentId({
        client,
        razorpayPaymentId,
      })
    : null
  const fallbackPayment =
    payment ??
    (razorpayOrderId
      ? await getPaymentByRazorpayOrderId({
          client,
          razorpayOrderId,
        })
      : null)

  if (!fallbackPayment || fallbackPayment.status === 'paid') {
    return
  }

  await markPaymentFailed({
    client,
    paymentId: fallbackPayment.id,
  })

  const patientEmail = await getPatientEmail({
    client,
    patientId: fallbackPayment.patient_id,
  })

  if (patientEmail) {
    await sendPaymentEmail({
      to: patientEmail.email,
      subject: 'Payment was not processed',
      text: 'Payment was not processed. Please try again.',
      html: '<p>Payment was not processed. Please try again.</p>',
    })
  }
}

async function handleProcessedRefund(payload: unknown): Promise<void> {
  const entity = getEntity(payload, 'refund')
  const refundId = typeof entity?.id === 'string' ? entity.id : null
  const razorpayPaymentId = typeof entity?.payment_id === 'string' ? entity.payment_id : null
  const refundAmount = typeof entity?.amount === 'number' ? entity.amount : null

  if (!refundId || !razorpayPaymentId || refundAmount === null) {
    throw new ValidationError('Invalid Razorpay refund webhook')
  }

  const client = createServiceClient()
  const payment = await getPaymentByRazorpayPaymentId({
    client,
    razorpayPaymentId,
  })

  if (!payment || payment.status === 'refunded') {
    return
  }

  await markPaymentRefunded({
    client,
    paymentId: payment.id,
    status: refundAmount >= payment.amount_inr ? 'refunded' : 'partial_refund',
    refundAmountInr: refundAmount,
    refundReason: 'razorpay_webhook',
    refundRazorpayId: refundId,
  })

  await closeCaseAfterRefund({
    client,
    caseId: payment.case_id,
  })

  const patientEmail = await getPatientEmail({
    client,
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
}

export async function POST(request: Request): Promise<Response> {
  try {
    const signature = request.headers.get('razorpay-signature')
    const rawBody = await request.text()
    if (!signature || !verifyWebhookSignature({ body: rawBody, signature })) {
      throw new ValidationError('Invalid Razorpay webhook signature')
    }

    const payload = JSON.parse(rawBody) as unknown
    const event = getWebhookEvent(payload)
    if (!event) {
      return Response.json({ received: true })
    }

    if (event === 'payment.captured') {
      await handleCapturedPayment(payload)
    }

    if (event === 'payment.failed') {
      await handleFailedPayment(payload)
    }

    if (event === 'refund.processed') {
      await handleProcessedRefund(payload)
    }

    await logAudit({
      actorRole: 'system',
      action: 'razorpay_webhook_processed',
      entityType: 'payment',
      metadata: { event },
    })

    return Response.json({ received: true })
  } catch (error) {
    return toApiResponse(error)
  }
}
