/**
 * @file consent.ts
 * @module web/lib/consent
 *
 * Consent validation helpers shared by API routes and middleware.
 *
 * DEPENDENCIES:
 *   - /packages/db/src/types.ts
 *   - /packages/shared/src/constants.ts
 *
 * CALLED BY:
 *   - /apps/web/middleware.ts
 *   - /apps/web/app/api/consents/route.ts
 *   - /apps/web/app/api/consents/status/route.ts
 *
 * CALLS:
 *   - Supabase consents table
 */

import type { DbClient } from '@claimclarity/db'
import { REQUIRED_CONSENT_TYPES } from '@claimclarity/shared/constants'

export type ConsentType = (typeof REQUIRED_CONSENT_TYPES)[number]

export const CONSENT_COPY: Record<ConsentType, string> = {
  data_processing:
    'I consent to ClaimClarity processing my health insurance documents to prepare a claim analysis report.',
  no_training: 'I understand my documents will not be used to train any AI model.',
  retention_policy:
    'I understand my uploaded documents will be permanently deleted 90 days after my report is delivered.',
  informational_only:
    'I understand this report is informational support only and does not constitute insurance, legal, or medical advice.',
  terms_of_service: 'I have read and agree to the Terms of Service and Privacy Policy.',
}

export type ConsentInput = {
  type: string
  given: boolean
}

export type ConsentStatusInput = {
  client: DbClient
  userId: string
}

function getCurrentPrivacyPolicyVersion(): string {
  return process.env.PRIVACY_POLICY_VERSION ?? 'v1.0-2024-04-01'
}

/**
 * Returns the consent types missing from a submitted consent payload.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, pure validation over the provided array
 *
 * @param consents - Consent payload entries submitted by the patient
 * @returns Consent types missing or not explicitly given=true
 */
export function getMissingSubmittedConsentTypes(consents: ConsentInput[]): ConsentType[] {
  const givenTypes = new Set(
    consents.filter((consent) => consent.given).map((consent) => consent.type)
  )

  return REQUIRED_CONSENT_TYPES.filter((consentType) => !givenTypes.has(consentType))
}

/**
 * Returns consent types still missing for a patient and policy version.
 *
 * SIDE EFFECTS: reads from consents table
 * THROWS: Error when Supabase returns a non-RLS read error
 * IDEMPOTENT: yes, reads active consent rows only
 *
 * @param input - Supabase client and patient user id
 * @returns Consent types missing for the current privacy policy version
 */
export async function getMissingConsentTypes(input: ConsentStatusInput): Promise<ConsentType[]> {
  const { data, error } = await input.client
    .from('consents')
    .select('consent_type')
    .eq('user_id', input.userId)
    .is('revoked_at', null)
    .eq('privacy_policy_version', getCurrentPrivacyPolicyVersion())

  if (error) {
    throw new Error(`Unable to read consent status: ${error.message}`)
  }

  const activeTypes = new Set(data.map((consent) => consent.consent_type))
  return REQUIRED_CONSENT_TYPES.filter((consentType) => !activeTypes.has(consentType))
}

/**
 * Returns true when every required consent type is complete.
 *
 * SIDE EFFECTS: reads from consents table
 * THROWS: Error when consent status lookup fails
 * IDEMPOTENT: yes, reads active consent rows only
 *
 * @param input - Supabase client and patient user id
 * @returns True when all required active consents exist
 */
export async function hasCompleteConsent(input: ConsentStatusInput): Promise<boolean> {
  const missing = await getMissingConsentTypes(input)
  return missing.length === 0
}
