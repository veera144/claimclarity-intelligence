/**
 * @file cases.queries.ts
 * @module db/queries/cases
 *
 * Case and case-adjacent query helpers for Module 2 intake.
 *
 * DEPENDENCIES:
 *   - /packages/db/src/types.ts
 *
 * CALLED BY:
 *   - /apps/web/app/api/cases/route.ts
 *   - /apps/web/app/api/cases/[caseId]/documents/route.ts
 *
 * CALLS:
 *   - Supabase cases, outcomes, reports, and processing_jobs tables
 */

import type { DbClient } from '../types'

export type CaseRefSeqResult = {
  next_case_ref_seq: number
}

export type PatientCaseLookup = {
  id: string
  patient_id: string
  payment_waived: boolean
}

/**
 * Consumes the public.case_ref_seq sequence via the Module 2 RPC.
 *
 * SIDE EFFECTS: increments public.case_ref_seq in Supabase
 * THROWS: Error when Supabase rejects the RPC
 * IDEMPOTENT: no, every successful call advances the sequence
 *
 * @param client - Service-role Supabase client
 * @returns The next numeric case sequence
 */
export async function getNextCaseRefSeq(client: DbClient): Promise<number> {
  const { data, error } = await client.rpc('next_case_ref_seq')

  if (error) {
    throw new Error(error.message)
  }

  if (typeof data !== 'number') {
    throw new Error('next_case_ref_seq returned no sequence value')
  }

  return data
}

/**
 * Reads the minimal case fields needed to authorize Module 2 document actions.
 *
 * SIDE EFFECTS: reads cases
 * THROWS: Error when Supabase returns an unexpected read error
 * IDEMPOTENT: yes, read-only
 *
 * @param input - Case id and service-role database client
 * @returns The matching case row or null when not found
 */
export async function getCaseForPatientAction(input: {
  caseId: string
  client: DbClient
}): Promise<PatientCaseLookup | null> {
  const { data, error } = await input.client
    .from('cases')
    .select('id, patient_id, payment_waived')
    .eq('id', input.caseId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data
}
