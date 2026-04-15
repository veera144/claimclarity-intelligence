/**
 * @file payment-flow.ts
 * @module web/lib/payments
 *
 * Shared Module 3 payment activation and notification workflow.
 *
 * DEPENDENCIES:
 *   - /apps/web/lib/payments/resend.ts
 *   - /packages/db/src/queries/payments.queries.ts
 *   - /packages/db/src/queries/documents.queries.ts
 *
 * CALLED BY:
 *   - /apps/web/app/api/payments/verify/route.ts
 *   - /apps/web/app/api/webhooks/razorpay/route.ts
 *
 * CALLS:
 *   - Supabase payments, cases, documents, processing_jobs, users, and audit_log tables
 *   - Resend email API when configured
 */

import {
  activateCaseAfterPayment,
  activateCaseWithoutPayment,
  getPatientEmail,
  listDocumentsForCase,
  logAudit,
  markPaymentPaid,
  queueProcessingJob,
  type DbClient,
  type PaymentMode,
  type PaymentRow,
} from '@claimclarity/db'

import { sendPaymentEmail } from './resend'

type ConfirmPaymentInput = {
  client: DbClient
  payment: PaymentRow
  caseRef: string
  razorpayPaymentId: string
  razorpaySignature?: string
  actorId?: string
}

type ConfirmWithoutPaymentInput = {
  client: DbClient
  caseId: string
  caseRef: string
  mode: Exclude<PaymentMode, 'real_payment'>
  reason: string
  auditAction: string
  actorId: string
  actorRole: 'patient' | 'admin' | 'system'
}

export type ConfirmPaymentResult = {
  success: true
  caseRef: string
  alreadyProcessed: boolean
}

/**
 * Marks a verified payment paid, activates its case, queues OCR jobs, and sends email.
 *
 * SIDE EFFECTS: updates payments/cases, writes processing_jobs/audit_log, may send email
 * THROWS: Error when Supabase mutations fail unexpectedly
 * IDEMPOTENT: yes for already paid rows and downstream OCR job creation
 *
 * @param input - Verified payment row, case reference, and Razorpay confirmation identifiers
 * @returns Confirmation result for the API response
 */
export async function confirmPaymentAndActivateCase(
  input: ConfirmPaymentInput
): Promise<ConfirmPaymentResult> {
  if (input.payment.status === 'paid') {
    return {
      success: true,
      caseRef: input.caseRef,
      alreadyProcessed: true,
    }
  }

  const paidPayment = await markPaymentPaid({
    client: input.client,
    paymentId: input.payment.id,
    razorpayPaymentId: input.razorpayPaymentId,
    ...(input.razorpaySignature ? { razorpaySignature: input.razorpaySignature } : {}),
  })

  await activateCaseAfterPayment({
    client: input.client,
    caseId: input.payment.case_id,
  })

  const documents = await listDocumentsForCase({
    client: input.client,
    caseId: input.payment.case_id,
  })

  await Promise.all(
    documents.map((document) =>
      queueProcessingJob({
        client: input.client,
        caseId: input.payment.case_id,
        documentId: document.id,
        jobType: 'ocr',
        idempotencyKey: `ocr:${input.payment.case_id}:${document.id}`,
      })
    )
  )

  const patientEmail = await getPatientEmail({
    client: input.client,
    patientId: input.payment.patient_id,
  })
  const emailResult = patientEmail
    ? await sendPaymentEmail({
        to: patientEmail.email,
        subject: `Payment received — Case ${input.caseRef} is being processed`,
        text: `Payment received for Case ${input.caseRef}. Your documents are now being processed.`,
        html: `<p>Payment received for Case ${input.caseRef}.</p><p>Your documents are now being processed.</p>`,
      })
    : { sent: false as const, reason: 'missing_config' as const }

  await logAudit({
    actorId: input.actorId ?? input.payment.patient_id,
    actorRole: input.actorId ? 'patient' : 'system',
    action: 'payment_verified',
    entityType: 'payment',
    entityId: paidPayment.id,
    metadata: {
      amount_inr: paidPayment.amount_inr,
      case_ref: input.caseRef,
      email_sent: emailResult.sent,
    },
  })

  return {
    success: true,
    caseRef: input.caseRef,
    alreadyProcessed: false,
  }
}

/**
 * Activates a payment-pending case through an approved non-Razorpay payment mode.
 *
 * SIDE EFFECTS: updates cases, writes processing_jobs/audit_log
 * THROWS: Error when Supabase mutations fail unexpectedly
 * IDEMPOTENT: yes for downstream OCR job creation
 *
 * @param input - Case, mode, and audit details for a waived or simulated activation
 * @returns Confirmation result for the API response
 */
export async function confirmWithoutPaymentAndActivateCase(
  input: ConfirmWithoutPaymentInput
): Promise<ConfirmPaymentResult> {
  await activateCaseWithoutPayment({
    client: input.client,
    caseId: input.caseId,
    mode: input.mode,
    reason: input.reason,
  })

  const documents = await listDocumentsForCase({
    client: input.client,
    caseId: input.caseId,
  })

  await Promise.all(
    documents.map((document) =>
      queueProcessingJob({
        client: input.client,
        caseId: input.caseId,
        documentId: document.id,
        jobType: 'ocr',
        idempotencyKey: `ocr:${input.caseId}:${document.id}`,
      })
    )
  )

  await logAudit({
    actorId: input.actorId,
    actorRole: input.actorRole,
    action: input.auditAction,
    entityType: 'case',
    entityId: input.caseId,
    metadata: {
      case_ref: input.caseRef,
      payment_mode: input.mode,
    },
  })

  return {
    success: true,
    caseRef: input.caseRef,
    alreadyProcessed: false,
  }
}
