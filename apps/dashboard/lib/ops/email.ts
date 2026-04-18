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

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Required environment variable ${name} is not set`)
  return value
}

export async function sendOpsEmail(email: OpsEmail): Promise<string> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requiredEnv('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: requiredEnv('RESEND_FROM_EMAIL'),
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
  return payload.id
}
