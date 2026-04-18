/**
 * @file sentry.server.config.ts
 * @module web/sentry
 *
 * Patient app Sentry server options with strict ClaimClarity PII scrubbing.
 */

import * as Sentry from '@sentry/nextjs'
import { scrubSentryEvent, safeSentryContext, trackSentryErrorBurst } from '@claimclarity/shared/sentry'

function sendBurstAlert(errorType: string, count: number): void {
  const apiKey = process.env.RESEND_API_KEY
  const fromEmail = process.env.RESEND_FROM_EMAIL
  const adminEmail = process.env.ADMIN_EMAIL
  if (!apiKey || !fromEmail || !adminEmail) return

  void fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: adminEmail,
      subject: `ClaimClarity web Sentry burst: ${errorType}`,
      text: `${errorType} occurred ${String(count)} times in five minutes.`,
      html: `<p>${errorType} occurred ${String(count)} times in five minutes.</p>`,
    }),
  }).catch(() => undefined)
}

export const sentryServerOptions = {
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || 'development',
  beforeSend: (event) => {
    const scrubbed = scrubSentryEvent(event as unknown as Record<string, unknown>)
    const alert = trackSentryErrorBurst(scrubbed)
    if (alert.shouldAlert) sendBurstAlert(alert.errorType, alert.count)
    return scrubbed as unknown as typeof event
  },
} satisfies Parameters<typeof Sentry.init>[0]

Sentry.init(sentryServerOptions)

export const getSafeWebSentryContext = safeSentryContext
