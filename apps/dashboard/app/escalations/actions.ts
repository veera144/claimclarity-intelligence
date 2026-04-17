'use server'

import { revalidatePath } from 'next/cache'

import { requireDashboardActor } from '../../lib/review/session'
import { createSupabaseReviewStore } from '../../lib/review/supabase-store'
import { respondToEscalation } from '../../lib/review/workflow'

function formText(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

export async function respondEscalationAction(formData: FormData): Promise<void> {
  const actor = await requireDashboardActor()
  const store = createSupabaseReviewStore()
  const confidence = formText(formData, 'confidence_recommendation')
  await respondToEscalation(actor, store, {
    escalationId: formText(formData, 'escalation_id'),
    responseText: formText(formData, 'expert_response'),
    confidenceRecommendation:
      confidence === 'insufficient_information' || confidence === 'based_on_typical_policy'
        ? confidence
        : 'clause_found_matched',
  })
  revalidatePath('/escalations')
  revalidatePath('/queue')
}
