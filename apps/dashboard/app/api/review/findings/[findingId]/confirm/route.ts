import { NextResponse, type NextRequest } from 'next/server'

import { jsonError, requireApiActor } from '../../../../../../lib/review/api'
import { createSupabaseReviewStore } from '../../../../../../lib/review/supabase-store'
import { confirmFinding } from '../../../../../../lib/review/workflow'

type RouteContext = {
  params: {
    findingId: string
  }
}

export async function POST(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const actorResult = await requireApiActor()
  if (!actorResult.ok) return actorResult.response

  try {
    await confirmFinding(actorResult.actor, createSupabaseReviewStore(), context.params.findingId)
    return NextResponse.json({ status: 'confirmed' })
  } catch (error) {
    return jsonError(error)
  }
}
