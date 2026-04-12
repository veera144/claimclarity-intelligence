/**
 * @file client.server.ts
 * @module db/client-server
 *
 * Server-side Supabase client factories for Next.js request contexts and service-role work.
 *
 * DEPENDENCIES:
 *   - @supabase/ssr (SSR client factory)
 *   - @supabase/supabase-js (service client factory)
 *   - /packages/db/src/types.ts
 *
 * CALLED BY:
 *   - /packages/db/src/audit.ts
 *   - /apps/processor/src/index.ts
 *
 * CALLS:
 *   - next/headers (lazy import for Next.js request cookies)
 */

import { createServerClient as createSupabaseServerClient, type CookieOptions } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

import type { DbClient, Database } from './types'

type CookieToSet = {
  name: string
  value: string
  options: CookieOptions
}

function getRequiredEnv(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`)
  }

  return value
}

/**
 * Creates a request-scoped Supabase client for Next.js server contexts.
 *
 * A lazy import keeps this module usable from the processor, which only needs
 * the service-role client and must not resolve Next.js runtime modules.
 *
 * SIDE EFFECTS: may refresh auth cookies in writable server contexts
 * THROWS: Error when required environment variables are missing
 * IDEMPOTENT: yes, creates a fresh client each time
 *
 * @returns A request-scoped Supabase client for authenticated server work
 */
export async function createServerClient(): Promise<DbClient> {
  const { cookies } = await import('next/headers')
  const cookieStore = await cookies()

  // eslint-disable-next-line @typescript-eslint/no-deprecated -- This call uses the required getAll/setAll cookie API; only the legacy overload is deprecated.
  return createSupabaseServerClient<Database>(
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: CookieToSet[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options)
            })
          } catch {
            // Server components can read cookies but may not be allowed to write them.
          }
        }
      }
    }
  ) as unknown as DbClient
}

/**
 * Creates a service-role Supabase client that bypasses row-level security.
 *
 * SIDE EFFECTS: none
 * THROWS: Error when service-role environment variables are missing
 * IDEMPOTENT: yes, creates a fresh client each time
 *
 * @returns A service-role Supabase client for trusted backend operations
 */
export function createServiceClient(): DbClient {
  return createClient<Database>(
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )
}
