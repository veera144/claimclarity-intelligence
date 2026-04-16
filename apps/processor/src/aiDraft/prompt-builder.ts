/**
 * @file prompt-builder.ts
 * @module processor/ai-draft
 *
 * Privacy-preserving Module 6 prompt assembly from structured Module 5 findings only.
 *
 * DEPENDENCIES:
 *   - @claimclarity/shared/constants
 *
 * CALLED BY:
 *   - /apps/processor/src/jobs/aiDraftJob.ts
 *   - /apps/processor/tests/module6.test.ts
 *
 * CALLS:
 *   - none
 */

import {
  AI_MAX_INPUT_TOKENS,
  AI_MAX_OUTPUT_TOKENS,
} from '@claimclarity/shared/constants'

export type AiDraftPromptCase = {
  id: string
  insurer_name: string | null
  case_type: 'cashless' | 'reimbursement' | null
  claim_amount_inr: number | null
  original_approved_inr: number | null
  originally_deducted_inr: number | null
}

export type AiDraftPromptFinding = {
  id: string
  finding_type: string
  bill_line_item: string | null
  bill_amount_inr: number | null
  confidence_label:
    | 'clause_found_matched'
    | 'based_on_typical_policy'
    | 'insufficient_information'
  clause_reference: string | null
  kb_pattern_id: string | null
  operative_reason: string | null
  appeal_strength: 'strong' | 'moderate' | 'weak' | null
  appeal_basis: string | null
}

export type AiDraftPromptInsurerReason = {
  item_description: string
  deducted_amount_inr: number | null
  stated_reason: string
}

export type AiDraftPromptInput = {
  caseRow: AiDraftPromptCase
  findings: AiDraftPromptFinding[]
  insurerReasons: AiDraftPromptInsurerReason[]
  billSummary: {
    totalBilledPaise: number | null
    originallyApprovedInr: number | null
    deductedInr: number | null
  }
  missingDocuments: string[]
}

export type AiDraftPrompt = {
  prompt: string
  inputTokens: number
  outputTokenLimit: number
}

const FORBIDDEN_INPUT_KEYS = new Set([
  'extracted_text',
  'ocr_text',
  'raw_ocr_text',
  'raw_text',
  'document_body',
  'full_document',
  'full_documents',
  'policy_chunks',
  'full_policy_chunks',
  'bill_lines',
  'full_bill',
  'previous_failed_model_output',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function truncateField(value: string | null, maxLength: number): string {
  if (!value) return 'none'
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 3)}...`
}

function formatWholeRupees(value: number | null): string {
  return value === null ? 'unknown' : value.toLocaleString('en-IN')
}

function formatPaise(value: number | null): string {
  if (value === null) return 'unknown'
  return (value / 100).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  })
}

function scanForForbiddenKeys(value: unknown, path: string): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const result = scanForForbiddenKeys(value[index], `${path}[${String(index)}]`)
      if (result) return result
    }
    return null
  }

  if (!isRecord(value)) return null
  for (const [key, nestedValue] of Object.entries(value)) {
    if (FORBIDDEN_INPUT_KEYS.has(key.toLowerCase())) return `${path}.${key}`
    const result = scanForForbiddenKeys(nestedValue, `${path}.${key}`)
    if (result) return result
  }
  return null
}

function findingLine(finding: AiDraftPromptFinding, detailLimit: number, index: number): string {
  return [
    `${String(index + 1)}. finding_id=${finding.id}`,
    `finding_type=${finding.finding_type}`,
    `bill_item_label=${truncateField(finding.bill_line_item, 120)}`,
    `bill_amount_inr=${finding.bill_amount_inr === null ? 'unknown' : String(finding.bill_amount_inr)} paise`,
    `bill_amount_display_inr=${formatPaise(finding.bill_amount_inr)}`,
    `confidence_label=${finding.confidence_label}`,
    `clause_reference=${truncateField(finding.clause_reference, 100)}`,
    `kb_pattern_id=${finding.kb_pattern_id ?? 'none'}`,
    `operative_reason=${truncateField(finding.operative_reason, detailLimit)}`,
    `appeal_strength=${finding.appeal_strength ?? 'none'}`,
    `appeal_basis=${truncateField(finding.appeal_basis, detailLimit)}`,
  ].join(' | ')
}

function reasonLine(
  reason: AiDraftPromptInsurerReason,
  detailLimit: number,
  index: number
): string {
  return [
    `${String(index + 1)}. item=${truncateField(reason.item_description, 120)}`,
    `deducted_amount_inr=${
      reason.deducted_amount_inr === null ? 'unknown' : String(reason.deducted_amount_inr)
    }`,
    `stated_reason=${truncateField(reason.stated_reason, detailLimit)}`,
  ].join(' | ')
}

function renderPrompt(input: AiDraftPromptInput, detailLimit: number, reasonLimit: number): string {
  const insurerReasons = input.insurerReasons.slice(0, reasonLimit)
  return [
    `Case: ${input.caseRow.insurer_name ?? 'Unknown insurer'}, ${
      input.caseRow.case_type ?? 'unknown case type'
    }, Claim amount: INR ${formatWholeRupees(input.caseRow.claim_amount_inr)}`,
    '',
    'FINDINGS FROM RULES ENGINE:',
    ...input.findings.map((finding, index) => findingLine(finding, detailLimit, index)),
    '',
    'INSURER STATED REASONS:',
    insurerReasons.length > 0
      ? insurerReasons.map((reason, index) => reasonLine(reason, detailLimit, index)).join('\n')
      : 'None identified in structured insurer-letter fields',
    '',
    'BILL SUMMARY:',
    [
      `Total billed: INR ${formatPaise(input.billSummary.totalBilledPaise)}`,
      `Originally approved: INR ${formatWholeRupees(input.billSummary.originallyApprovedInr)}`,
      `Deducted: INR ${formatWholeRupees(input.billSummary.deductedInr)}`,
    ].join(' | '),
    '',
    'MISSING DOCUMENTS:',
    input.missingDocuments.length > 0 ? input.missingDocuments.join(', ') : 'None identified',
  ].join('\n')
}

/**
 * Assembles the Module 6 user prompt and enforces privacy/token constraints.
 *
 * SIDE EFFECTS: none
 * THROWS: Error when raw OCR/full document inputs are present or token budget is exceeded
 * IDEMPOTENT: yes, pure prompt assembly
 * TOKEN COST: Max 3,500 estimated input tokens, output limit fixed at 2,000
 *
 * @param input - Structured case context and Module 5 finding rows
 * @returns User prompt with estimated token metadata
 */
export function buildAiDraftPrompt(input: AiDraftPromptInput): AiDraftPrompt {
  const forbiddenPath = scanForForbiddenKeys(input, 'promptInput')
  if (forbiddenPath) {
    throw new Error(`Forbidden raw document/OCR input passed to AI prompt builder: ${forbiddenPath}`)
  }

  const renderAttempts: Array<[number, number]> = [
    [260, input.insurerReasons.length],
    [140, Math.min(input.insurerReasons.length, 5)],
    [80, Math.min(input.insurerReasons.length, 2)],
    [40, 0],
  ]

  for (const [detailLimit, reasonLimit] of renderAttempts) {
    const prompt = renderPrompt(input, detailLimit, reasonLimit)
    const inputTokens = estimateTokens(prompt)
    if (inputTokens <= AI_MAX_INPUT_TOKENS) {
      return { prompt, inputTokens, outputTokenLimit: AI_MAX_OUTPUT_TOKENS }
    }
  }

  throw new Error(`token_budget_exceeded: estimated input exceeds ${String(AI_MAX_INPUT_TOKENS)}`)
}

/**
 * Estimates tokens with the Module 6 conservative character heuristic.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, pure calculation
 * TOKEN COST: none
 *
 * @param text - Prompt or output text
 * @returns Estimated token count
 */
export function estimateAiDraftTokens(text: string): number {
  return estimateTokens(text)
}
