/**
 * @file sentry.client.config.ts
 * @module dashboard/sentry
 *
 * Dashboard browser Sentry options with strict ClaimClarity PII scrubbing.
 */

import * as Sentry from '@sentry/nextjs'
import { scrubSentryEvent, safeSentryContext } from '@claimclarity/shared/sentry'

export const sentryClientOptions = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || 'development',
  beforeSend: (event) =>
    scrubSentryEvent(event as unknown as Record<string, unknown>) as unknown as typeof event,
} satisfies Parameters<typeof Sentry.init>[0]

Sentry.init(sentryClientOptions)

export const getSafeDashboardClientSentryContext = safeSentryContext
