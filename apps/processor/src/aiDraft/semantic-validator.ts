/**
 * @file semantic-validator.ts
 * @module processor/ai-draft
 *
 * Deterministic semantic safety checks for Module 6 AI draft output.
 *
 * DEPENDENCIES:
 *   - /apps/processor/src/aiDraft/schema.ts
 *
 * CALLED BY:
 *   - /apps/processor/src/jobs/aiDraftJob.ts
 *   - /apps/processor/tests/module6.test.ts
 *
 * CALLS:
 *   - none
 */

import type { AiDraftResponse } from './schema'

export const INSUFFICIENT_INFORMATION_EXPLANATION =
  'This item could not be assessed from the available documents. A reviewer will clarify.'

export const TYPICAL_POLICY_SUFFIX =
  'Please verify this against your specific policy wording.'

const FORBIDDEN_PHRASES = [
  'you are entitled to',
  'insurer is wrong',
  'hospital overcharged',
  'breach of contract',
  'statutory right',
  'negligence',
  'fraud',
  'will be approved',
  'will be paid',
  'guaranteed',
  'covered for sure',
] as const

const FINAL_CLAIM_PATTERNS = [
  /\bclaim\s+(will|must|shall)\s+(be\s+)?(approved|paid|reimbursed|denied|rejected)\b/iu,
  /\b(will|must|shall)\s+(approve|pay|reimburse|deny|reject)\b/iu,
  /\b(is|are|was|were)\s+(definitely\s+)?(covered|payable|admissible)\b/iu,
  /\bnot\s+(covered|payable|admissible)\b/iu,
  /\bmedical(?:ly)?\s+(necessary|unnecessary|correct|incorrect)\b/iu,
  /\blegal\s+(liability|right|entitlement)\b/iu,
  /\bliable\b/iu,
] as const

export type AiDraftFindingForValidation = {
  id: string
  confidence_label:
    | 'clause_found_matched'
    | 'based_on_typical_policy'
    | 'insufficient_information'
  clause_reference: string | null
}

export type SemanticValidationResult =
  | { ok: true }
  | { ok: false; reason: string }

function allText(output: AiDraftResponse): string {
  return [
    ...output.findings_explained.map((finding) => finding.plain_language_explanation),
    ...output.hospital_questions,
    ...output.insurer_questions,
    ...output.appeal_points.flatMap((point) => [point.point, point.basis]),
    output.appeal_letter_draft,
    output.scope_notes,
  ].join('\n')
}

function normalizedCounts(values: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return counts
}

function fail(reason: string): SemanticValidationResult {
  return { ok: false, reason }
}

/**
 * Validates Module 6 safety rules after strict schema parsing.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, pure validation
 * TOKEN COST: none
 *
 * @param output - Strict-schema AI or fallback draft
 * @param findings - Full finding ids and confidence metadata sent in the prompt
 * @returns Semantic validation pass/fail with a deterministic reason
 */
export function validateAiDraftSemantics(
  output: AiDraftResponse,
  findings: AiDraftFindingForValidation[]
): SemanticValidationResult {
  const promptedIds = findings.map((finding) => finding.id)
  const outputIds = output.findings_explained.map((finding) => finding.finding_id)
  const promptedCounts = normalizedCounts(promptedIds)
  const outputCounts = normalizedCounts(outputIds)

  for (const [findingId, count] of promptedCounts) {
    if (count !== 1) return fail(`Prompt included duplicate finding_id ${findingId}`)
    if (outputCounts.get(findingId) !== 1) {
      return fail(`finding_id ${findingId} missing, duplicated, or transformed`)
    }
  }

  for (const outputId of outputIds) {
    if (!promptedCounts.has(outputId)) return fail(`Unexpected finding_id ${outputId}`)
  }

  const text = allText(output)
  const lowered = text.toLowerCase()
  for (const phrase of FORBIDDEN_PHRASES) {
    if (lowered.includes(phrase)) return fail(`Forbidden phrase present: ${phrase}`)
  }

  for (const pattern of FINAL_CLAIM_PATTERNS) {
    if (pattern.test(text)) {
      return fail('Final coverage, payout, legal, medical, or fraud-like claim detected')
    }
  }

  const explanationById = new Map(
    output.findings_explained.map((finding) => [
      finding.finding_id,
      finding.plain_language_explanation,
    ])
  )

  for (const finding of findings) {
    const explanation = explanationById.get(finding.id)
    if (!explanation) return fail(`Missing explanation for ${finding.id}`)

    if (
      finding.confidence_label === 'insufficient_information' &&
      explanation !== INSUFFICIENT_INFORMATION_EXPLANATION
    ) {
      return fail(`insufficient_information wording mismatch for ${finding.id}`)
    }

    if (finding.confidence_label === 'based_on_typical_policy') {
      if (!explanation.toLowerCase().includes('typical policy pattern')) {
        return fail(`typical-policy disclosure missing for ${finding.id}`)
      }
      if (!explanation.endsWith(TYPICAL_POLICY_SUFFIX)) {
        return fail(`typical-policy verification suffix missing for ${finding.id}`)
      }
    }

    if (
      finding.confidence_label === 'clause_found_matched' &&
      finding.clause_reference &&
      !explanation.includes(finding.clause_reference)
    ) {
      return fail(`clause_reference missing from explanation for ${finding.id}`)
    }
  }

  if (!output.appeal_letter_draft.includes('bimabharosa.irdai.gov.in')) {
    return fail('Bima Bharosa URL missing from appeal letter')
  }

  const appealPointWithoutBasis = output.appeal_points.find(
    (point) => !/clause|kb pattern/iu.test(point.basis)
  )
  if (appealPointWithoutBasis) {
    return fail('Appeal point basis does not cite a clause or KB pattern')
  }

  return { ok: true }
}
