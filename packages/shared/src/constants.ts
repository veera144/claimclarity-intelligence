/**
 * @file constants.ts
 * @module shared/constants
 *
 * Centralized ClaimClarity constants used across apps and packages.
 *
 * DEPENDENCIES:
 *   - none
 *
 * CALLED BY:
 *   - /apps/processor/src/index.ts
 *   - /packages/db/src/case-ref.ts
 *
 * CALLS:
 *   - none
 */

export const REPORT_PRICE_PAISE = 69900
export const EXPERT_CALL_PRICE_PAISE = 29900
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024
export const SLA_HOURS = 24
export const SLA_WARNING_HOURS = 4
export const DOCUMENT_RETENTION_DAYS = 90
export const TOMBSTONE_USER_ID = '00000000-0000-0000-0000-000000000000'
export const HIGH_VALUE_CLAIM_INR = 200_000
export const HIGH_VALUE_BILL_LINE_PAISE = 20_000_000
export const OCR_CONFIDENCE_THRESHOLD = 0.6
export const KEYWORD_SCORE_THRESHOLD = 1
export const SIMILARITY_THRESHOLD = 0.7
export const JOB_MAX_CONCURRENCY = 5
export const JOB_RETRY_BASE_MINUTES = 2
export const FOLLOW_UP_DAYS = [30, 60, 90] as const
export const OUTCOME_TOKEN_TTL_DAYS = 7
export const REQUIRED_DOC_TYPES = ['policy', 'hospital_bill', 'insurer_response'] as const
export const POLICY_DOC_TYPES = ['policy', 'cis'] as const
export const ACCEPTED_DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/tiff'
] as const
export const MAX_DOCUMENT_PAGES = 50
export const MIN_IMAGE_DPI = 100
export const REQUIRED_CONSENT_TYPES = [
  'data_processing',
  'no_training',
  'retention_policy',
  'informational_only',
  'terms_of_service'
] as const
export const RUPEES_PER_PAISE = 100
export const AI_MAX_INPUT_TOKENS = 3500
export const AI_MAX_OUTPUT_TOKENS = 2000
export const AI_INPUT_WARN_THRESHOLD = 3000

