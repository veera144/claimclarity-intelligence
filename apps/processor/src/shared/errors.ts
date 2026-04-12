/**
 * @file errors.ts
 * @module processor/shared/errors
 *
 * Shared domain error primitives for processor-side modules.
 *
 * DEPENDENCIES:
 *   - none
 *
 * CALLED BY:
 *   - future processor jobs and API adapters
 *
 * CALLS:
 *   - Response.json for API-safe error conversion
 */

/**
 * Base error for all ClaimClarity domain errors.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, constructs an error object only
 *
 * @param message - Human-readable error message for internal use
 * @param code - Stable machine-readable error code
 * @param statusCode - HTTP status code for route adapters
 * @param context - Optional structured context for internal logging
 */
export class ClaimClarityError extends Error {
  public readonly code: string
  public readonly statusCode: number
  public readonly context: Record<string, unknown> | undefined

  constructor(
    message: string,
    code: string,
    statusCode: number = 500,
    context?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'ClaimClarityError'
    this.code = code
    this.statusCode = statusCode
    this.context = context
  }
}

/**
 * Error for invalid user or system input.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes
 *
 * @param message - Validation failure summary
 * @param context - Structured validation context for logs
 */
export class ValidationError extends ClaimClarityError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, context)
  }
}

/**
 * Error for forbidden access attempts.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes
 *
 * @param message - Authorization failure message
 */
export class AuthorizationError extends ClaimClarityError {
  constructor(message: string) {
    super(message, 'AUTHORIZATION_ERROR', 403)
  }
}

/**
 * Error for missing entities.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes
 *
 * @param entity - Missing entity type
 * @param id - Missing entity identifier
 */
export class NotFoundError extends ClaimClarityError {
  constructor(entity: string, id: string) {
    super(`${entity} not found`, 'NOT_FOUND', 404, { entity, id })
  }
}

/**
 * Error for upstream service failures.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes
 *
 * @param service - External dependency name
 * @param message - Upstream error detail
 * @param context - Structured logging context
 */
export class ExternalServiceError extends ClaimClarityError {
  constructor(service: string, message: string, context?: Record<string, unknown>) {
    super(`${service}: ${message}`, 'EXTERNAL_SERVICE_ERROR', 502, {
      service,
      ...context
    })
  }
}

/**
 * Converts unknown errors into safe API responses.
 *
 * SIDE EFFECTS: logs unknown errors to stderr
 * THROWS: none
 * IDEMPOTENT: yes for the same input error
 *
 * @param error - Unknown thrown value from route or handler code
 * @returns A safe HTTP Response object
 */
export function toApiResponse(error: unknown): Response {
  if (error instanceof ClaimClarityError) {
    return Response.json(
      {
        error: error.message,
        code: error.code
      },
      {
        status: error.statusCode
      }
    )
  }

  console.error('[Unhandled error]', error)
  return Response.json({ error: 'Internal server error' }, { status: 500 })
}

export const PATIENT_ERRORS = {
  GENERIC: 'Something went wrong. Please try again.',
  SESSION_EXPIRED: 'Your session has expired. Please log in again.',
  UNAVAILABLE: 'This action is not available right now.'
} as const
