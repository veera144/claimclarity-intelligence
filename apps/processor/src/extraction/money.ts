/**
 * @file money.ts
 * @module processor/extraction
 *
 * Money parsing helpers for OCR-derived Indian rupee values.
 *
 * DEPENDENCIES:
 *   - /packages/shared/src/constants.ts
 *
 * CALLED BY:
 *   - /apps/processor/src/extraction/bill-normalizer.ts
 *   - /apps/processor/src/extraction/insurer-letter-parser.ts
 *
 * CALLS:
 *   - none
 */

import { RUPEES_PER_PAISE } from '@claimclarity/shared/constants'

const MONEY_PATTERN = /(?:rs\.?|inr|₹)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/iu

function parseRupeeNumber(value: string): number | null {
  const match = value.replace(/\s+/gu, ' ').match(MONEY_PATTERN)
  if (!match) {
    return null
  }

  const numericText = match[1]?.replace(/,/gu, '')
  if (!numericText) {
    return null
  }

  const numeric = Number(numericText)
  return Number.isFinite(numeric) ? numeric : null
}

/**
 * Parses rupee text into paise.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, pure parsing
 *
 * @param value - OCR text containing a rupee amount
 * @returns Amount in paise or null when unparsable
 */
export function parseIndianMoneyToPaise(value: string): number | null {
  const rupees = parseRupeeNumber(value)
  return rupees === null ? null : Math.round(rupees * RUPEES_PER_PAISE)
}

/**
 * Parses rupee text into whole rupees.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, pure parsing
 *
 * @param value - OCR text containing a rupee amount
 * @returns Amount in whole rupees or null when unparsable
 */
export function parseIndianMoneyToWholeRupees(value: string): number | null {
  const rupees = parseRupeeNumber(value)
  return rupees === null ? null : Math.round(rupees)
}

