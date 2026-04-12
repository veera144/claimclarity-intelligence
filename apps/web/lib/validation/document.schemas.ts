/**
 * @file document.schemas.ts
 * @module web/lib/validation
 *
 * Zod schemas and helpers for Module 2 document upload validation.
 *
 * DEPENDENCIES:
 *   - zod
 *   - /packages/shared/src/constants.ts
 *
 * CALLED BY:
 *   - /apps/web/app/api/cases/[caseId]/documents/route.ts
 *   - /apps/web/app/app/upload/page.tsx
 *
 * CALLS:
 *   - none
 */

import { z } from 'zod'
import {
  ACCEPTED_DOCUMENT_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  POLICY_DOC_TYPES,
  REQUIRED_DOC_TYPES,
} from '@claimclarity/shared/constants'

export const DOCUMENT_UPLOAD_DOC_TYPES = [
  ...POLICY_DOC_TYPES,
  'hospital_bill',
  'insurer_response',
  'discharge_summary',
  'preauth_letter',
  'investigation_report',
  'prescription',
  'prior_policy',
  'payment_receipt',
  'prior_correspondence',
  'other',
] as const

export type UploadDocType = (typeof DOCUMENT_UPLOAD_DOC_TYPES)[number]

export const DOCUMENT_UPLOAD_SCHEMA = z.object({
  docType: z.enum(DOCUMENT_UPLOAD_DOC_TYPES),
})

const ACCEPTED_MIME_TYPE_SET = new Set<string>(ACCEPTED_DOCUMENT_MIME_TYPES)

/**
 * Returns whether a document type is required for Module 2 readiness.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, pure predicate
 *
 * @param docType - Document type selected for the upload
 * @returns True when the document belongs to a required upload slot
 */
export function isRequiredUploadDocType(docType: UploadDocType): boolean {
  return (
    docType === 'cis' ||
    REQUIRED_DOC_TYPES.some((requiredDocType) => requiredDocType === docType)
  )
}

/**
 * Validates a browser File before upload.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, pure validation over immutable File metadata
 *
 * @param file - Browser File selected by the patient
 * @returns Patient-facing error text, or null when the file may be uploaded
 */
export function validateUploadFile(file: Pick<File, 'size' | 'type'>): string | null {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const sizeInMb = Math.ceil(file.size / (1024 * 1024))
    return `This file is ${String(sizeInMb)}MB. Maximum is 20MB.`
  }

  if (!ACCEPTED_MIME_TYPE_SET.has(file.type)) {
    return 'Only PDF, JPEG, PNG, and TIFF files are accepted.'
  }

  return null
}
