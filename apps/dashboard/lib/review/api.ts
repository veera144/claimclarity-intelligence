/**
 * @file api.ts
 * @module dashboard/review
 *
 * Small helpers for protected Module 7 route handlers.
 */

import { NextResponse } from 'next/server'

import { readDashboardActor } from './session'
import { ReviewWorkflowError, type ReviewActor } from './workflow'

export type ApiActorResult =
  | { ok: true; actor: ReviewActor }
  | { ok: false; response: NextResponse }

export async function requireApiActor(): Promise<ApiActorResult> {
  const actor = await readDashboardActor()
  if (!actor) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Internal dashboard access required' }, { status: 403 }),
    }
  }
  return { ok: true, actor }
}

export function jsonError(error: unknown): NextResponse {
  if (error instanceof ReviewWorkflowError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  const message = error instanceof Error ? error.message : 'Unexpected review workflow failure'
  return NextResponse.json({ error: message }, { status: 500 })
}
