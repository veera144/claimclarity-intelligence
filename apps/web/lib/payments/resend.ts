/**
 * @file resend.ts
 * @module web/lib/payments
 *
 * Resend email helper for Module 3 payment notifications.
 *
 * DEPENDENCIES:
 *   - none
 *
 * CALLED BY:
 *   - /apps/web/app/api/payments/verify/route.ts
 *   - /apps/web/app/api/webhooks/razorpay/route.ts
 *   - /apps/web/app/api/admin/payments/[paymentId]/refund/route.ts
 *
 * CALLS:
 *   - Resend REST API when configured
 */

export type PaymentEmailResult =
  | { sent: true; id: string | null }
  | { sent: false; reason: 'missing_config' | 'send_failed' }

type SendPaymentEmailInput = {
  to: string
  subject: string
  text: string
  html: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Sends a payment-related email through Resend when email infrastructure is configured.
 *
 * SIDE EFFECTS: calls Resend REST API when RESEND_API_KEY and RESEND_FROM_EMAIL are set
 * THROWS: never, payment state must not be rolled back by notification infrastructure
 * IDEMPOTENT: no, each successful call sends an email
 *
 * @param input - Email recipient and message content
 * @returns Send result with a machine-readable skip or failure reason
 */
export async function sendPaymentEmail(input: SendPaymentEmailInput): Promise<PaymentEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  const fromEmail = process.env.RESEND_FROM_EMAIL

  if (!apiKey || !fromEmail) {
    console.warn('[payment-email] Resend is not configured; payment email was not sent')
    return { sent: false, reason: 'missing_config' }
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromEmail,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
    })

    const payload = (await response.json().catch(() => null)) as unknown
    if (!response.ok) {
      console.error('[payment-email] Resend send failed', response.status)
      return { sent: false, reason: 'send_failed' }
    }

    return {
      sent: true,
      id: isRecord(payload) && typeof payload.id === 'string' ? payload.id : null,
    }
  } catch (error) {
    console.error('[payment-email] Resend send failed', error)
    return { sent: false, reason: 'send_failed' }
  }
}
