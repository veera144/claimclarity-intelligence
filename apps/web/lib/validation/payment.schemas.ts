/**
 * @file payment.schemas.ts
 * @module web/lib/validation
 *
 * Zod schemas for Module 3 payment API inputs.
 *
 * DEPENDENCIES:
 *   - zod
 *
 * CALLED BY:
 *   - /apps/web/app/api/payments/create/route.ts
 *   - /apps/web/app/api/payments/verify/route.ts
 *   - /apps/web/app/api/admin/payments/[paymentId]/refund/route.ts
 *
 * CALLS:
 *   - none
 */

import { z } from 'zod'

export const CREATE_PAYMENT_ORDER_SCHEMA = z.object({
  caseId: z.string().uuid(),
})

export const VERIFY_PAYMENT_SCHEMA = z.object({
  caseId: z.string().uuid(),
  razorpay_payment_id: z.string().min(1).max(128),
  razorpay_order_id: z.string().min(1).max(128),
  razorpay_signature: z.string().min(1).max(256),
})

export const REFUND_PAYMENT_SCHEMA = z.object({
  reason: z.string().min(1).max(500),
  refundType: z.enum(['full', 'partial']),
  amount: z.number().int().positive().optional(),
})

export const PAYMENT_CONTROLS_SCHEMA = z.discriminatedUnion('mode', [
  z.object({
    caseId: z.string().uuid(),
    mode: z.literal('admin_waived'),
    reason: z.string().min(1).max(500),
  }),
  z.object({
    caseId: z.string().uuid(),
    mode: z.literal('internal_access_code'),
    accessCode: z.string().min(1).max(128),
  }),
  z.object({
    caseId: z.string().uuid(),
    mode: z.literal('test_simulated'),
  }),
])

export type CreatePaymentOrderInput = z.infer<typeof CREATE_PAYMENT_ORDER_SCHEMA>
export type VerifyPaymentInput = z.infer<typeof VERIFY_PAYMENT_SCHEMA>
export type RefundPaymentInput = z.infer<typeof REFUND_PAYMENT_SCHEMA>
export type PaymentControlsInput = z.infer<typeof PAYMENT_CONTROLS_SCHEMA>
