/**
 * @file client.browser.ts
 * @module db/client-browser
 *
 * Browser Supabase client factory for Next.js client components.
 *
 * DEPENDENCIES:
 *   - @supabase/ssr (browser client factory)
 *   - /packages/db/src/types.ts
 *
 * CALLED BY:
 *   - future client-side auth and realtime hooks
 *
 * CALLS:
 *   - none
 */

import { createBrowserClient as createSupabaseBrowserClient } from '@supabase/ssr'

import type { DbClient, Database } from './types'

function getRequiredEnv(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`)
  }

  return value
}

/**
 * Creates a browser-safe Supabase client using the public anon credentials.
 *
 * SIDE EFFECTS: none
 * THROWS: Error when the required public Supabase environment variables are missing
 * IDEMPOTENT: yes, creates a fresh client each time
 *
 * @returns A browser Supabase client for the ClaimClarity schema
 */
export function createBrowserClient(): DbClient {
  return createSupabaseBrowserClient<Database>(
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    getRequiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  ) as unknown as DbClient
}
