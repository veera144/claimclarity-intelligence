/**
 * @file provider-config.ts
 * @module processor/ai-draft
 *
 * OpenAI Module 6 provider configuration.
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
  OPENAI_AI_DRAFT_DEFAULT_FALLBACK_MODEL,
  OPENAI_AI_DRAFT_DEFAULT_MODEL,
} from '@claimclarity/shared/constants'

export type AiDraftProviderConfig = {
  apiKey: string
  primaryModel: string
  fallbackModel: string
  fallbackModelValidated: boolean
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]
  if (!value) throw new Error(`Required environment variable ${key} is not set`)
  return value
}

function modelEnvOrDevDefault(
  env: NodeJS.ProcessEnv,
  key: string,
  defaultValue: string
): string {
  const value = env[key]
  if (value) return value
  if (env.NODE_ENV === 'production') {
    throw new Error(`Required environment variable ${key} is not set`)
  }
  return defaultValue
}

/**
 * Resolves OpenAI Module 6 configuration with fail-fast API key behavior.
 *
 * SIDE EFFECTS: none
 * THROWS: Error when OPENAI_API_KEY is missing or production model vars are unset
 * IDEMPOTENT: yes, reads process state only
 * TOKEN COST: none
 *
 * @param env - Environment source, defaults to process.env
 * @returns OpenAI provider configuration
 */
export function resolveAiDraftProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): AiDraftProviderConfig {
  return {
    apiKey: requiredEnv(env, 'OPENAI_API_KEY'),
    primaryModel: modelEnvOrDevDefault(
      env,
      'OPENAI_AI_DRAFT_MODEL',
      OPENAI_AI_DRAFT_DEFAULT_MODEL
    ),
    fallbackModel: modelEnvOrDevDefault(
      env,
      'OPENAI_AI_DRAFT_FALLBACK_MODEL',
      OPENAI_AI_DRAFT_DEFAULT_FALLBACK_MODEL
    ),
    fallbackModelValidated: env.OPENAI_AI_DRAFT_FALLBACK_MODEL_VALIDATED === 'true',
  }
}
