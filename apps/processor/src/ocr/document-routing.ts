/**
 * @file document-routing.ts
 * @module processor/ocr
 *
 * Chooses the Textract extraction mode for a document without making live AWS calls.
 *
 * DEPENDENCIES:
 *   - /packages/shared/src/constants.ts
 *
 * CALLED BY:
 *   - /apps/processor/src/ocr/textract-client.ts
 *   - Module 4 checkpoint tests
 *
 * CALLS:
 *   - none
 */

import { MAX_DOCUMENT_PAGES, MAX_FILE_SIZE_BYTES } from '@claimclarity/shared/constants'

import type { ExtractionMode } from './textract-types'

const TEXTRACT_SYNC_IMAGE_LIMIT_BYTES = 10 * 1024 * 1024

export type ExtractionRoute = {
  mode: ExtractionMode
  reason?: string
}

/**
 * Selects the Textract execution path for a document.
 *
 * PDF/TIFF documents are routed to async S3 DocumentLocation processing so S3 staging is used only
 * for the PDF/TIFF handoff path and Supabase Storage remains canonical.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, pure routing logic
 *
 * @param input - File metadata needed for Textract routing
 * @returns The extraction route or manual-required reason
 */
export function selectExtractionRoute(input: {
  mimeType: string | null
  pageCount: number | null
  fileSizeBytes: number | null
}): ExtractionRoute {
  const fileSizeBytes = input.fileSizeBytes ?? 0
  if (fileSizeBytes > MAX_FILE_SIZE_BYTES) {
    return { mode: 'manual_required', reason: 'Document exceeds the 20MB upload limit.' }
  }

  const pageCount = input.pageCount ?? 1
  if (pageCount > MAX_DOCUMENT_PAGES) {
    return { mode: 'manual_required', reason: 'Document has too many pages for OCR.' }
  }

  if (input.mimeType === 'image/png' || input.mimeType === 'image/jpeg') {
    if (fileSizeBytes > TEXTRACT_SYNC_IMAGE_LIMIT_BYTES) {
      return {
        mode: 'manual_required',
        reason: 'Image exceeds Textract synchronous size limits.',
      }
    }

    return { mode: 'sync_image_bytes' }
  }

  if (input.mimeType === 'application/pdf' || input.mimeType === 'image/tiff') {
    return { mode: 'async_s3_document_location' }
  }

  return { mode: 'manual_required', reason: 'Document type is not supported by Textract.' }
}

