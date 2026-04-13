/**
 * @file errors.ts
 * @module web/lib/errors
 *
 * Shared domain error primitives for web route handlers.
 *
 * DEPENDENCIES:
 *   - none
 *
 * CALLED BY:
 *   - future /apps/web/app/api routes
 *
 * CALLS:
 *   - Response.json for API-safe error conversion
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

export class ValidationError extends ClaimClarityError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, context)
  }
}

export class AuthorizationError extends ClaimClarityError {
  constructor(message: string) {
    super(message, 'AUTHORIZATION_ERROR', 403)
  }
}

export class ConflictError extends ClaimClarityError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'CONFLICT', 409, context)
  }
}

export class NotFoundError extends ClaimClarityError {
  constructor(entity: string, id: string) {
    super(`${entity} not found`, 'NOT_FOUND', 404, { entity, id })
  }
}

export class ExternalServiceError extends ClaimClarityError {
  constructor(service: string, message: string, context?: Record<string, unknown>) {
    super(`${service}: ${message}`, 'EXTERNAL_SERVICE_ERROR', 502, {
      service,
      ...context
    })
  }
}

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
