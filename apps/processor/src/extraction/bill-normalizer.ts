/**
 * @file bill-normalizer.ts
 * @module processor/extraction
 *
 * Normalizes Textract table output from hospital bills into bill line items.
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

import { parseIndianMoneyToPaise } from './money'
import { extractTableRows } from './textract-block-utils'

export type NormalizedBillLine = {
  line_item: string
  quantity: number | null
  unit_rate_inr: number | null
  total_inr: number
  bill_category: string
  page_number: number
}

const HEADER_KEYWORDS = ['item', 'description', 'amount', 'qty', 'quantity', 'rate', 'total']
const TOTAL_ROW_PATTERN = /\b(grand\s+total|net\s+total|sub\s*total|total)\b/iu

function normalizeCategory(lineItem: string): string {
  const text = lineItem.toLowerCase()
  if (text.includes('room')) return 'room_charges'
  if (text.includes('icu')) return 'icu_charges'
  if (text.includes('nurs')) return 'nursing'
  if (text.includes('doctor') || text.includes('consult')) return 'doctor_fees'
  if (text.includes('ot') || text.includes('theatre')) return 'ot_charges'
  if (text.includes('anaesth')) return 'anaesthesia'
  if (text.includes('pharma') || text.includes('drug') || text.includes('med')) return 'pharmacy'
  if (text.includes('consumable') || text.includes('disposable')) return 'consumables'
  if (text.includes('lab') || text.includes('invest') || text.includes('radiol')) return 'investigations'
  if (text.includes('implant') || text.includes('prosth')) return 'implants'
  if (text.includes('ambulance')) return 'ambulance'
  return 'miscellaneous'
}

function parseQuantity(value: string | undefined): number | null {
  if (!value) {
    return null
  }

  const numeric = Number(value.replace(/,/gu, '').trim())
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null
}

function isHeaderRow(cells: string[]): boolean {
  const compact = cells.join(' ').toLowerCase()
  const keywordMatches = HEADER_KEYWORDS.filter((keyword) => compact.includes(keyword)).length
  return keywordMatches >= 2
}

function lastMoneyCell(cells: string[]): string | null {
  for (let index = cells.length - 1; index >= 0; index -= 1) {
    const cell = cells[index]
    if (cell && parseIndianMoneyToPaise(cell) !== null) {
      return cell
    }
  }

  return null
}

/**
 * Converts Textract TABLE rows into normalized hospital bill lines.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, pure transformation
 *
 * @param blocks - Textract blocks from a hospital bill
 * @returns Normalized bill lines or a handled failure reason
 */
export function normalizeBillLines(blocks: TextractBlock[]): Result<NormalizedBillLine[]> {
  const rows = extractTableRows(blocks)
  if (rows.length === 0) {
    return err('No Textract table rows found in hospital bill.')
  }

  const lines: NormalizedBillLine[] = []

  for (const row of rows) {
    const cells = row.cells.map((cell) => cell.trim()).filter(Boolean)
    if (cells.length < 2 || isHeaderRow(cells)) {
      continue
    }

    const lineItem = cells[0] ?? ''
    if (!lineItem || TOTAL_ROW_PATTERN.test(lineItem)) {
      continue
    }

    const totalCell = lastMoneyCell(cells)
    const total = totalCell ? parseIndianMoneyToPaise(totalCell) : null
    if (total === null || total <= 0) {
      continue
    }

    const quantity = parseQuantity(cells[1])
    const unitRate = cells.length >= 4 ? parseIndianMoneyToPaise(cells[cells.length - 2] ?? '') : null

    lines.push({
      line_item: lineItem,
      quantity,
      unit_rate_inr: unitRate,
      total_inr: total,
      bill_category: normalizeCategory(lineItem),
      page_number: row.page,
    })
  }

  if (lines.length === 0) {
    return err('No parseable bill line items found.')
  }

  return ok(lines)
}
