/**
 * @file redaction.ts
 * @module dashboard/ops
 *
 * Safe display and CSV redaction helpers for Module 10 admin operations.
 */

import type { Json } from '@claimclarity/db'

const SAFE_METADATA_KEYS = new Set([
  'case_ref',
  'hours_remaining',
  'sequence_number',
  'email_message_id',
  'job_id',
  'job_type',
  'will_retry',
  'rows_created',
  'report_version',
  'evidence_type',
  'outcome_type',
  'patient_action_type',
  'needs_manual_followup',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function truncateId(value: string | null): string {
  if (!value) return '-'
  return value.length <= 12 ? value : `${value.slice(0, 8)}...${value.slice(-4)}`
}

export function safeMetadata(metadata: Json | null): Record<string, string | number | boolean | null> {
  if (!isRecord(metadata)) return {}

  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => SAFE_METADATA_KEYS.has(key))
      .filter((entry): entry is [string, string | number | boolean | null] => {
        const value = entry[1]
        return (
          typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean' ||
          value === null
        )
      })
  )
}

export function csvEscape(value: string | number | boolean | null): string {
  const text = value === null ? '' : String(value)
  return `"${text.replace(/"/gu, '""')}"`
}
