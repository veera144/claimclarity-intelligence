/**
 * @file smoke-openai.ts
 * @module processor/cli
 *
 * Opt-in live OpenAI smoke test using synthetic non-case data.
 */

import {
  OPENAI_AI_DRAFT_DEFAULT_MODEL,
  AI_MAX_OUTPUT_TOKENS,
} from '@claimclarity/shared/constants'

import { OpenAiResponsesDraftClient } from '../aiDraft/openai-client'

import { loadLocalEnv } from './load-local-env'

loadLocalEnv()

function model(): string {
  return process.env.OPENAI_AI_DRAFT_MODEL ?? OPENAI_AI_DRAFT_DEFAULT_MODEL
}

async function main(): Promise<void> {
  if (process.env.OPENAI_LIVE_SMOKE !== '1') {
    console.log('PENDING OpenAI live smoke: set OPENAI_LIVE_SMOKE=1 to run')
    return
  }

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.log('PENDING OpenAI live smoke: OPENAI_API_KEY is not set')
    return
  }

  const client = new OpenAiResponsesDraftClient({ apiKey })
  await client.generateDraft({
    model: model(),
    inputTokens: 120,
    outputTokenLimit: Math.min(600, AI_MAX_OUTPUT_TOKENS),
    prompt: [
      'This is a synthetic ClaimClarity smoke test with no patient or case data.',
      'Return one concise valid JSON response for finding_id smoke-test-finding.',
      'Do not claim approval, payout certainty, legal advice, or medical advice.',
    ].join(' '),
  })

  console.log(`PASS OpenAI live smoke: model=${model()}`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`FAIL OpenAI live smoke: ${message}`)
  process.exitCode = 1
})
