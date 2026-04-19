'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient, logAudit } from '@claimclarity/db'

import { requireAdminActor } from '../../../../../lib/ops/admin'

function formText(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

async function assertUserRole(input: {
  userId: string
  role: 'reviewer' | 'expert'
  label: string
}): Promise<void> {
  if (!input.userId) return
  const serviceClient = createServiceClient()
  const { data, error } = await serviceClient
    .from('users')
    .select('id, role')
    .eq('id', input.userId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data || data.role !== input.role) {
    throw new Error(`${input.label} must be a user with role ${input.role}`)
  }
}

export async function updateAssignmentAction(formData: FormData): Promise<void> {
  const actor = await requireAdminActor()
  const caseId = formText(formData, 'case_id')
  const reviewerId = formText(formData, 'reviewer_id')
  const expertId = formText(formData, 'expert_id')

  if (!caseId) {
    throw new Error('Case id is required')
  }

  await Promise.all([
    assertUserRole({ userId: reviewerId, role: 'reviewer', label: 'Reviewer' }),
    assertUserRole({ userId: expertId, role: 'expert', label: 'Expert' }),
  ])

  const serviceClient = createServiceClient()
  const { data: before, error: readError } = await serviceClient
    .from('cases')
    .select('id, assigned_reviewer_id, assigned_expert_id')
    .eq('id', caseId)
    .maybeSingle()

  if (readError) throw new Error(readError.message)
  if (!before) throw new Error('Case not found')

  const { error: updateError } = await serviceClient
    .from('cases')
    .update({
      assigned_reviewer_id: reviewerId || null,
      assigned_expert_id: expertId || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', caseId)

  if (updateError) throw new Error(updateError.message)

  await logAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'case_assignment_updated',
    entityType: 'case',
    entityId: caseId,
    metadata: {
      old_reviewer_id: before.assigned_reviewer_id,
      new_reviewer_id: reviewerId || null,
      old_expert_id: before.assigned_expert_id,
      new_expert_id: expertId || null,
    },
  })

  revalidatePath(`/admin/cases/${caseId}/assignment`)
  revalidatePath(`/cases/${caseId}`)
}
