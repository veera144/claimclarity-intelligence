/**
 * @file route.ts
 * @module web/api/auth/callback
 *
 * Supabase auth callback route for email confirmation and password reset flows.
 *
 * DEPENDENCIES:
 *   - next/server
 *   - /packages/db/src/client.server.ts
 *
 * CALLED BY:
 *   - Supabase auth redirect URLs
 *
 * CALLS:
 *   - Supabase auth.exchangeCodeForSession()
 */

import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@claimclarity/db'

import { rateLimitRequest } from '../../../../lib/rateLimit'

export async function GET(request: NextRequest): Promise<Response> {
  const limited = await rateLimitRequest(request, 'auth')
  if (limited) {
    return limited
  }

  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')
  const next = requestUrl.searchParams.get('next') ?? '/app/dashboard'

  if (code) {
    const supabase = await createServerClient()
    await supabase.auth.exchangeCodeForSession(code)
  }

  return NextResponse.redirect(new URL(next, request.url))
}
