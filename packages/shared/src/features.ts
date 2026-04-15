/**
 * @file features.ts
 * @module shared/features
 *
 * Compile-time feature flags for ClaimClarity V1 scope control.
 *
 * DEPENDENCIES:
 *   - none
 *
 * CALLED BY:
 *   - future feature-gated modules
 *
 * CALLS:
 *   - none
 */

export const FEATURES = {
  HINDI_DOCUMENTS: false,
  EMERGENCY_CASES: false,
  ONCOLOGY_CASES: false,
  BROKER_PORTAL: false,
  EMPLOYER_BILLING: false,
  PRE_APPROVAL_ESTIMATES: false,
  US_MARKET: false,
  AUTOMATED_ASSIGNMENT: false,
  REALTIME_STATUS: true,
  INTERNAL_ACCESS_CODE_WAIVER: true,
  TEST_SIMULATED_PAYMENT: true
} as const

