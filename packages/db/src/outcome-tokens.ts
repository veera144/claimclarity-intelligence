/**
 * @file outcome-tokens.ts
 * @module db/outcome-tokens
 *
 * Generates, inspects, and consumes one-time outcome update tokens.
 *
 * DEPENDENCIES:
 *   - node:crypto (opaque token generation and SHA-256 hashing)
 *   - /packages/db/src/client.server.ts
 *   - /packages/db/src/types.ts
 *
 * CALLED BY:
 *   - /apps/processor/src/outcomes/follow-up-reminders.ts
 *   - /apps/web/lib/outcomes/outcome-service.ts
 *   - /apps/web/app/app/outcomes/update/page.tsx
 *
 * CALLS:
 *   - Supabase outcome_tokens and audit_log tables
 */

import { createHash, randomBytes } from 'node:crypto'

import { OUTCOME_TOKEN_TTL_DAYS } from '@claimclarity/shared/constants'

import { createServiceClient } from './client.server.ts'
import type { DbClient, Json } from './types'

export type OutcomeTokenType = 'quick_update' | 'full_outcome'

export type InspectedOutcomeToken = {
  id: string
  caseId: string
  tokenType: OutcomeTokenType
}

function tokenHash(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex')
}

function tokenExpiry(now: Date): string {
  return new Date(
    now.getTime() + OUTCOME_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()
}

async function insertTokenAudit(input: {
  client: DbClient
  action: string
  caseId?: string
  tokenId?: string
  metadata?: Json
}): Promise<void> {
  const { error } = await input.client.from('audit_log').insert({
    actor_role: 'system',
    action: input.action,
    entity_type: input.caseId ? 'case' : 'outcome_token',
    entity_id: input.caseId ?? input.tokenId ?? null,
    metadata: input.metadata ?? null,
  })

  if (error) {
    console.error('[outcome-token] Failed to write audit entry', error.message)
  }
}

/**
 * Creates an opaque one-time token for outcome submission links.
 *
 * SIDE EFFECTS: inserts outcome_tokens and audit_log rows
 * THROWS: Error when token insertion fails
 * IDEMPOTENT: no, every call creates a new raw token and DB row
 *
 * @param caseId - Case id that the token authorizes
 * @param tokenType - Token authorization scope, not the submitted action
 * @param client - Service-role DB client
 * @param now - Optional clock injection for tests
 * @returns Raw token string shown only in the email/link
 */
export async function generateOutcomeToken(
  caseId: string,
  tokenType: OutcomeTokenType,
  client: DbClient = createServiceClient(),
  now: Date = new Date()
): Promise<string> {
  const rawToken = randomBytes(32).toString('hex')
  const expiresAt = tokenExpiry(now)
  const { data, error } = await client
    .from('outcome_tokens')
    .insert({
      case_id: caseId,
      token_hash: tokenHash(rawToken),
      token_type: tokenType,
      expires_at: expiresAt,
    })
    .select('id')
    .single()

  if (error) {
    throw new Error(`Unable to generate outcome token: ${error.message}`)
  }

  await insertTokenAudit({
    client,
    action: 'outcome_token_generated',
    caseId,
    tokenId: data.id,
    metadata: {
      token_type: tokenType,
      expires_at: expiresAt,
    },
  })

  return rawToken
}

/**
 * Reads token validity without consuming it for GET confirmation pages.
 *
 * SIDE EFFECTS: none
 * THROWS: never; malformed, expired, and used tokens return null
 * IDEMPOTENT: yes
 *
 * @param rawToken - Token from a URL or request body
 * @param client - Service-role DB client
 * @param now - Optional clock injection for tests
 * @returns Token metadata when valid, otherwise null
 */
export async function inspectOutcomeToken(
  rawToken: string,
  client: DbClient = createServiceClient(),
  now: Date = new Date()
): Promise<InspectedOutcomeToken | null> {
  if (!rawToken) {
    return null
  }

  const { data, error } = await client
    .from('outcome_tokens')
    .select('id, case_id, token_type, expires_at, used_at')
    .eq('token_hash', tokenHash(rawToken))
    .maybeSingle()

  if (error || !data || data.used_at || new Date(data.expires_at).getTime() <= now.getTime()) {
    return null
  }

  return {
    id: data.id,
    caseId: data.case_id,
    tokenType: data.token_type,
  }
}

/**
 * Marks a valid token used during a successful POST mutation.
 *
 * SIDE EFFECTS: updates outcome_tokens.used_at
 * THROWS: never; failed or invalid consumption returns null
 * IDEMPOTENT: no, the same token can be consumed only once
 *
 * @param rawToken - Token from request body
 * @param client - Service-role DB client
 * @param expectedType - Optional required token scope
 * @param now - Optional clock injection for tests
 * @returns Token metadata when consumed, otherwise null
 */
export async function consumeOutcomeToken(
  rawToken: string,
  client: DbClient = createServiceClient(),
  expectedType?: OutcomeTokenType,
  now: Date = new Date()
): Promise<InspectedOutcomeToken | null> {
  if (!rawToken) {
    return null
  }

  let query = client
    .from('outcome_tokens')
    .update({ used_at: now.toISOString() })
    .eq('token_hash', tokenHash(rawToken))
    .is('used_at', null)
    .gt('expires_at', now.toISOString())

  if (expectedType) {
    query = query.eq('token_type', expectedType)
  }

  const { data, error } = await query.select('id, case_id, token_type').maybeSingle()

  if (error || !data) {
    await insertTokenAudit({
      client,
      action: 'outcome_token_rejected',
      metadata: {
        token_type: expectedType ?? null,
        reason: error ? 'db_error' : 'invalid_expired_or_used',
      },
    }).catch(() => undefined)
    return null
  }

  return {
    id: data.id,
    caseId: data.case_id,
    tokenType: data.token_type,
  }
}
