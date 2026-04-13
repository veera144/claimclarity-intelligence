/**
 * @file razorpay.ts
 * @module web/lib/payments
 *
 * Razorpay API and signature helpers for Module 3 payment flows.
 *
 * DEPENDENCIES:
 *   - node:crypto
 *   - /apps/web/lib/errors.ts
 *
 * CALLED BY:
 *   - /apps/web/app/api/payments/create/route.ts
 *   - /apps/web/app/api/payments/verify/route.ts
 *   - /apps/web/app/api/webhooks/razorpay/route.ts
 *   - /apps/web/app/api/admin/payments/[paymentId]/refund/route.ts
 *
 * CALLS:
 *   - Razorpay REST API
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

import { ExternalServiceError } from '../errors'

export type RazorpayOrder = {
  id: string
  amount: number
  currency: 'INR'
}

export type RazorpayRefund = {
  id: string
  amount: number
}

const DEFAULT_RAZORPAY_API_BASE_URL = 'https://api.razorpay.com/v1'

function getRazorpayApiBaseUrl(): string {
  return process.env.RAZORPAY_API_BASE_URL ?? DEFAULT_RAZORPAY_API_BASE_URL
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new ExternalServiceError('Razorpay', 'Payment service is not configured')
  }
  return value
}

function basicAuthHeader(): string {
  const keyId = requireEnv('RAZORPAY_KEY_ID')
  const keySecret = requireEnv('RAZORPAY_KEY_SECRET')
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`, 'utf8').toString('base64')}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

/**
 * Reads the Razorpay key id used by checkout.
 *
 * SIDE EFFECTS: none
 * THROWS: ExternalServiceError when Razorpay env is missing
 * IDEMPOTENT: yes, reads process state only
 *
 * @returns Razorpay key id
 */
export function getRazorpayKeyId(): string {
  return requireEnv('RAZORPAY_KEY_ID')
}

/**
 * Creates a Razorpay order for the report fee.
 *
 * SIDE EFFECTS: calls Razorpay order creation API
 * THROWS: ExternalServiceError when Razorpay rejects the request or returns malformed data
 * IDEMPOTENT: no, each successful call creates a new gateway order
 *
 * @param input - Report fee, case receipt, and order notes
 * @returns Razorpay order id, amount, and currency
 */
export async function createRazorpayOrder(input: {
  amount: number
  receipt: string
  notes: Record<string, string>
}): Promise<RazorpayOrder> {
  const response = await fetch(`${getRazorpayApiBaseUrl()}/orders`, {
    method: 'POST',
    headers: {
      Authorization: basicAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: input.amount,
      currency: 'INR',
      receipt: input.receipt,
      notes: input.notes,
    }),
  })

  const payload = await parseJsonResponse(response)
  if (!response.ok) {
    throw new ExternalServiceError('Razorpay', 'Unable to create payment order')
  }

  if (
    !isRecord(payload) ||
    typeof payload.id !== 'string' ||
    typeof payload.amount !== 'number' ||
    payload.currency !== 'INR'
  ) {
    throw new ExternalServiceError('Razorpay', 'Payment order response was invalid')
  }

  return {
    id: payload.id,
    amount: payload.amount,
    currency: 'INR',
  }
}

/**
 * Creates a Razorpay refund for a captured report payment.
 *
 * SIDE EFFECTS: calls Razorpay refund API
 * THROWS: ExternalServiceError when Razorpay rejects the request or returns malformed data
 * IDEMPOTENT: no, Razorpay treats each successful call as a refund request
 *
 * @param input - Razorpay payment id, refund amount in paise, and reason
 * @returns Razorpay refund id and amount
 */
export async function createRazorpayRefund(input: {
  razorpayPaymentId: string
  amount: number
  reason: string
}): Promise<RazorpayRefund> {
  const response = await fetch(
    `${getRazorpayApiBaseUrl()}/payments/${encodeURIComponent(input.razorpayPaymentId)}/refund`,
    {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: input.amount,
        notes: {
          reason: input.reason,
        },
      }),
    }
  )

  const payload = await parseJsonResponse(response)
  if (!response.ok) {
    throw new ExternalServiceError('Razorpay', 'Unable to create refund')
  }

  if (!isRecord(payload) || typeof payload.id !== 'string' || typeof payload.amount !== 'number') {
    throw new ExternalServiceError('Razorpay', 'Refund response was invalid')
  }

  return {
    id: payload.id,
    amount: payload.amount,
  }
}

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'utf8')
  const rightBuffer = Buffer.from(right, 'utf8')
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

/**
 * Verifies a Razorpay checkout payment signature.
 *
 * SIDE EFFECTS: none
 * THROWS: ExternalServiceError when Razorpay env is missing
 * IDEMPOTENT: yes, deterministic HMAC verification
 *
 * @param input - Razorpay order id, payment id, and signature from checkout
 * @returns True when the signature is valid
 */
export function verifyCheckoutSignature(input: {
  razorpayOrderId: string
  razorpayPaymentId: string
  signature: string
}): boolean {
  const expected = createHmac('sha256', requireEnv('RAZORPAY_KEY_SECRET'))
    .update(`${input.razorpayOrderId}|${input.razorpayPaymentId}`)
    .digest('hex')

  return safeEquals(expected, input.signature)
}

/**
 * Verifies a Razorpay webhook signature against the raw request body.
 *
 * SIDE EFFECTS: none
 * THROWS: ExternalServiceError when Razorpay webhook env is missing
 * IDEMPOTENT: yes, deterministic HMAC verification
 *
 * @param input - Raw webhook body and Razorpay-Signature header
 * @returns True when the signature is valid
 */
export function verifyWebhookSignature(input: { body: string; signature: string }): boolean {
  const expected = createHmac('sha256', requireEnv('RAZORPAY_WEBHOOK_SECRET'))
    .update(input.body)
    .digest('hex')

  return safeEquals(expected, input.signature)
}
