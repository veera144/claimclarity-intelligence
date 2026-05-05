/**
 * @file email.ts
 * @module dashboard/ops
 *
 * Minimal dashboard-side Resend sender for admin pilot case emails.
 */

export type OpsEmail = {
  to: string
  subject: string
  text: string
  html: string
}

export type OpsEmailResult =
  | { status: 'sent'; messageId: string }
  | { status: 'skipped'; reason: string }

type OpsEmailConfig = {
  apiKey: string
  fromEmail: string
}

function getOpsEmailConfig(): OpsEmailConfig | null {
  const apiKey = process.env.RESEND_API_KEY
  const fromEmail = process.env.RESEND_FROM_EMAIL

  if (apiKey && fromEmail) {
    return { apiKey, fromEmail }
  }

  if (process.env.NODE_ENV === 'production') {
    const missing = [
      apiKey ? null : 'RESEND_API_KEY',
      fromEmail ? null : 'RESEND_FROM_EMAIL',
    ].filter((name): name is string => typeof name === 'string')

    throw new Error(`Required environment variable ${missing.join(', ')} is not set`)
  }

  return null
}

export async function sendOpsEmail(email: OpsEmail): Promise<OpsEmailResult> {
  const config = getOpsEmailConfig()

  if (!config) {
    return {
      status: 'skipped',
      reason: 'Resend is not configured in this local/dev environment',
    }
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: config.fromEmail,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
  })

  if (!response.ok) {
    throw new Error(`Resend send failed with status ${String(response.status)}`)
  }

  const payload = (await response.json()) as { id?: unknown }
  if (typeof payload.id !== 'string') throw new Error('Resend returned no message id')
  return { status: 'sent', messageId: payload.id }
}
