import { NextResponse, type NextRequest } from 'next/server'

import { jsonError, requireApiActor } from '../../../../../../lib/review/api'
import { createSupabaseReviewStore } from '../../../../../../lib/review/supabase-store'
import { respondToEscalation } from '../../../../../../lib/review/workflow'

type RouteContext = {
  params: {
    escalationId: string
  }
}

type ResponseBody = {
  expert_response?: unknown
  confidence_recommendation?: unknown
}

function confidence(value: unknown): 'clause_found_matched' | 'based_on_typical_policy' | 'insufficient_information' {
  if (value === 'based_on_typical_policy' || value === 'insufficient_information') return value
  return 'clause_found_matched'
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const actorResult = await requireApiActor()
  if (!actorResult.ok) return actorResult.response

  try {
    const body = (await request.json()) as ResponseBody
    await respondToEscalation(actorResult.actor, createSupabaseReviewStore(), {
      escalationId: context.params.escalationId,
      responseText: typeof body.expert_response === 'string' ? body.expert_response : '',
      confidenceRecommendation: confidence(body.confidence_recommendation),
    })
    return NextResponse.json({ status: 'responded' })
  } catch (error) {
    return jsonError(error)
  }
}
