/**
 * @file verify.ts
 * @module db/verify
 *
 * Module 0 infrastructure verification.
 *
 * DEPENDENCIES:
 *   - @supabase/supabase-js (server-side verification client)
 *
 * CALLED BY:
 *   - manual Module 0 verification runs
 *
 * CALLS:
 *   - Supabase tables, storage APIs, and verification helper RPCs
 */

import { createClient } from '@supabase/supabase-js'

import type { Database } from './types'

const REQUIRED_TABLES = [
  'users',
  'partners',
  'consents',
  'cases',
  'documents',
  'findings',
  'escalations',
  'processing_jobs',
  'kb_clause_patterns',
  'kb_change_log',
  'reports',
  'quality_scores',
  'outcomes',
  'outcome_tokens',
  'follow_up_schedule',
  'payments',
  'reviewer_notifications',
  'audit_log'
] as const

const REQUIRED_BUCKETS = ['case-documents', 'reports', 'outcome-evidence'] as const
const REQUIRED_RLS_TABLES = [
  'users',
  'partners',
  'consents',
  'cases',
  'documents',
  'findings',
  'escalations',
  'processing_jobs',
  'reports',
  'quality_scores',
  'kb_clause_patterns',
  'kb_change_log',
  'outcomes',
  'outcome_tokens',
  'follow_up_schedule',
  'payments',
  'reviewer_notifications',
  'audit_log'
] as const

type VerificationResult = {
  pass: boolean
  detail: string | undefined
}

function requireEnv(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`)
  }

  return value
}

/**
 * Runs all executable Module 0 infrastructure checks against Supabase.
 *
 * SIDE EFFECTS: reads schema metadata, reads storage metadata, inserts one audit_log row
 * THROWS: Error when required verification environment variables are missing
 * IDEMPOTENT: no, inserts a verification audit row before testing audit immutability
 *
 * @returns Nothing; exits the Node.js process with a pass or fail code
 */
async function verify(): Promise<void> {
  const results: Record<string, VerificationResult> = {}

  const serviceClient = createClient<Database>(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  )

  for (const table of REQUIRED_TABLES) {
    const { error } = await serviceClient.from(table).select('id').limit(0)
    results[`table_${table}`] = {
      pass: !error,
      detail: error ? error.message : undefined
    }
  }

  const { data: buckets, error: bucketError } = await serviceClient.storage.listBuckets()
  if (bucketError) {
    results.bucket_list = { pass: false, detail: bucketError.message }
  } else {
    const bucketNames = buckets.map(bucket => bucket.name)

    for (const bucket of REQUIRED_BUCKETS) {
      results[`bucket_${bucket}`] = { pass: bucketNames.includes(bucket), detail: undefined }
    }
  }

  const { data: seqExists, error: seqError } = await serviceClient.rpc('verify_sequence_exists', {
    seq_name: 'case_ref_seq'
  })
  results.case_ref_sequence = {
    pass: seqExists === true,
    detail: seqError?.message
  }

  const insertResult = await serviceClient
    .from('audit_log')
    .insert({ action: '__verify_test__', actor_role: 'verify' })
    .select('id, action')
    .single()

  if (insertResult.error) {
    results.audit_log_insert = {
      pass: false,
      detail: insertResult.error.message
    }
  } else {
    const rowId = insertResult.data.id
    await serviceClient.from('audit_log').update({ action: '__modified__' }).eq('id', rowId)

    const rereadResult = await serviceClient
      .from('audit_log')
      .select('action')
      .eq('id', rowId)
      .single()

    const actionStillOriginal = rereadResult.data?.action === '__verify_test__'
    results.audit_log_immutable = {
      pass: actionStillOriginal,
      detail: actionStillOriginal
        ? undefined
        : `Expected __verify_test__, got ${rereadResult.data?.action ?? 'null'}`
    }
  }

  for (const table of REQUIRED_RLS_TABLES) {
    const { data: rlsEnabled, error } = await serviceClient.rpc('verify_rls_enabled', {
      tbl: table
    })
    results[`rls_${table}`] = {
      pass: rlsEnabled === true,
      detail: error?.message
    }
  }

  const { data: generatedExists, error: generatedError } = await serviceClient.rpc(
    'verify_generated_column',
    {
      tbl: 'outcomes',
      col: 'reversal_amount_inr'
    }
  )
  results.reversal_amount_generated = {
    pass: generatedExists === true,
    detail: generatedError?.message
  }

  const anonClient = createClient<Database>(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  )
  const anonChecks: Array<[string, string]> = [
    ['cases', 'anon_cannot_read_cases'],
    ['documents', 'anon_cannot_read_documents'],
    ['findings', 'anon_cannot_read_findings'],
    ['payments', 'anon_cannot_read_payments']
  ]

  for (const [table, key] of anonChecks) {
    const { data, error } = await anonClient.from(table).select('id').limit(1)
    const rowCount = data === null ? 0 : data.length
    results[key] = {
      pass: !!error || rowCount === 0,
      detail: !error && rowCount > 0 ? `RLS leak: ${table} returned rows to anon` : undefined
    }
  }

  const failed = Object.entries(results).filter(([, value]) => !value.pass)
  const total = Object.keys(results).length
  const passed = total - failed.length

  console.log('\nMODULE 0 CHECKPOINT REPORT')
  console.log('==========================')
  for (const [key, value] of Object.entries(results)) {
    console.log(`${value.pass ? 'PASS' : 'FAIL'} ${key}${value.detail ? ` - ${value.detail}` : ''}`)
  }
  console.log(`\n${String(passed)}/${String(total)} checks passed`)

  if (failed.length > 0) {
    console.log('\nFAILED CHECKS:')
    for (const [key, value] of failed) {
      console.log(`  FAIL ${key}${value.detail ? `: ${value.detail}` : ''}`)
    }
    console.log('\nFAIL - Fix all failures before proceeding to Module 1.')
    process.exit(1)
  }

  console.log('\nPASS - Module 0 complete. Proceed to Module 1.')
  process.exit(0)
}

verify().catch((error: unknown) => {
  console.error('Verify script crashed:', error)
  process.exit(1)
})
