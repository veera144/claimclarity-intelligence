import { NextResponse, type NextRequest } from 'next/server'

import { jsonError, requireApiActor } from '../../../../../../lib/review/api'
import { createSupabaseReviewStore } from '../../../../../../lib/review/supabase-store'
import { editFindingExplanation } from '../../../../../../lib/review/workflow'

type RouteContext = {
  params: {
    findingId: string
  }
}

type ExplanationBody = {
  explanation?: unknown
}

export async function PATCH(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const actorResult = await requireApiActor()
  if (!actorResult.ok) return actorResult.response

  try {
    const body = (await request.json()) as ExplanationBody
    await editFindingExplanation(
      actorResult.actor,
      createSupabaseReviewStore(),
      context.params.findingId,
      typeof body.explanation === 'string' ? body.explanation : ''
    )
    return NextResponse.json({ status: 'edited' })
  } catch (error) {
    return jsonError(error)
  }
}
