import { NextResponse, type NextRequest } from 'next/server'

import { jsonError, requireApiActor } from '../../../../../../lib/review/api'
import { createSupabaseReviewStore } from '../../../../../../lib/review/supabase-store'
import { signOffCase } from '../../../../../../lib/review/workflow'

type RouteContext = {
  params: {
    caseId: string
  }
}

export async function POST(_request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const actorResult = await requireApiActor()
  if (!actorResult.ok) return actorResult.response

  try {
    await signOffCase(actorResult.actor, createSupabaseReviewStore(), context.params.caseId)
    return NextResponse.json({ status: 'approved' })
  } catch (error) {
    return jsonError(error)
  }
}
