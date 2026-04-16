/**
 * @file openai-client.ts
 * @module processor/ai-draft
 *
 * Provider-neutral interface with an OpenAI Responses API implementation for Module 6.
 *
 * DEPENDENCIES:
 *   - @claimclarity/shared/constants
 *   - /apps/processor/src/aiDraft/schema.ts
 *   - /apps/processor/src/aiDraft/system-prompt.ts
 *
 * CALLED BY:
 *   - /apps/processor/src/jobs/aiDraftJob.ts
 *   - /apps/processor/tests/module6.test.ts
 *
 * CALLS:
 *   - OpenAI Responses API
 */

import { AI_MAX_OUTPUT_TOKENS } from '@claimclarity/shared/constants'

import {
  AI_DRAFT_RESPONSE_SCHEMA_NAME,
  aiDraftJsonSchema,
  parseAiDraftResponse,
  type AiDraftResponse,
} from './schema'
import { SYSTEM_PROMPT } from './system-prompt'

export type AiDraftProviderRequest = {
  model: string
  prompt: string
  inputTokens: number
  outputTokenLimit: number
}

export type AiDraftProviderResult = {
  draft: AiDraftResponse
  model: string
  inputTokens: number
  outputTokens: number
}

export type AiDraftProviderClient = {
  generateDraft(request: AiDraftProviderRequest): Promise<AiDraftProviderResult>
}

type FetchLike = typeof fetch

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function textFromContent(content: unknown): string | null {
  if (!Array.isArray(content)) return null
  const textParts: string[] = []

  for (const item of content) {
    if (!isRecord(item)) continue
    const itemText = item.text
    if (
      (item.type === 'output_text' || item.type === 'text') &&
      typeof itemText === 'string'
    ) {
      textParts.push(itemText)
    }
  }

  return textParts.length > 0 ? textParts.join('') : null
}

function extractOutputText(responseBody: unknown): string {
  if (!isRecord(responseBody)) throw new Error('invalid_json: provider body was not an object')
  if (responseBody.status === 'incomplete') {
    throw new Error('invalid_json: provider output was incomplete')
  }
  if (typeof responseBody.output_text === 'string') return responseBody.output_text

  const output = responseBody.output
  if (Array.isArray(output)) {
    const parts = output
      .map((item) => (isRecord(item) ? textFromContent(item.content) : null))
      .filter((part): part is string => part !== null)
    if (parts.length > 0) return parts.join('')
  }

  throw new Error('invalid_json: missing structured output text')
}

function extractUsage(responseBody: unknown): { inputTokens: number | null; outputTokens: number | null } {
  if (!isRecord(responseBody) || !isRecord(responseBody.usage)) {
    return { inputTokens: null, outputTokens: null }
  }

  return {
    inputTokens:
      readNumber(responseBody.usage.input_tokens) ??
      readNumber(responseBody.usage.prompt_tokens),
    outputTokens:
      readNumber(responseBody.usage.output_tokens) ??
      readNumber(responseBody.usage.completion_tokens),
  }
}

/**
 * OpenAI Responses API client for strict Module 6 structured outputs.
 */
export class OpenAiResponsesDraftClient implements AiDraftProviderClient {
  private readonly apiKey: string

  private readonly fetchImpl: FetchLike

  public readonly lastRequests: unknown[] = []

  public constructor(input: { apiKey: string; fetchImpl?: FetchLike }) {
    this.apiKey = input.apiKey
    this.fetchImpl = input.fetchImpl ?? fetch
  }

  /**
   * Requests a strict structured draft from OpenAI Responses API.
   *
   * SIDE EFFECTS: performs a network request to OpenAI
   * THROWS: Error when the API fails, output is incomplete, or JSON schema parsing fails
   * IDEMPOTENT: no, external provider call
   * TOKEN COST: max 3,500 input and 2,000 output by Module 6 contract
   *
   * @param request - Provider-neutral draft request
   * @returns Strict-schema parsed draft and usage metadata
   */
  public async generateDraft(
    request: AiDraftProviderRequest
  ): Promise<AiDraftProviderResult> {
    const body = {
      model: request.model,
      input: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: request.prompt },
      ],
      temperature: 0,
      max_output_tokens: Math.min(request.outputTokenLimit, AI_MAX_OUTPUT_TOKENS),
      text: {
        format: {
          type: 'json_schema',
          name: AI_DRAFT_RESPONSE_SCHEMA_NAME,
          strict: true,
          schema: aiDraftJsonSchema,
        },
      },
    }
    this.lastRequests.push(body)

    const response = await this.fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    const responseText = await response.text()
    let responseBody: unknown
    try {
      responseBody = responseText ? JSON.parse(responseText) : {}
    } catch {
      throw new Error('invalid_json: provider response was not JSON')
    }

    if (!response.ok) {
      const detail = isRecord(responseBody) && typeof responseBody.error === 'object'
        ? JSON.stringify(responseBody.error)
        : responseText
      throw new Error(`api_failure: OpenAI Responses API returned ${String(response.status)} ${detail}`)
    }

    const outputText = extractOutputText(responseBody)
    let parsed: unknown
    try {
      parsed = JSON.parse(outputText)
    } catch {
      throw new Error('invalid_json: structured output text was not JSON')
    }

    const usage = extractUsage(responseBody)
    return {
      draft: parseAiDraftResponse(parsed),
      model: request.model,
      inputTokens: usage.inputTokens ?? request.inputTokens,
      outputTokens: usage.outputTokens ?? Math.ceil(outputText.length / 4),
    }
  }
}
