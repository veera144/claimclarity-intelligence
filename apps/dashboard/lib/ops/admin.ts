/**
 * @file admin.ts
 * @module dashboard/ops
 *
 * Admin-only authorization helpers for Module 10 operations pages.
 */

import { redirect } from 'next/navigation'

import { requireDashboardActor } from '../review/session'
import type { ReviewActor } from '../review/workflow'

export function isAdminActor(actor: ReviewActor | null): actor is ReviewActor & { role: 'admin' } {
  return actor?.role === 'admin'
}

export async function requireAdminActor(): Promise<ReviewActor> {
  const actor = await requireDashboardActor()
  if (!isAdminActor(actor)) redirect('/access-denied')
  return actor
}
