import { createBrowserClient as createSupabaseBrowserClient } from '@supabase/ssr'

import type { DbClient, Database } from './types'

/**
 * Creates a browser-safe Supabase client using the public anon credentials.
 */
export function createBrowserClient(): DbClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

  if (!supabaseUrl) {
    throw new Error('Required environment variable NEXT_PUBLIC_SUPABASE_URL is not set')
  }

  if (!supabaseAnonKey) {
    throw new Error(
      'Required environment variable NEXT_PUBLIC_SUPABASE_ANON_KEY is not set'
    )
  }

  return createSupabaseBrowserClient<Database>(
    supabaseUrl,
    supabaseAnonKey
  ) as unknown as DbClient
}