/**
 * @file audit.ts
 * @module db/audit
 *
 * Writes immutable audit entries through the service-role database client.
 *
 * DEPENDENCIES:
 *   - /packages/db/src/client.server.ts
 *   - /packages/db/src/types.ts
 *
 * CALLED BY:
 *   - processor jobs
 *   - future API routes
 *
 * CALLS:
 *   - /packages/db/src/client.server.ts
 */

import { createServiceClient } from './client.server.ts'
import type { Json } from './types'

export type LogAuditInput = {
  actorId?: string
  actorRole?: string
  action: string
  entityType?: string
  entityId?: string
  metadata?: Json
  ipAddress?: string
}

function maskIpAddress(ipAddress?: string): string | null {
  if (!ipAddress) {
    return null
  }

  if (ipAddress.includes(':')) {
    const [first, second] = ipAddress.split(':')
    return first && second ? `${first}:${second}:` : null
  }

  const [first, second] = ipAddress.split('.')
  return first && second ? `${first}.${second}.` : null
}

/**
 * Persists an immutable audit row and degrades to console logging on failure.
 *
 * SIDE EFFECTS: writes to audit_log through the service-role client
 * THROWS: never, all failures are caught and logged to stderr
 * IDEMPOTENT: no, every successful call inserts a new audit row
 *
 * @param input - Audit payload describing the action and actor context
 * @returns Nothing
 */
export async function logAudit(input: LogAuditInput): Promise<void> {
  try {
    const client = createServiceClient()
    const { error } = await client.from('audit_log').insert({
      actor_id: input.actorId ?? null,
      actor_role: input.actorRole ?? null,
      action: input.action,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      metadata: input.metadata ?? null,
      ip_address: maskIpAddress(input.ipAddress)
    })

    if (error) {
      console.error('[audit] Failed to write audit entry', error.message)
    }
  } catch (error) {
    console.error('[audit] Unexpected audit failure', error)
  }
}

