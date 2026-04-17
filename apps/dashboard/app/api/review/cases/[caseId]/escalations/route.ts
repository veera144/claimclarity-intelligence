import { NextResponse, type NextRequest } from 'next/server'

import { jsonError, requireApiActor } from '../../../../../../lib/review/api'
import { createSupabaseReviewStore } from '../../../../../../lib/review/supabase-store'
import { createEscalation } from '../../../../../../lib/review/workflow'

type RouteContext = {
  params: {
    caseId: string
  }
}

type EscalationBody = {
  finding_id?: unknown
  expert_id?: unknown
  question_text?: unknown
  priority?: unknown
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const actorResult = await requireApiActor()
  if (!actorResult.ok) return actorResult.response

  try {
    const body = (await request.json()) as EscalationBody
    const input = {
      caseId: context.params.caseId,
      questionText: typeof body.question_text === 'string' ? body.question_text : '',
      priority: body.priority === 'high' ? 'high' : 'normal',
    } satisfies Parameters<typeof createEscalation>[2]
    const escalationId = await createEscalation(actorResult.actor, createSupabaseReviewStore(), {
      ...input,
      ...(typeof body.finding_id === 'string' ? { findingId: body.finding_id } : {}),
      ...(typeof body.expert_id === 'string' ? { expertId: body.expert_id } : {}),
    })
    return NextResponse.json({ status: 'open', escalation_id: escalationId })
  } catch (error) {
    return jsonError(error)
  }
}
