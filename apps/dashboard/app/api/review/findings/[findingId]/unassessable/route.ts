import { NextResponse, type NextRequest } from 'next/server'

import { jsonError, requireApiActor } from '../../../../../../lib/review/api'
import { createSupabaseReviewStore } from '../../../../../../lib/review/supabase-store'
import { markFindingUnassessable } from '../../../../../../lib/review/workflow'

type RouteContext = {
  params: {
    findingId: string
  }
}

type UnassessableBody = {
  reason?: unknown
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const actorResult = await requireApiActor()
  if (!actorResult.ok) return actorResult.response

  try {
    const body = (await request.json()) as UnassessableBody
    await markFindingUnassessable(
      actorResult.actor,
      createSupabaseReviewStore(),
      context.params.findingId,
      typeof body.reason === 'string' ? body.reason : ''
    )
    return NextResponse.json({ status: 'unassessable' })
  } catch (error) {
    return jsonError(error)
  }
}
