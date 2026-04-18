/**
 * @file sentry.ts
 * @module shared/sentry
 *
 * Strict PII scrubber and safe context helpers for Sentry integrations.
 *
 * DEPENDENCIES:
 *   - none
 *
 * CALLED BY:
 *   - Next.js Sentry config files
 *   - processor Sentry setup
 *   - Module 10 checkpoint tests
 *
 * CALLS:
 *   - none
 */

export type SentrySafeContext = {
  case_id?: string
  case_ref?: string
  user_role?: string
}

export type ScrubbedSentryEvent = Record<string, unknown>

export type SentryBurstAlert = {
  shouldAlert: boolean
  errorType: string
  count: number
}

const SAFE_CONTEXT_KEYS = new Set(['case_id', 'case_ref', 'user_role'])
const BLOCKED_KEY_PATTERNS = [
  /email/u,
  /phone/u,
  /policy/u,
  /document/u,
  /contents?/u,
  /ocr/u,
  /prompt/u,
  /secret/u,
  /token/u,
  /hash/u,
  /signature/u,
  /signed.*url/u,
  /url/u,
  /claim.*amount/u,
  /amount.*claim/u,
  /razorpay/u,
  /api.*key/u,
] as const
const ERROR_BURST_WINDOW_MS = 5 * 60 * 1000
const ERROR_BURST_THRESHOLD = 3
const errorBuckets = new Map<string, number[]>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function shouldBlockKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]+/gu, '_')
  if (SAFE_CONTEXT_KEYS.has(normalized)) return false
  return BLOCKED_KEY_PATTERNS.some((pattern) => pattern.test(normalized))
}

function scrubValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => scrubValue(item))
  if (!isRecord(value)) return value

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      shouldBlockKey(key) ? '[Filtered]' : scrubValue(nestedValue),
    ])
  )
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function exceptionType(event: ScrubbedSentryEvent): string | null {
  const exception = event.exception
  if (!isRecord(exception)) return null
  const values = exception.values
  if (!Array.isArray(values)) return null
  const first = values.find(isRecord)
  if (!first) return null
  return stringField(first.type) ?? stringField(first.value)
}

function eventErrorType(event: ScrubbedSentryEvent): string {
  return (
    exceptionType(event) ??
    stringField(event.transaction) ??
    stringField(event.message) ??
    'unknown_error'
  ).slice(0, 120)
}

/**
 * Builds allowlisted Sentry context from operational metadata.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes
 *
 * @param input - Optional case and user role context
 * @returns Context containing only case_id, case_ref, and user_role
 */
export function safeSentryContext(input: SentrySafeContext): SentrySafeContext {
  return {
    ...(input.case_id ? { case_id: input.case_id } : {}),
    ...(input.case_ref ? { case_ref: input.case_ref } : {}),
    ...(input.user_role ? { user_role: input.user_role } : {}),
  }
}

/**
 * Scrubs a Sentry event before it leaves ClaimClarity systems.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes
 *
 * @param event - Raw event-like payload
 * @returns Event payload with blocked PII, prompts, tokens, URLs, and secrets redacted
 */
export function scrubSentryEvent(event: ScrubbedSentryEvent): ScrubbedSentryEvent {
  return scrubValue(event) as ScrubbedSentryEvent
}

/**
 * Tracks same-error bursts for the Module 10 Sentry alert rule.
 *
 * SIDE EFFECTS: updates an in-memory rolling error bucket
 * THROWS: none
 * IDEMPOTENT: no, each call records one observed error event
 *
 * @param event - Already-scrubbed Sentry event
 * @param now - Optional clock injection
 * @returns Alert decision when the same error type exceeds three events in five minutes
 */
export function trackSentryErrorBurst(
  event: ScrubbedSentryEvent,
  now: Date = new Date()
): SentryBurstAlert {
  const errorType = eventErrorType(event)
  const cutoff = now.getTime() - ERROR_BURST_WINDOW_MS
  const existing = errorBuckets.get(errorType) ?? []
  const next = [...existing.filter((timestamp) => timestamp >= cutoff), now.getTime()]
  errorBuckets.set(errorType, next)

  return {
    errorType,
    count: next.length,
    shouldAlert: next.length === ERROR_BURST_THRESHOLD + 1,
  }
}
