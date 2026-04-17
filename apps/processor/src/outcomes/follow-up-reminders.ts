/**
 * @file follow-up-reminders.ts
 * @module processor/outcomes
 *
 * Sends Module 9 follow-up reminder emails with one-time outcome tokens.
 *
 * DEPENDENCIES:
 *   - @claimclarity/db (service-role DB and token generation)
 *   - /apps/processor/src/jobs/reportGenerationJob.ts (email sender shape)
 *
 * CALLED BY:
 *   - /apps/processor/tests/module9.test.ts
 *   - future processor scheduler
 *
 * CALLS:
 *   - Supabase follow_up_schedule, reports, cases, users, outcomes, audit_log
 *   - Resend email API through EmailSender
 */

import { createServiceClient, type DbClient, type Json } from '@claimclarity/db'
import { generateOutcomeToken } from '@claimclarity/db/outcome-tokens'

import { ResendHttpEmailSender, type EmailSender, type ReportReadyEmail } from '../jobs/reportGenerationJob'

type FollowUpRow = {
  id: string
  case_id: string
  sequence_number: 1 | 2 | 3
  scheduled_at: string
}

type ReminderContext = {
  caseRef: string
  patientEmail: string
  deliveredAt: string | null
  caseStatus: string
  outcomeType: string | null
  patientActionType: string | null
}

export type FollowUpReminderStore = {
  listDueFollowUps(now: Date): Promise<FollowUpRow[]>
  loadContext(caseId: string): Promise<ReminderContext | null>
  markSent(input: { scheduleId: string; sentAt: string; emailMessageId: string }): Promise<void>
  insertAudit(input: { action: string; caseId: string; metadata?: Json }): Promise<void>
  generateToken(caseId: string, tokenType: 'quick_update' | 'full_outcome', now: Date): Promise<string>
}

function toJson(value: unknown): Json {
  return value as Json
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://claimclarity.in').replace(/\/$/, '')
}

function actionUrl(input: {
  baseUrl: string
  token: string
  action: string
}): string {
  return `${input.baseUrl}/app/outcomes/update?token=${encodeURIComponent(
    input.token
  )}&action=${encodeURIComponent(input.action)}`
}

function isFinalOutcome(context: ReminderContext): boolean {
  return (
    context.caseStatus === 'closed' ||
    context.patientActionType === 'closed_no_benefit' ||
    context.outcomeType === 'not_applicable' ||
    context.outcomeType === 'no_change' ||
    context.outcomeType === 'partial_reversal' ||
    context.outcomeType === 'full_reversal'
  )
}

function sequenceActions(sequence: 1 | 2 | 3): Array<{ action: string; label: string }> {
  if (sequence === 1) {
    return [
      { action: 'submitted_appeal', label: 'Yes I did' },
      { action: 'not_yet', label: 'Not yet' },
      { action: 'no_appeal', label: 'Decided not to' },
    ]
  }

  if (sequence === 2) {
    return [
      { action: 'paid_more', label: 'Yes, paid more' },
      { action: 'rejected', label: 'Rejected' },
      { action: 'waiting', label: 'Still waiting' },
    ]
  }

  return [
    { action: 'resolved', label: 'Resolved favorably' },
    { action: 'no_change', label: 'No change' },
    { action: 'moved_on', label: 'I moved on' },
  ]
}

function subjectFor(sequence: 1 | 2 | 3, caseRef: string): string {
  if (sequence === 1) return `Did you submit an appeal? - Case ${caseRef}`
  if (sequence === 2) return `Has your insurer responded? - Case ${caseRef}`
  return `Final update on Case ${caseRef}`
}

/**
 * Builds a patient follow-up reminder email.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes
 *
 * @param input - Case, schedule, and token inputs for email links
 * @returns Email payload with quick buttons and full form link
 */
export function buildOutcomeFollowUpEmail(input: {
  patientEmail: string
  caseRef: string
  sequenceNumber: 1 | 2 | 3
  quickToken: string
  fullToken: string
  baseUrl?: string
}): ReportReadyEmail {
  const baseUrl = input.baseUrl ?? appUrl()
  const actions = sequenceActions(input.sequenceNumber)
  const fullUrl = `${baseUrl}/app/outcomes/update?token=${encodeURIComponent(input.fullToken)}`
  const links = actions.map((action) => ({
    ...action,
    url: actionUrl({ baseUrl, token: input.quickToken, action: action.action }),
  }))
  const subject = subjectFor(input.sequenceNumber, input.caseRef)

  return {
    to: input.patientEmail,
    subject,
    appLink: fullUrl,
    text: [
      `Following up on Case ${input.caseRef}.`,
      '',
      ...links.map((link) => `${link.label}: ${link.url}`),
      '',
      `Full update: ${fullUrl}`,
    ].join('\n'),
    html: [
      `<p>Following up on Case ${input.caseRef}.</p>`,
      '<p>',
      ...links.map((link) => `<a href="${link.url}">${link.label}</a><br>`),
      '</p>',
      `<p><a href="${fullUrl}">Update in full</a></p>`,
    ].join(''),
  }
}

/**
 * Creates a Supabase-backed follow-up reminder store.
 *
 * SIDE EFFECTS: reads service-role environment when no client is supplied
 * THROWS: Error when required environment variables are missing
 * IDEMPOTENT: yes, factory only
 *
 * @param client - Optional service-role client
 * @returns Follow-up reminder store
 */
export function createSupabaseFollowUpReminderStore(
  client: DbClient = createServiceClient()
): FollowUpReminderStore {
  return {
    async listDueFollowUps(now: Date): Promise<FollowUpRow[]> {
      const { data, error } = await client
        .from('follow_up_schedule')
        .select('id, case_id, sequence_number, scheduled_at')
        .is('sent_at', null)
        .lte('scheduled_at', now.toISOString())
        .order('scheduled_at', { ascending: true })
      if (error) throw new Error(error.message)
      return data as FollowUpRow[]
    },

    async loadContext(caseId: string): Promise<ReminderContext | null> {
      const { data: caseRow, error: caseError } = await client
        .from('cases')
        .select('case_ref, patient_id, status')
        .eq('id', caseId)
        .maybeSingle()
      if (caseError) throw new Error(caseError.message)
      if (!caseRow) return null

      const [reportResult, userResult, outcomeResult] = await Promise.all([
        client.from('reports').select('delivered_at').eq('case_id', caseId).maybeSingle(),
        client.from('users').select('email').eq('id', caseRow.patient_id).maybeSingle(),
        client
          .from('outcomes')
          .select('outcome_type, patient_action_type')
          .eq('case_id', caseId)
          .maybeSingle(),
      ])
      if (reportResult.error) throw new Error(reportResult.error.message)
      if (userResult.error) throw new Error(userResult.error.message)
      if (outcomeResult.error) throw new Error(outcomeResult.error.message)
      if (!userResult.data) return null

      return {
        caseRef: caseRow.case_ref,
        patientEmail: userResult.data.email,
        deliveredAt: reportResult.data?.delivered_at ?? null,
        caseStatus: caseRow.status,
        outcomeType: outcomeResult.data?.outcome_type ?? null,
        patientActionType: outcomeResult.data?.patient_action_type ?? null,
      }
    },

    async markSent(input): Promise<void> {
      const { error } = await client
        .from('follow_up_schedule')
        .update({
          sent_at: input.sentAt,
          email_message_id: input.emailMessageId,
        })
        .eq('id', input.scheduleId)
      if (error) throw new Error(error.message)
    },

    async insertAudit(input): Promise<void> {
      const { error } = await client.from('audit_log').insert({
        actor_role: 'processor',
        action: input.action,
        entity_type: 'case',
        entity_id: input.caseId,
        metadata: input.metadata ?? null,
      })
      if (error) throw new Error(error.message)
    },

    async generateToken(caseId, tokenType, now): Promise<string> {
      return generateOutcomeToken(caseId, tokenType, client, now)
    },
  }
}

/**
 * Sends due Module 9 follow-up reminders.
 *
 * SIDE EFFECTS: generates tokens immediately before send, sends email, marks sent_at and
 * email_message_id on success, writes audit rows on success/failure
 * THROWS: never for individual reminder failures
 * IDEMPOTENT: successful rows are skipped on later runs; failed rows remain retryable
 *
 * @param store - Follow-up store dependency
 * @param sender - Email sender dependency
 * @param now - Optional clock injection
 * @returns Number of reminders sent
 */
export async function processDueFollowUpReminders(
  store: FollowUpReminderStore = createSupabaseFollowUpReminderStore(),
  sender: EmailSender = new ResendHttpEmailSender(),
  now: Date = new Date()
): Promise<number> {
  const dueRows = await store.listDueFollowUps(now)
  let sent = 0

  for (const row of dueRows) {
    try {
      const context = await store.loadContext(row.case_id)
      if (!context || !context.deliveredAt || new Date(context.deliveredAt) > now) {
        continue
      }
      if (isFinalOutcome(context)) {
        continue
      }

      const [quickToken, fullToken] = await Promise.all([
        store.generateToken(row.case_id, 'quick_update', now),
        store.generateToken(row.case_id, 'full_outcome', now),
      ])
      const email = buildOutcomeFollowUpEmail({
        patientEmail: context.patientEmail,
        caseRef: context.caseRef,
        sequenceNumber: row.sequence_number,
        quickToken,
        fullToken,
      })
      const result = await sender.send(email)
      await store.markSent({
        scheduleId: row.id,
        sentAt: now.toISOString(),
        emailMessageId: result.id,
      })
      await store.insertAudit({
        action: 'followup_email_sent',
        caseId: row.case_id,
        metadata: toJson({
          sequence_number: row.sequence_number,
          email_message_id: result.id,
        }),
      })
      sent += 1
    } catch (error) {
      await store
        .insertAudit({
          action: 'followup_email_failed',
          caseId: row.case_id,
          metadata: toJson({
            sequence_number: row.sequence_number,
            reason: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
          }),
        })
        .catch(() => undefined)
    }
  }

  return sent
}
