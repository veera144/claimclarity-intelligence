'use server'

import { revalidatePath } from 'next/cache'
import type { Json } from '@claimclarity/db'

import { requireDashboardActor } from '../../../lib/review/session'
import { createSupabaseReviewStore } from '../../../lib/review/supabase-store'
import {
  confirmFinding,
  createEscalation,
  editFindingExplanation,
  markFindingUnassessable,
  requestMissingDocument,
  signOffCase,
  updateDraftSection,
  type ReviewDraftSection,
} from '../../../lib/review/workflow'

function formText(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

function revalidateCase(caseId: string): void {
  revalidatePath(`/cases/${caseId}`)
  revalidatePath('/queue')
}

function parseJson(value: string): Json {
  try {
    return JSON.parse(value) as Json
  } catch {
    throw new Error('Draft section JSON is invalid')
  }
}

function draftSectionValue(section: ReviewDraftSection, rawValue: string): Json {
  if (section === 'hospital_questions' || section === 'insurer_questions') {
    return rawValue
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean) as Json
  }
  if (section === 'appeal_points') return parseJson(rawValue)
  if (section === 'reviewer_letter_confirmed') return true
  return rawValue
}

export async function confirmFindingAction(formData: FormData): Promise<void> {
  const actor = await requireDashboardActor()
  const store = createSupabaseReviewStore()
  const findingId = formText(formData, 'finding_id')
  const caseId = formText(formData, 'case_id')
  await confirmFinding(actor, store, findingId)
  revalidateCase(caseId)
}

export async function editFindingAction(formData: FormData): Promise<void> {
  const actor = await requireDashboardActor()
  const store = createSupabaseReviewStore()
  const findingId = formText(formData, 'finding_id')
  const caseId = formText(formData, 'case_id')
  await editFindingExplanation(actor, store, findingId, formText(formData, 'explanation'))
  revalidateCase(caseId)
}

export async function unassessableFindingAction(formData: FormData): Promise<void> {
  const actor = await requireDashboardActor()
  const store = createSupabaseReviewStore()
  const findingId = formText(formData, 'finding_id')
  const caseId = formText(formData, 'case_id')
  await markFindingUnassessable(actor, store, findingId, formText(formData, 'reason'))
  revalidateCase(caseId)
}

export async function missingDocumentAction(formData: FormData): Promise<void> {
  const actor = await requireDashboardActor()
  const store = createSupabaseReviewStore()
  const caseId = formText(formData, 'case_id')
  await requestMissingDocument(actor, store, caseId, formText(formData, 'request_text'))
  revalidateCase(caseId)
}

export async function escalateAction(formData: FormData): Promise<void> {
  const actor = await requireDashboardActor()
  const store = createSupabaseReviewStore()
  const caseId = formText(formData, 'case_id')
  const findingId = formText(formData, 'finding_id')
  const input = {
    caseId,
    questionText: formText(formData, 'question_text'),
    priority: formText(formData, 'priority') === 'high' ? 'high' : 'normal',
  } satisfies Parameters<typeof createEscalation>[2]
  const expertId = formText(formData, 'expert_id')
  await createEscalation(actor, store, {
    ...input,
    ...(findingId ? { findingId } : {}),
    ...(expertId ? { expertId } : {}),
  })
  revalidateCase(caseId)
}

export async function draftSectionAction(formData: FormData): Promise<void> {
  const actor = await requireDashboardActor()
  const store = createSupabaseReviewStore()
  const caseId = formText(formData, 'case_id')
  const section = formText(formData, 'section') as ReviewDraftSection
  await updateDraftSection(
    actor,
    store,
    caseId,
    section,
    draftSectionValue(section, formText(formData, 'value'))
  )
  revalidateCase(caseId)
}

export async function signOffAction(formData: FormData): Promise<void> {
  const actor = await requireDashboardActor()
  const store = createSupabaseReviewStore()
  const caseId = formText(formData, 'case_id')
  await signOffCase(actor, store, caseId)
  revalidateCase(caseId)
}
