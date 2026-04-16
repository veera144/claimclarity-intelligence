/**
 * @file fallback.ts
 * @module processor/ai-draft
 *
 * Deterministic Module 6 fallback draft generation.
 *
 * DEPENDENCIES:
 *   - @claimclarity/shared/constants
 *   - /apps/processor/src/aiDraft/prompt-builder.ts
 *   - /apps/processor/src/aiDraft/schema.ts
 *   - /apps/processor/src/aiDraft/semantic-validator.ts
 *
 * CALLED BY:
 *   - /apps/processor/src/jobs/aiDraftJob.ts
 *   - /apps/processor/tests/module6.test.ts
 *
 * CALLS:
 *   - /apps/processor/src/aiDraft/schema.ts
 *   - /apps/processor/src/aiDraft/semantic-validator.ts
 */

import {
  AI_DRAFT_PROMPT_VERSION,
  AI_DRAFT_SCHEMA_VERSION,
} from '@claimclarity/shared/constants'

import { estimateAiDraftTokens, type AiDraftPromptFinding } from './prompt-builder'
import { parseAiDraftResponse, type AiDraftResponse } from './schema'
import {
  INSUFFICIENT_INFORMATION_EXPLANATION,
  TYPICAL_POLICY_SUFFIX,
  validateAiDraftSemantics,
} from './semantic-validator'

function lineLabel(finding: AiDraftPromptFinding): string {
  return finding.bill_line_item ?? 'this item'
}

function basisForFinding(finding: AiDraftPromptFinding): string {
  if (finding.clause_reference) return `Clause ${finding.clause_reference}`
  return `KB pattern ${finding.kb_pattern_id ?? 'Module 5 reviewer clarification'}`
}

function explainFinding(finding: AiDraftPromptFinding): string {
  if (finding.confidence_label === 'insufficient_information') {
    return INSUFFICIENT_INFORMATION_EXPLANATION
  }

  if (finding.confidence_label === 'based_on_typical_policy') {
    return [
      `${lineLabel(finding)} appears to match a typical policy pattern from Module 5.`,
      finding.operative_reason ?? 'A reviewer should compare the item with the policy wording.',
      TYPICAL_POLICY_SUFFIX,
    ].join(' ')
  }

  const clauseText = finding.clause_reference
    ? `Clause ${finding.clause_reference}`
    : 'The matched clause'
  return [
    `${clauseText} appears relevant to ${lineLabel(finding)} based on the Module 5 finding.`,
    finding.operative_reason ?? 'A reviewer should confirm the clause wording before patient delivery.',
  ].join(' ')
}

function hospitalQuestions(findings: AiDraftPromptFinding[]): string[] {
  return findings
    .filter((finding) => finding.bill_line_item)
    .slice(0, 5)
    .map(
      (finding) =>
        `Please share the itemized breakup and supporting bill note for ${lineLabel(finding)}.`
    )
}

function insurerQuestions(findings: AiDraftPromptFinding[]): string[] {
  return findings.slice(0, 5).map((finding) => {
    const basis = basisForFinding(finding)
    return `Please explain how ${basis} was applied to ${lineLabel(finding)} and share the calculation used.`
  })
}

function appealPoints(findings: AiDraftPromptFinding[]): AiDraftResponse['appeal_points'] {
  return findings
    .filter((finding) => finding.appeal_strength !== null)
    .slice()
    .sort((left, right) => {
      const rank = { strong: 1, moderate: 2, weak: 3 }
      return rank[left.appeal_strength ?? 'weak'] - rank[right.appeal_strength ?? 'weak']
    })
    .slice(0, 6)
    .map((finding) => ({
      point:
        finding.appeal_basis ??
        `Ask the reviewer to verify ${lineLabel(finding)} against the Module 5 basis.`,
      strength: finding.appeal_strength ?? 'weak',
      basis: basisForFinding(finding),
    }))
}

function appealLetterDraft(findings: AiDraftPromptFinding[]): string {
  const focusItems = findings
    .slice(0, 4)
    .map((finding) => `${lineLabel(finding)} (${basisForFinding(finding)})`)
    .join('; ')

  return [
    'To the Claims Review Team,',
    '',
    'Please review the deduction details for this health insurance matter. The reviewer-facing draft is based on structured findings only, including the following items:',
    focusItems || 'Module 5 findings requiring reviewer clarification.',
    '',
    'Kindly share the clause wording, calculation method, and any additional document requirement relied on for these items. The patient may want to ask for this clarification before taking the next step.',
    '',
    'If the response remains unclear after review, the patient may refer to IRDAI Bima Bharosa at bimabharosa.irdai.gov.in for grievance submission guidance.',
    '',
    'Regards,',
    'ClaimClarity Reviewer Draft',
  ].join('\n')
}

/**
 * Builds a deterministic schema-valid fallback draft from Module 5 findings.
 *
 * SIDE EFFECTS: none
 * THROWS: Error if the fallback somehow fails schema or semantic validation
 * IDEMPOTENT: yes, pure deterministic rendering
 * TOKEN COST: none
 *
 * @param findings - Structured Module 5 finding rows from the prompt
 * @returns Safe reviewer-gated AI draft response
 */
export function buildDeterministicFallback(findings: AiDraftPromptFinding[]): AiDraftResponse {
  const draft = parseAiDraftResponse({
    schema_version: AI_DRAFT_SCHEMA_VERSION,
    prompt_version: AI_DRAFT_PROMPT_VERSION,
    findings_explained: findings.map((finding) => ({
      finding_id: finding.id,
      plain_language_explanation: explainFinding(finding),
    })),
    hospital_questions: hospitalQuestions(findings),
    insurer_questions: insurerQuestions(findings),
    appeal_points: appealPoints(findings),
    appeal_letter_draft: appealLetterDraft(findings),
    scope_notes:
      'Reviewer-facing deterministic draft from Module 5 findings only. Patient delivery remains blocked until human review.',
  })

  const validation = validateAiDraftSemantics(draft, findings)
  if (!validation.ok) {
    throw new Error(`Deterministic fallback failed semantic validation: ${validation.reason}`)
  }

  return draft
}

/**
 * Estimates fallback output tokens for audit metadata.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, pure calculation
 * TOKEN COST: none
 *
 * @param draft - Deterministic or provider draft
 * @returns Estimated output token count
 */
export function estimateDraftOutputTokens(draft: AiDraftResponse): number {
  return estimateAiDraftTokens(JSON.stringify(draft))
}
