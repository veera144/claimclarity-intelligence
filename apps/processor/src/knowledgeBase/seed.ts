/**
 * @file seed.ts
 * @module processor/knowledge-base
 *
 * Seeds the deterministic Module 5 clause-pattern knowledge base.
 *
 * DEPENDENCIES:
 *   - @claimclarity/db
 *
 * CALLED BY:
 *   - /apps/processor/tests/module5.test.ts
 *   - manual Module 5 seed command
 *
 * CALLS:
 *   - Supabase users, kb_clause_patterns, and kb_change_log tables
 */

import { pathToFileURL } from 'node:url'

import { createServiceClient, type DbClient, type Json } from '@claimclarity/db'

export type SeedPatternDefinition = {
  clause_category: string
  insurer_name: string | null
  clause_keywords: string[]
  typical_clause_text: string
  common_deduction_trigger: string
  operative_reason_template: string
  plain_language_template: string
  appeal_point_template: string
  precedent_ombudsman_ref: string | null
}

type PatternRow = SeedPatternDefinition & {
  id: string
  is_active: boolean | null
  verified_by_expert: boolean | null
  verified_by: string | null
  verified_at: string | null
  added_by: string
}

function pattern(
  clauseCategory: string,
  clauseKeywords: string[],
  trigger: string,
  text: string,
  appeal: string
): SeedPatternDefinition {
  return {
    clause_category: clauseCategory,
    insurer_name: null,
    clause_keywords: clauseKeywords,
    typical_clause_text: text,
    common_deduction_trigger: trigger,
    operative_reason_template: trigger,
    plain_language_template: text,
    appeal_point_template: appeal,
    precedent_ombudsman_ref: null,
  }
}

export const REQUIRED_KB_PATTERNS: readonly SeedPatternDefinition[] = [
  {
    clause_category: 'room_rent',
    insurer_name: null,
    clause_keywords: ['room rent', 'room charge', 'accommodation', 'bed charges'],
    typical_clause_text:
      'Many retail health policies apply a daily room-rent sub-limit and may proportionately reduce linked charges when the selected room exceeds that limit.',
    common_deduction_trigger: 'Room rent exceeds sub-limit',
    operative_reason_template:
      'Room rent sub-limit of Rs {limit}/day. Hospital charged Rs {charged}/day. Proportional deduction applied to associated charges.',
    plain_language_template:
      'Your policy limits room rent to Rs {limit}/day. The hospital charged Rs {charged}/day. The extra, and a proportional cut on related charges, was deducted.',
    appeal_point_template:
      'Request the TPA to provide the exact clause number for the room rent sub-limit and confirm the proportional deduction method used.',
    precedent_ombudsman_ref: null,
  },
  pattern(
    'copay',
    ['co-pay', 'co-payment', 'copayment', 'patient contribution'],
    'Co-pay or patient contribution applied',
    'Some policies require the insured person to bear a fixed co-pay share of admissible claim amounts.',
    'Ask the insurer to cite the co-pay clause and show the calculation applied to this item.'
  ),
  pattern(
    'waiting_period',
    ['waiting period', 'pre-existing', 'PED', 'initial waiting'],
    'Waiting period or PED exclusion cited',
    'Policies commonly exclude certain illnesses or pre-existing disease treatment until the applicable waiting period is completed.',
    'Ask for the exact waiting-period clause and the medical basis used to connect it to this claim.'
  ),
  pattern(
    'non_medical_expenses',
    ['consumable', 'disposable', 'non-medical', 'toiletries'],
    'Non-medical or consumable expense deducted',
    'Consumables, disposables, and other non-medical expense heads are often excluded unless specifically covered.',
    'Ask the hospital for an itemized breakup and the insurer for the exclusion clause used.'
  ),
  pattern(
    'sublimit_procedure',
    ['sub-limit', 'sublimit', 'maximum payable', 'capped at'],
    'Procedure sub-limit applied',
    'Some procedures have a maximum payable amount or sub-limit regardless of the total bill.',
    'Ask for the procedure cap clause and a calculation of the capped amount.'
  ),
  pattern(
    'package_deduction',
    ['package rate', 'package', 'bundled', 'all-inclusive'],
    'Package-rate deduction applied',
    'Package-rate treatment may bundle room, procedure, consumable, and professional charges into a single agreed amount.',
    'Ask for the package-rate agreement or tariff and the items treated as included.'
  ),
  pattern(
    'daycare',
    ['daycare', 'day care', 'day procedure', 'less than 24 hours'],
    'Day-care eligibility questioned',
    'Day-care procedures may be covered only when listed or when they meet policy-defined treatment conditions.',
    'Ask whether this procedure is listed as day-care and what document is missing if not accepted.'
  ),
  pattern(
    'domiciliary',
    ['domiciliary', 'home treatment', 'home care'],
    'Domiciliary care condition cited',
    'Domiciliary treatment is often covered only when hospital admission was medically necessary but unavailable or impractical.',
    'Ask for the domiciliary-treatment clause and the condition that was treated as unmet.'
  ),
  pattern(
    'maternity',
    ['maternity', 'delivery', 'caesarean', 'c-section', 'newborn'],
    'Maternity or newborn limit applied',
    'Maternity, delivery, caesarean, and newborn expenses often have separate limits, waiting periods, or exclusions.',
    'Ask for the maternity clause, waiting period status, and limit calculation.'
  ),
  pattern(
    'dental',
    ['dental', 'tooth', 'teeth', 'orthodontic'],
    'Dental exclusion cited',
    'Dental treatment is commonly excluded unless caused by accident or specifically covered.',
    'Ask the insurer to cite the dental exclusion and any accident-related exception considered.'
  ),
  pattern(
    'vision',
    ['vision', 'spectacles', 'contact lens', 'cataract', 'refractive', 'lasik'],
    'Vision-related exclusion or cap cited',
    'Vision correction, spectacles, contact lenses, and refractive procedures commonly have exclusions or special sub-limits.',
    'Ask for the optical or cataract clause and the cap applied to this item.'
  ),
  pattern(
    'pharmacy_sublimit',
    ['pharmacy', 'medicine', 'drug', 'pharmaceutical'],
    'Pharmacy or medicine cap applied',
    'Some policies or package arrangements cap pharmacy, medicine, drug, or pharmaceutical charges.',
    'Ask for the pharmacy cap clause or package term used for the deduction.'
  ),
  pattern(
    'icu_stepdown',
    ['ICU', 'intensive care', 'critical care', 'ICCU'],
    'ICU or critical-care limit applied',
    'ICU, ICCU, and critical-care charges may have separate room category limits or medical-necessity checks.',
    'Ask for the ICU clause and the clinical or tariff basis for the deduction.'
  ),
  pattern(
    'specialist_consultation',
    ['specialist', 'consultant fee', 'visiting doctor'],
    'Specialist consultation fee questioned',
    'Specialist, consultant, and visiting doctor fees may be payable only when supported by treatment records and tariffs.',
    'Ask the hospital for supporting notes and the insurer for the tariff or exclusion applied.'
  ),
  pattern(
    'ayush',
    ['ayurveda', 'yoga', 'unani', 'siddha', 'homeopathy', 'AYUSH'],
    'AYUSH treatment condition cited',
    'AYUSH treatment may be covered only when taken at eligible facilities and within policy limits.',
    'Ask for the AYUSH clause and the facility eligibility basis used.'
  ),
  pattern(
    'opd_exclusion',
    ['OPD', 'outpatient', 'out-patient', 'outpatient department'],
    'OPD exclusion cited',
    'Outpatient or OPD expenses are commonly excluded unless the policy has a specific OPD benefit.',
    'Ask for the OPD exclusion or benefit clause used to assess this item.'
  ),
] as const

function toJson(value: unknown): Json {
  return value as Json
}

function getSeedAdminUserId(explicitUserId?: string): string {
  const adminUserId = explicitUserId ?? process.env.KB_SEED_ADMIN_USER_ID
  if (!adminUserId) {
    throw new Error('KB_SEED_ADMIN_USER_ID is required to seed kb_clause_patterns.')
  }

  return adminUserId
}

async function assertAdminUser(input: { client: DbClient; adminUserId: string }): Promise<void> {
  const { data, error } = await input.client
    .from('users')
    .select('id, role')
    .eq('id', input.adminUserId)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data || data.role !== 'admin') {
    throw new Error('KB_SEED_ADMIN_USER_ID must reference an existing users row with role=admin.')
  }
}

async function readExistingPattern(input: {
  client: DbClient
  clauseCategory: string
}): Promise<PatternRow | null> {
  const { data, error } = await input.client
    .from('kb_clause_patterns')
    .select(
      'id, insurer_name, clause_category, clause_keywords, typical_clause_text, common_deduction_trigger, operative_reason_template, plain_language_template, appeal_point_template, precedent_ombudsman_ref, is_active, verified_by_expert, verified_by, verified_at, added_by'
    )
    .eq('clause_category', input.clauseCategory)
    .is('insurer_name', null)
    .maybeSingle()

  if (error) throw new Error(error.message)
  return data as PatternRow | null
}

async function logSeedChange(input: {
  client: DbClient
  patternId: string
  adminUserId: string
  oldValues: PatternRow | null
  newValues: unknown
  changeType: 'created' | 'updated'
}): Promise<void> {
  const { error } = await input.client.from('kb_change_log').insert({
    pattern_id: input.patternId,
    changed_by: input.adminUserId,
    change_type: input.changeType,
    old_values: input.oldValues ? toJson(input.oldValues) : null,
    new_values: toJson(input.newValues),
    change_reason: 'Module 5 required seed pattern sync',
  })

  if (error) throw new Error(error.message)
}

/**
 * Seeds the 16 required Module 5 KB patterns.
 *
 * SIDE EFFECTS: inserts/updates kb_clause_patterns and kb_change_log
 * THROWS: Error when KB_SEED_ADMIN_USER_ID is missing or Supabase rejects a write
 * IDEMPOTENT: yes, existing category/insurer-neutral patterns are updated in place
 *
 * @param input - Optional service client and explicit admin owner for tests
 * @returns Number of active patterns after seeding
 */
export async function seedKnowledgeBase(input: {
  client?: DbClient
  adminUserId?: string
} = {}): Promise<number> {
  const client = input.client ?? createServiceClient()
  const adminUserId = getSeedAdminUserId(input.adminUserId)
  await assertAdminUser({ client, adminUserId })

  for (const seedPattern of REQUIRED_KB_PATTERNS) {
    const existing = await readExistingPattern({
      client,
      clauseCategory: seedPattern.clause_category,
    })

    if (!existing) {
      const { data, error } = await client
        .from('kb_clause_patterns')
        .insert({
          ...seedPattern,
          is_active: true,
          verified_by_expert: false,
          verified_by: null,
          verified_at: null,
          added_by: adminUserId,
        })
        .select(
          'id, insurer_name, clause_category, clause_keywords, typical_clause_text, common_deduction_trigger, operative_reason_template, plain_language_template, appeal_point_template, precedent_ombudsman_ref, is_active, verified_by_expert, verified_by, verified_at, added_by'
        )
        .single()

      if (error) throw new Error(error.message)

      await logSeedChange({
        client,
        patternId: data.id,
        adminUserId,
        oldValues: null,
        newValues: data,
        changeType: 'created',
      })
      continue
    }

    const { data, error } = await client
      .from('kb_clause_patterns')
      .update({
        ...seedPattern,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select(
        'id, insurer_name, clause_category, clause_keywords, typical_clause_text, common_deduction_trigger, operative_reason_template, plain_language_template, appeal_point_template, precedent_ombudsman_ref, is_active, verified_by_expert, verified_by, verified_at, added_by'
      )
      .single()

    if (error) throw new Error(error.message)

    await logSeedChange({
      client,
      patternId: existing.id,
      adminUserId,
      oldValues: existing,
      newValues: data,
      changeType: 'updated',
    })
  }

  const { count, error } = await client
    .from('kb_clause_patterns')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', true)

  if (error) throw new Error(error.message)
  return count ?? 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedKnowledgeBase()
    .then((count) => {
      console.log(`Module 5 KB seed complete. Active patterns: ${String(count)}`)
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exit(1)
    })
}
