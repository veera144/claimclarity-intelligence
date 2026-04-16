/**
 * @file insurer-letter-parser.ts
 * @module processor/extraction
 *
 * Parses insurer response OCR into approved/deducted amounts and deduction reasons.
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

import { parseIndianMoneyToWholeRupees } from './money'
import { extractLines, extractTableRows } from './textract-block-utils'

export type DeductionItem = {
  item_description: string
  deducted_amount_inr: number | null
  stated_reason: string
}

export type InsurerLetterData = {
  claim_number: string | null
  policy_number: string | null
  approved_amount_inr: number | null
  deducted_amount_inr: number | null
  deductions: DeductionItem[]
  stated_reason_summary: string | null
}

function firstMatchingValue(lines: string[], labelPattern: RegExp): string | null {
  for (const line of lines) {
    const match = line.match(labelPattern)
    if (match?.[1]) {
      return match[1].trim()
    }
  }

  return null
}

function parseDeductions(blocks: TextractBlock[]): DeductionItem[] {
  return extractTableRows(blocks)
    .map((row) => row.cells.map((cell) => cell.trim()).filter(Boolean))
    .filter((cells) => cells.length >= 2)
    .filter((cells) => !/item|description|amount|reason/iu.test(cells.join(' ')))
    .map((cells) => {
      const amountCell = cells.find((cell) => parseIndianMoneyToWholeRupees(cell) !== null)
      const amount = amountCell ? parseIndianMoneyToWholeRupees(amountCell) : null
      return {
        item_description: cells[0] ?? 'Deduction',
        deducted_amount_inr: amount,
        stated_reason: cells[cells.length - 1] ?? '',
      }
    })
    .filter((item) => item.item_description.length > 0)
}

/**
 * Parses insurer letter OCR into structured claim and deduction data.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, pure transformation
 *
 * @param blocks - Textract blocks from an insurer response document
 * @returns Parsed insurer response data or a handled failure reason
 */
export function parseInsurerLetter(blocks: TextractBlock[]): Result<InsurerLetterData> {
  const lines = extractLines(blocks)
  if (lines.length === 0) {
    return err('No insurer response text lines found.')
  }

  const claimNumber = firstMatchingValue(lines, /claim\s*(?:no|number)\s*[:-]\s*(.+)$/iu)
  const policyNumber = firstMatchingValue(lines, /policy\s*(?:no|number)\s*[:-]\s*(.+)$/iu)
  const approvedText = firstMatchingValue(lines, /approved\s+amount\s*[:-]\s*(.+)$/iu)
  const deductedText = firstMatchingValue(lines, /deducted\s+amount\s*[:-]\s*(.+)$/iu)
  const deductions = parseDeductions(blocks)
  const reasonLine = lines.find((line) => /reason|deduction/iu.test(line)) ?? null

  const data: InsurerLetterData = {
    claim_number: claimNumber,
    policy_number: policyNumber,
    approved_amount_inr: approvedText ? parseIndianMoneyToWholeRupees(approvedText) : null,
    deducted_amount_inr: deductedText ? parseIndianMoneyToWholeRupees(deductedText) : null,
    deductions,
    stated_reason_summary: reasonLine,
  }

  if (
    data.claim_number === null &&
    data.policy_number === null &&
    data.approved_amount_inr === null &&
    data.deducted_amount_inr === null &&
    data.deductions.length === 0
  ) {
    return err('No parseable insurer letter fields found.')
  }

  return ok(data)
}
