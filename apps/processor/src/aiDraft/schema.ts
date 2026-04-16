/**
 * @file schema.ts
 * @module processor/ai-draft
 *
 * Module 6 strict AI draft response schemas and parse helpers.
 *
 * DEPENDENCIES:
 *   - zod (runtime validation)
 *   - @claimclarity/shared/constants
 *
 * CALLED BY:
 *   - /apps/processor/src/aiDraft/*.ts
 *   - /apps/processor/tests/module6.test.ts
 *
 * CALLS:
 *   - none
 */

import { z } from 'zod'
import {
  AI_DRAFT_PROMPT_VERSION,
  AI_DRAFT_SCHEMA_VERSION,
} from '@claimclarity/shared/constants'

export const AI_DRAFT_RESPONSE_SCHEMA_NAME = 'claimclarity_ai_draft_response'

export const aiDraftJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'prompt_version',
    'findings_explained',
    'hospital_questions',
    'insurer_questions',
    'appeal_points',
    'appeal_letter_draft',
    'scope_notes',
  ],
  properties: {
    schema_version: { type: 'string', const: AI_DRAFT_SCHEMA_VERSION },
    prompt_version: { type: 'string', const: AI_DRAFT_PROMPT_VERSION },
    findings_explained: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['finding_id', 'plain_language_explanation'],
        properties: {
          finding_id: { type: 'string', minLength: 1 },
          plain_language_explanation: { type: 'string', minLength: 1 },
        },
      },
    },
    hospital_questions: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
    },
    insurer_questions: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
    },
    appeal_points: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['point', 'strength', 'basis'],
        properties: {
          point: { type: 'string', minLength: 1 },
          strength: { type: 'string', enum: ['strong', 'moderate', 'weak'] },
          basis: { type: 'string', minLength: 1 },
        },
      },
    },
    appeal_letter_draft: { type: 'string', minLength: 1 },
    scope_notes: { type: 'string', minLength: 1 },
  },
} as const

export const findingExplanationSchema = z
  .object({
    finding_id: z.string().min(1),
    plain_language_explanation: z.string().min(1),
  })
  .strict()

export const appealPointSchema = z
  .object({
    point: z.string().min(1),
    strength: z.enum(['strong', 'moderate', 'weak']),
    basis: z.string().min(1),
  })
  .strict()

export const aiDraftResponseSchema = z
  .object({
    schema_version: z.literal(AI_DRAFT_SCHEMA_VERSION),
    prompt_version: z.literal(AI_DRAFT_PROMPT_VERSION),
    findings_explained: z.array(findingExplanationSchema),
    hospital_questions: z.array(z.string().min(1)),
    insurer_questions: z.array(z.string().min(1)),
    appeal_points: z.array(appealPointSchema),
    appeal_letter_draft: z.string().min(1),
    scope_notes: z.string().min(1),
  })
  .strict()

export type AiDraftResponse = z.infer<typeof aiDraftResponseSchema>
export type AiDraftAppealPoint = z.infer<typeof appealPointSchema>

export type AiDraftProviderMetadata = {
  provider: 'openai' | 'deterministic'
  model: string
  input_tokens: number
  output_tokens: number
  schema_version: typeof AI_DRAFT_SCHEMA_VERSION
  prompt_version: typeof AI_DRAFT_PROMPT_VERSION
  fallback_reason: AiDraftFallbackReason | null
}

export type AiDraftFallbackReason =
  | 'api_failure'
  | 'invalid_json'
  | 'schema_failure'
  | 'semantic_validation_failure'
  | 'token_budget_exceeded'
  | 'fallback_model_unvalidated'

export type StoredAiDraft = AiDraftResponse & {
  is_fallback: boolean
  fallback_reason: AiDraftFallbackReason | null
  provider_metadata: AiDraftProviderMetadata
}

/**
 * Parses unknown JSON into the Module 6 strict response shape.
 *
 * SIDE EFFECTS: none
 * THROWS: ZodError when schema validation fails
 * IDEMPOTENT: yes, pure validation
 * TOKEN COST: none
 *
 * @param value - Unknown provider or fallback JSON value
 * @returns Validated Module 6 AI draft response
 */
export function parseAiDraftResponse(value: unknown): AiDraftResponse {
  return aiDraftResponseSchema.parse(value)
}
