import { NextResponse, type NextRequest } from 'next/server'

import { jsonError, requireApiActor } from '../../../../../../lib/review/api'
import { createSupabaseReviewStore } from '../../../../../../lib/review/supabase-store'
import { startCaseReview } from '../../../../../../lib/review/workflow'

type RouteContext = {
  params: {
    caseId: string
  }
}

export async function POST(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const actorResult = await requireApiActor()
  if (!actorResult.ok) return actorResult.response

  try {
    const status = await startCaseReview(
      actorResult.actor,
      createSupabaseReviewStore(),
      context.params.caseId
    )
    return NextResponse.json({ status })
  } catch (error) {
    return jsonError(error)
  }
}
