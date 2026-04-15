/**
 * @file access-code.ts
 * @module web/lib/payments
 *
 * Server-side validation helpers for hidden Module 3 payment controls.
 *
 * DEPENDENCIES:
 *   - node:crypto
 *
 * CALLED BY:
 *   - /apps/web/app/api/payments/controls/route.ts
 *
 * CALLS:
 *   - none
 */

import { createHash, timingSafeEqual } from 'node:crypto'

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function safeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex')
  const rightBuffer = Buffer.from(right, 'hex')
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

function allowedHashes(): string[] {
  const raw = process.env.INTERNAL_ACCESS_CODE_SHA256_HASHES ?? ''
  return raw
    .split(/[,\s]+/u)
    .map((hash) => hash.trim().toLowerCase())
    .filter((hash) => /^[a-f0-9]{64}$/u.test(hash))
}

/**
 * Checks an internal access code against server-side SHA-256 hashes.
 *
 * SIDE EFFECTS: none
 * THROWS: never
 * IDEMPOTENT: yes, deterministic hash comparison
 *
 * @param accessCode - Internal code submitted to the hidden server endpoint
 * @returns True when the code hash is allowlisted
 */
export function isInternalAccessCodeAllowlisted(accessCode: string): boolean {
  const submittedHash = sha256Hex(accessCode)
  return allowedHashes().some((allowedHash) => safeEquals(submittedHash, allowedHash))
}

/**
 * Determines whether dev/test simulated payment activation is enabled.
 *
 * SIDE EFFECTS: none
 * THROWS: never
 * IDEMPOTENT: yes, reads process environment only
 *
 * @returns True only outside production with explicit env opt-in
 */
export function isTestSimulatedPaymentAllowed(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.ALLOW_TEST_SIMULATED_PAYMENTS === 'true'
}
