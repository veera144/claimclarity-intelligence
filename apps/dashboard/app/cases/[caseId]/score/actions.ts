'use server'

import { revalidatePath } from 'next/cache'
import { createServerClient } from '@claimclarity/db'

import { requireDashboardActor } from '../../../../lib/review/session'

function formText(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

function formNumber(formData: FormData, name: string): number | null {
  const text = formText(formData, name)
  if (!text) return null
  const value = Number(text)
  if (!Number.isFinite(value)) throw new Error(`${name} must be numeric`)
  return value
}

export async function submitQualityScoreAction(formData: FormData): Promise<void> {
  const actor = await requireDashboardActor()
  if (actor.role === 'reviewer') throw new Error('Expert or admin access required')

  const caseId = formText(formData, 'case_id')
  const supabase = await createServerClient()
  const { data: caseRow, error: caseError } = await supabase
    .from('cases')
    .select('status')
    .eq('id', caseId)
    .single()
  if (caseError) throw new Error(caseError.message)
  if (caseRow.status !== 'delivered') throw new Error('Quality scores are only for delivered cases')

  const { data: report, error: reportError } = await supabase
    .from('reports')
    .select('id')
    .eq('case_id', caseId)
    .maybeSingle()
  if (reportError) throw new Error(reportError.message)

  const { error } = await supabase.from('quality_scores').insert({
    case_id: caseId,
    report_id: report?.id ?? null,
    scored_by: actor.id,
    scoring_type:
      formText(formData, 'scoring_type') === 'calibration_check'
        ? 'calibration_check'
        : 'post_delivery_expert_review',
    clause_extraction_accuracy: formNumber(formData, 'clause_extraction_accuracy'),
    deduction_reason_accuracy: formNumber(formData, 'deduction_reason_accuracy'),
    missing_doc_identification: formNumber(formData, 'missing_doc_identification'),
    next_step_question_usefulness: formNumber(formData, 'next_step_question_usefulness'),
    appeal_point_validity: formNumber(formData, 'appeal_point_validity'),
    harmful_output: formText(formData, 'harmful_output') === 'true',
    harmful_output_description: formText(formData, 'harmful_output_description') || null,
    notes: formText(formData, 'notes') || null,
  })
  if (error) throw new Error(error.message)
  revalidatePath(`/cases/${caseId}/score`)
}
