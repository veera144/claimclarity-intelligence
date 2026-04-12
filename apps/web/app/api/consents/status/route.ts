/**
 * @file route.ts
 * @module web/api/consents/status
 *
 * Reports whether the authenticated patient has completed current consent requirements.
 *
 * DEPENDENCIES:
 *   - next/server
 *   - /apps/web/lib/consent.ts
 *   - /apps/web/lib/errors.ts
 *   - /packages/db/src/client.server.ts
 *
 * CALLED BY:
 *   - patient consent gate clients
 *
 * CALLS:
 *   - Supabase auth and consents table
 */

import { NextResponse } from 'next/server'
import { createServerClient } from '@claimclarity/db'

import { getMissingConsentTypes } from '../../../../lib/consent'
import { AuthorizationError, toApiResponse } from '../../../../lib/errors'

export async function GET(): Promise<Response> {
  try {
    const client = await createServerClient()
    const {
      data: { user },
    } = await client.auth.getUser()

    if (!user) {
      throw new AuthorizationError('Authentication required')
    }

    const missing = await getMissingConsentTypes({
      client,
      userId: user.id,
    })

    return NextResponse.json({
      complete: missing.length === 0,
      missing,
    })
  } catch (error) {
    return toApiResponse(error)
  }
}
