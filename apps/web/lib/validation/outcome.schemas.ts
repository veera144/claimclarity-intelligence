/**
 * @file outcome.schemas.ts
 * @module web/lib/validation
 *
 * Zod schemas for Module 9 outcome submissions.
 *
 * DEPENDENCIES:
 *   - zod
 *
 * CALLED BY:
 *   - /apps/web/app/api/outcomes/[caseId]/route.ts
 *   - /apps/web/app/api/outcomes/quick-update/route.ts
 *
 * CALLS:
 *   - none
 */

import { z } from 'zod'

export const patientActionTypeSchema = z.enum([
  'none',
  'asked_hospital',
  'asked_insurer_tpa',
  'submitted_appeal',
  'waiting_response',
  'closed_no_benefit',
])

export const outcomeTypeSchema = z.enum([
  'pending',
  'not_applicable',
  'no_change',
  'partial_reversal',
  'full_reversal',
])

export const quickOutcomeActionSchema = z.enum([
  'submitted_appeal',
  'not_yet',
  'no_appeal',
  'paid_more',
  'rejected',
  'waiting',
  'resolved',
  'no_change',
  'moved_on',
])

export const collectedViaSchema = z.enum([
  'email_survey_30d',
  'email_survey_60d',
  'email_survey_90d',
  'manual_call',
  'admin_entry',
])

export const fullOutcomeSubmissionSchema = z.object({
  token: z.string().min(16).optional(),
  appealSubmitted: z.boolean(),
  patientActionType: patientActionTypeSchema.optional(),
  insurerResponded: z.boolean().optional(),
  finalSettledAmountInr: z.number().int().min(0).optional(),
  outcomeType: outcomeTypeSchema.optional(),
  reportUsedInAppeal: z.boolean().optional(),
  userSatisfaction: z.number().int().min(1).max(5),
  userComment: z.string().max(500).optional(),
  evidenceStoragePath: z.string().min(1).max(300).optional(),
  collectedVia: collectedViaSchema.optional(),
})

export const quickOutcomeSubmissionSchema = z.object({
  token: z.string().min(16),
  action: quickOutcomeActionSchema,
})

export type FullOutcomeSubmissionInput = z.infer<typeof fullOutcomeSubmissionSchema>
export type QuickOutcomeSubmissionInput = z.infer<typeof quickOutcomeSubmissionSchema>
export type QuickOutcomeAction = z.infer<typeof quickOutcomeActionSchema>
export type OutcomeType = z.infer<typeof outcomeTypeSchema>
export type PatientActionType = z.infer<typeof patientActionTypeSchema>
