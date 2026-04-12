/**
 * @file case-ref.ts
 * @module db/case-ref
 *
 * Generates stable ClaimClarity case reference strings from year and sequence values.
 *
 * DEPENDENCIES:
 *   - none
 *
 * CALLED BY:
 *   - future case creation flows
 *
 * CALLS:
 *   - none
 */

/**
 * Formats a year and sequence number into the canonical case reference format.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, deterministic for the same inputs
 *
 * @param year - Four-digit year for the case reference prefix
 * @param seq - Monotonic case sequence number from case_ref_seq
 * @returns A case reference in CC-YYYY-NNNN format
 */
export function generateCaseRef(year: number, seq: number): string {
  return `CC-${String(year)}-${String(seq).padStart(4, '0')}`
}
