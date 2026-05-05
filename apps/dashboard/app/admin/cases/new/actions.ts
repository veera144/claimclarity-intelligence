'use server'

import { redirect } from 'next/navigation'
import {
  createServiceClient,
  generateCaseRef,
  getNextCaseRefSeq,
  logAudit,
} from '@claimclarity/db'

import { requireAdminActor } from '../../../../lib/ops/admin'
import { sendOpsEmail } from '../../../../lib/ops/email'

function text(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value.trim() : ''
}

function numberOrNull(value: string): number | null {
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error('Claim amount must be whole rupees')
  return parsed
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://claimclarity.in').replace(/\/$/, '')
}

async function findOrInvitePatient(email: string): Promise<string> {
  const serviceClient = createServiceClient()
  const users = await serviceClient.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (users.error) throw new Error(users.error.message)
  const existing = users.data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase())
  if (existing) {
    await serviceClient.from('users').update({ email }).eq('id', existing.id)
    return existing.id
  }

  const invited = await serviceClient.auth.admin.inviteUserByEmail(email)
  if (invited.error) throw new Error(invited.error.message)
  return invited.data.user.id
}

export async function createAdminPilotCaseAction(formData: FormData): Promise<void> {
  const actor = await requireAdminActor()
  const serviceClient = createServiceClient()
  const patientEmail = text(formData, 'patient_email').toLowerCase()
  if (!patientEmail.includes('@')) throw new Error('Valid patient email is required')
  const patientId = await findOrInvitePatient(patientEmail)
  const sequence = await getNextCaseRefSeq(serviceClient)
  const caseRef = generateCaseRef(new Date().getFullYear(), sequence)
  const partnerId = text(formData, 'partner_id')
  const caseType = text(formData, 'case_type')

  if (caseType !== 'cashless' && caseType !== 'reimbursement') {
    throw new Error('Case type is required')
  }

  const { data: caseRow, error: caseError } = await serviceClient
    .from('cases')
    .insert({
      patient_id: patientId,
      ...(partnerId ? { partner_id: partnerId } : {}),
      case_ref: caseRef,
      intake_channel: 'admin_created',
      status: 'documents_pending',
      claim_amount_inr: numberOrNull(text(formData, 'claim_amount_inr')),
      insurer_name: text(formData, 'insurer_name') || null,
      procedure_category: text(formData, 'procedure_category') || null,
      case_type: caseType,
      payment_waived: true,
      payment_waived_reason: 'pilot_case',
      payment_mode: 'admin_waived',
      payment_reporting_category: 'waived',
    })
    .select('id, case_ref')
    .single()

  if (caseError) throw new Error(caseError.message)

  const [outcomeResult, reportResult] = await Promise.all([
    serviceClient.from('outcomes').insert({
      case_id: caseRow.id,
      outcome_type: 'pending',
    }),
    serviceClient.from('reports').insert({
      case_id: caseRow.id,
      report_version: 1,
      appeal_letter_included: true,
    }),
  ])
  const childError = outcomeResult.error ?? reportResult.error
  if (childError) throw new Error(childError.message)

  const uploadLink = `${appUrl()}/app/upload`
  const emailResult = await sendOpsEmail({
    to: patientEmail,
    subject: `A ClaimClarity case has been created - ${caseRow.case_ref}`,
    text: `A claim analysis case has been created for you. Please log in and upload your documents: ${uploadLink}`,
    html: `<p>A claim analysis case has been created for you.</p><p><a href="${uploadLink}">Log in and upload your documents</a></p>`,
  })

  await logAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'admin_case_created',
    entityType: 'case',
    entityId: caseRow.id,
    metadata: {
      case_ref: caseRow.case_ref,
      payment_mode: 'admin_waived',
      payment_reporting_category: 'waived',
      email_status: emailResult.status,
      ...(emailResult.status === 'sent'
        ? { email_message_id: emailResult.messageId }
        : { email_warning: emailResult.reason }),
    },
  })

  redirect(`/cases/${caseRow.id}`)
}
