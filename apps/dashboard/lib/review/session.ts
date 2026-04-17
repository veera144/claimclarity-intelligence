/**
 * @file session.ts
 * @module dashboard/review
 *
 * Internal dashboard session helpers for Module 7.
 */

import { redirect } from 'next/navigation'
import { createServerClient } from '@claimclarity/db'

import type { ReviewActor, ReviewRole } from './workflow'

function isReviewRole(role: string | null | undefined): role is ReviewRole {
  return role === 'reviewer' || role === 'expert' || role === 'admin'
}

/**
 * Reads the authenticated internal dashboard actor.
 *
 * SIDE EFFECTS: reads Supabase auth session and users table
 * THROWS: Error when Supabase rejects the user lookup
 * IDEMPOTENT: yes, read-only
 *
 * @returns Internal review actor or null when unauthenticated/not internal
 */
export async function readDashboardActor(): Promise<ReviewActor | null> {
  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase.from('users').select('role').eq('id', user.id).single()
  if (error) throw new Error(error.message)
  return isReviewRole(data.role) ? { id: user.id, role: data.role } : null
}

/**
 * Requires an authenticated internal dashboard actor, redirecting browser pages otherwise.
 *
 * SIDE EFFECTS: may redirect the current Next.js request
 * THROWS: never intentionally; redirect short-circuits when access is denied
 * IDEMPOTENT: yes
 *
 * @returns Internal review actor
 */
export async function requireDashboardActor(): Promise<ReviewActor> {
  const actor = await readDashboardActor()
  if (!actor) redirect('/access-denied')
  return actor
}
