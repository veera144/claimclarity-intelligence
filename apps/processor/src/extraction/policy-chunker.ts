/**
 * @file policy-chunker.ts
 * @module processor/extraction
 *
 * Chunks policy and CIS OCR lines into structured clause sections.
 *
 * DEPENDENCIES:
 *   - /packages/shared/src/result.ts
 *   - /apps/processor/src/extraction/textract-block-utils.ts
 *
 * CALLED BY:
 *   - /apps/processor/src/jobs/ocr-job.ts
 *   - Module 4 checkpoint tests
 *
 * CALLS:
 *   - none
 */

import { err, ok, type Result } from '@claimclarity/shared/result'

import type { TextractBlock } from '../ocr/textract-types'

import { extractLines } from './textract-block-utils'

export type PolicyChunk = {
  heading: string
  clause_category: string
  text: string
  word_count: number
  page_number: number
}

const HEADING_PATTERN =
  /^(INCLUSIONS|EXCLUSIONS|DEFINITIONS|WAITING PERIOD|ROOM RENT|CO-PAYMENT|CO-PAY|SUB-LIMITS|PRE-EXISTING|MATERNITY|DOMICILIARY|DAYCARE|DEDUCTIBLE)\s*:?\s*$/iu

function isHeading(line: string): boolean {
  const trimmed = line.trim()
  return HEADING_PATTERN.test(trimmed) || (trimmed.length > 3 && trimmed === trimmed.toUpperCase())
}

function clauseCategory(heading: string): string {
  const text = heading.toUpperCase()
  if (text.includes('ROOM')) return 'room_rent'
  if (text.includes('CO-PAY') || text.includes('CO-PAYMENT')) return 'copay'
  if (text.includes('WAITING')) return 'waiting_period'
  if (text.includes('EXCLUSION')) return 'exclusion'
  if (text.includes('SUB-LIMIT')) return 'sublimit'
  if (text.includes('PRE-EXISTING')) return 'pre_existing'
  return 'general'
}

function wordCount(text: string): number {
  return text.split(/\s+/u).filter(Boolean).length
}

/**
 * Converts policy/CIS OCR lines into clause chunks.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, pure transformation
 *
 * @param blocks - Textract blocks from a policy or CIS document
 * @returns Policy chunks or a handled failure reason
 */
export function chunkPolicy(blocks: TextractBlock[]): Result<PolicyChunk[]> {
  const lines = extractLines(blocks)
  if (lines.length === 0) {
    return err('No policy text lines found.')
  }

  const chunks: PolicyChunk[] = []
  let currentHeading = 'GENERAL'
  let currentLines: string[] = []

  const flush = (): void => {
    const text = currentLines.join(' ').trim()
    if (!text) {
      return
    }

    chunks.push({
      heading: currentHeading,
      clause_category: clauseCategory(currentHeading),
      text,
      word_count: wordCount(text),
      page_number: 1,
    })
  }

  for (const line of lines) {
    if (isHeading(line)) {
      flush()
      currentHeading = line.trim()
      currentLines = []
      continue
    }

    currentLines.push(line)
  }

  flush()

  if (chunks.length === 0) {
    return err('No policy clauses could be chunked.')
  }

  return ok(chunks)
}
