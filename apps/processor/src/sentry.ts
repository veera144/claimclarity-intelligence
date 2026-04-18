/**
 * @file sentry.ts
 * @module processor/sentry
 *
 * Processor-side Sentry setup hooks with ClaimClarity PII scrubbing.
 *
 * DEPENDENCIES:
 *   - @claimclarity/shared/sentry (event scrubber)
 *
 * CALLED BY:
 *   - /apps/processor/src/index.ts
 *
 * CALLS:
 *   - process unhandled exception/rejection hooks
 */

import * as Sentry from '@sentry/node'
import {
  scrubSentryEvent,
  safeSentryContext,
  trackSentryErrorBurst,
  type SentrySafeContext,
} from '@claimclarity/shared/sentry'

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
      subject: `ClaimClarity Sentry burst: ${errorType}`,
      text: `${errorType} occurred ${String(count)} times in five minutes.`,
      html: `<p>${errorType} occurred ${String(count)} times in five minutes.</p>`,
    }),
  }).catch(() => undefined)
}

export const processorSentryOptions = {
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || 'development',
  beforeSend: (event) => {
    const scrubbed = scrubSentryEvent(event as unknown as Record<string, unknown>)
    const alert = trackSentryErrorBurst(scrubbed)
    if (alert.shouldAlert) sendBurstAlert(alert.errorType, alert.count)
    return scrubbed as unknown as typeof event
  },
} satisfies Parameters<typeof Sentry.init>[0]

/**
 * Registers processor exception hooks with strict scrubbing.
 *
 * SIDE EFFECTS: installs process-level exception/rejection listeners
 * THROWS: none
 * IDEMPOTENT: yes, only one hook set is installed per process
 *
 * @returns Nothing
 */
export function initializeProcessorSentry(): void {
  if (!processorSentryOptions.dsn || process.env.CLAIMCLARITY_SENTRY_HOOKED === 'true') {
    return
  }

  process.env.CLAIMCLARITY_SENTRY_HOOKED = 'true'
  Sentry.init({
    dsn: processorSentryOptions.dsn,
    environment: processorSentryOptions.environment,
    beforeSend: (event) => processorSentryOptions.beforeSend(event),
  })
  process.on('unhandledRejection', (reason) => {
    Sentry.captureException(reason)
  })
  process.on('uncaughtException', (error) => {
    Sentry.captureException(error)
  })
}

/**
 * Builds the only safe Sentry context ClaimClarity allows.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes
 *
 * @param input - Optional safe case and role context
 * @returns Allowlisted Sentry context
 */
export function buildProcessorSentryContext(input: SentrySafeContext): SentrySafeContext {
  return safeSentryContext(input)
}
