/**
 * @file middleware.ts
 * @module dashboard/lib/supabase
 *
 * Request-scoped Supabase middleware client for the internal dashboard app.
 *
 * DEPENDENCIES:
 *   - @supabase/ssr
 *   - next/server
 *   - /packages/db/src/types.ts
 *
 * CALLED BY:
 *   - /apps/dashboard/middleware.ts
 *
 * CALLS:
 *   - Supabase auth.getUser()
 */

import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { Database, DbClient } from '@claimclarity/db'

type CookieToSet = {
  name: string
  value: string
  options: CookieOptions
}

export type MiddlewareClientResult = {
  response: NextResponse
  supabase: DbClient
  userId: string | null
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`)
  }

  return value
}

export async function createMiddlewareClient(request: NextRequest): Promise<MiddlewareClientResult> {
  const response = NextResponse.next({
    request
  })

  // eslint-disable-next-line @typescript-eslint/no-deprecated -- This call uses the required getAll/setAll cookie API; only the legacy overload is deprecated.
  const supabase = createServerClient<Database>(
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            response.cookies.set(name, value, options)
          })
        }
      }
    }
  )

  const {
    data: { user }
  } = await supabase.auth.getUser()

  return {
    response,
    supabase: supabase as unknown as DbClient,
    userId: user?.id ?? null
  }
}
