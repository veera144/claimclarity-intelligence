/**
 * @file result.ts
 * @module shared/result
 *
 * Result helpers for expected, non-exceptional control flow.
 *
 * DEPENDENCIES:
 *   - none
 *
 * CALLED BY:
 *   - processor pipeline modules
 *
 * CALLS:
 *   - none
 */

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E }

/**
 * Wraps a successful value in the shared Result type.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, returns a new object for the provided value
 *
 * @param value - Success payload to return to the caller
 * @returns A successful Result object
 */
export function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

/**
 * Wraps a handled failure in the shared Result type.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, returns a new object for the provided error
 *
 * @param error - Handled error payload to return to the caller
 * @returns A failed Result object
 */
export function err<E = string>(error: E): Result<never, E> {
  return { ok: false, error }
}
