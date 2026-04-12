/**
 * @file module1.test.ts
 * @module web/tests
 *
 * Executable Module 1 authentication, consent, RLS, rate-limit, and deletion checkpoints.
 *
 * DEPENDENCIES:
 *   - @supabase/ssr (session cookie generation for real route checks)
 *   - @supabase/supabase-js (Supabase auth, RLS, and service-role verification)
 *   - /packages/db/src/types.ts
 *   - /packages/shared/src/constants.ts
 *
 * CALLED BY:
 *   - pnpm test:module1
 *
 * CALLS:
 *   - Next.js web app routes over HTTP
 *   - Supabase Auth admin APIs and public schema tables
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { createBrowserClient } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@claimclarity/db/types'
import { REQUIRED_CONSENT_TYPES, TOMBSTONE_USER_ID } from '@claimclarity/shared/constants'

type DbClient = SupabaseClient<Database>

type CheckpointName =
  | 'consent_gate_blocks_access'
  | 'consent_capture_five_rows'
  | 'consent_gate_allows_after'
  | 'ip_masking'
  | 'rls_cross_patient_blocked'
  | 'rate_limiting'
  | 'deletion_anonymizes'

type CheckpointResult = {
  pass: boolean
  detail?: string
}

type TestUser = {
  id: string
  email: string
  password: string
  accessToken: string
  cookieHeader: string
}

type WebServer = {
  baseUrl: string
  process: ChildProcessWithoutNullStreams | null
  logs: string[]
}

type CookieToSet = {
  name: string
  value: string
}

const CHECKPOINTS: readonly CheckpointName[] = [
  'consent_gate_blocks_access',
  'consent_capture_five_rows',
  'consent_gate_allows_after',
  'ip_masking',
  'rls_cross_patient_blocked',
  'rate_limiting',
  'deletion_anonymizes',
]

const MODULE1_TEST_PORT = 3101
const REQUEST_TIMEOUT_MS = 10_000
const SERVER_START_TIMEOUT_MS = 90_000
const SERVER_POLL_MS = 750
const DEFAULT_PRIVACY_POLICY_VERSION = 'v1.0-2024-04-01'
const DEFAULT_TERMS_VERSION = 'v1.0-2024-04-01'
const TEST_PASSWORD = 'Module1-test-password-12345'
const REPORT_PRICE_PAISE = 69_900

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function loadRootEnv(): void {
  const envPath = resolve(rootDir, '.env.local')
  const content = readFileSync(envPath, 'utf8')

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) {
      continue
    }

    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }

    const key = line.slice(0, separatorIndex)
    const value = line.slice(separatorIndex + 1)
    if (!process.env[key]) {
      process.env[key] = value
    }
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`)
  }
  return value
}

function assertCondition(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function getPrivacyPolicyVersion(): string {
  return process.env.PRIVACY_POLICY_VERSION ?? DEFAULT_PRIVACY_POLICY_VERSION
}

function getTermsVersion(): string {
  return process.env.TERMS_VERSION ?? DEFAULT_TERMS_VERSION
}

function makeServiceClient(): DbClient {
  return createClient<Database>(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

function makeAuthenticatedClient(accessToken: string): DbClient {
  return createClient<Database>(requireEnv('NEXT_PUBLIC_SUPABASE_URL'), requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  })
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, REQUEST_TIMEOUT_MS)

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function startWebServer(): Promise<WebServer> {
  const configuredBaseUrl = process.env.MODULE1_TEST_BASE_URL
  if (configuredBaseUrl) {
    return {
      baseUrl: configuredBaseUrl,
      process: null,
      logs: [],
    }
  }

  const logs: string[] = []
  const nextCli = resolve(rootDir, 'apps', 'web', 'node_modules', 'next', 'dist', 'bin', 'next')
  const child = spawn(
    process.execPath,
    [nextCli, 'dev', '--hostname', '127.0.0.1', '--port', String(MODULE1_TEST_PORT)],
    {
      cwd: resolve(rootDir, 'apps', 'web'),
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: '1',
      },
    }
  )

  child.stdout.on('data', (chunk: Buffer) => {
    logs.push(chunk.toString('utf8'))
  })
  child.stderr.on('data', (chunk: Buffer) => {
    logs.push(chunk.toString('utf8'))
  })

  const baseUrl = `http://127.0.0.1:${String(MODULE1_TEST_PORT)}`
  const startTime = Date.now()

  while (Date.now() - startTime < SERVER_START_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      throw new Error(`Next dev server exited early: ${logs.join('').slice(-2000)}`)
    }

    try {
      const response = await fetchWithTimeout(`${baseUrl}/login`)
      if (response.status < 500) {
        return { baseUrl, process: child, logs }
      }
    } catch {
      await delay(SERVER_POLL_MS)
    }
  }

  child.kill()
  throw new Error(`Next dev server did not become ready: ${logs.join('').slice(-2000)}`)
}

function stopWebServer(server: WebServer): void {
  if (server.process && server.process.exitCode === null) {
    server.process.kill()
  }
}

async function waitForUserRow(serviceClient: DbClient, userId: string): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { data, error } = await serviceClient
      .from('users')
      .select('id')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      throw new Error(`Unable to read user row: ${error.message}`)
    }

    if (data) {
      return
    }

    await delay(250)
  }

  throw new Error(`Auth trigger did not create users row for ${userId}`)
}

function cookieHeaderFromMap(cookies: Map<string, string>): string {
  return Array.from(cookies.entries())
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join('; ')
}

async function createTestUser(serviceClient: DbClient, label: string): Promise<TestUser> {
  const token = randomUUID()
  const email = `module1-${label}-${token}@claimclarity.internal`
  const password = TEST_PASSWORD
  const createResult = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      module: 'module1',
      test_run: token,
    },
  })

  if (createResult.error) {
    throw new Error(`Unable to create test user: ${createResult.error.message}`)
  }

  const userId = createResult.data.user.id
  assertCondition(Boolean(userId), 'Supabase did not return a test user id')

  try {
    await waitForUserRow(serviceClient, userId)

    const cookies = new Map<string, string>()
    const browserClient = createBrowserClient<Database>(
      requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
      requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
      {
        cookies: {
          getAll() {
            return Array.from(cookies.entries()).map(([name, value]) => ({ name, value }))
          },
          setAll(cookiesToSet: CookieToSet[]) {
            cookiesToSet.forEach(({ name, value }) => {
              if (value) {
                cookies.set(name, value)
              } else {
                cookies.delete(name)
              }
            })
          },
        },
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: true,
        },
      }
    )

    const signInResult = await browserClient.auth.signInWithPassword({ email, password })
    if (signInResult.error) {
      throw new Error(`Unable to sign in test user: ${signInResult.error.message}`)
    }

    const accessToken = signInResult.data.session.access_token
    assertCondition(Boolean(accessToken), 'Supabase sign-in did not return an access token')

    const cookieHeader = cookieHeaderFromMap(cookies)
    assertCondition(cookieHeader.length > 0, 'Supabase SSR client did not produce session cookies')

    return {
      id: userId,
      email,
      password,
      accessToken,
      cookieHeader,
    }
  } catch (error) {
    await serviceClient.auth.admin.deleteUser(userId)
    throw error
  }
}

async function deleteTestUser(serviceClient: DbClient, user: TestUser): Promise<void> {
  await serviceClient.from('consents').delete().eq('user_id', user.id)
  await serviceClient.auth.admin.deleteUser(user.id)
}

async function insertConsentRows(serviceClient: DbClient, userId: string): Promise<void> {
  const rows = REQUIRED_CONSENT_TYPES.map((consentType) => ({
    user_id: userId,
    consent_type: consentType,
    consent_given: true,
    privacy_policy_version: getPrivacyPolicyVersion(),
    terms_version: getTermsVersion(),
    source_channel: 'patient_web' as const,
    ip_address: '10.0.',
  }))

  const { error } = await serviceClient.from('consents').insert(rows)
  if (error) {
    throw new Error(`Unable to insert test consents: ${error.message}`)
  }
}

async function postConsents(baseUrl: string, user: TestUser, ipAddress: string): Promise<Response> {
  return fetchWithTimeout(`${baseUrl}/api/consents`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: user.cookieHeader,
      'user-agent': 'module1-checkpoint',
      'x-forwarded-for': ipAddress,
    },
    body: JSON.stringify({
      consents: REQUIRED_CONSENT_TYPES.map((consentType) => ({
        type: consentType,
        given: true,
      })),
      privacyPolicyVersion: getPrivacyPolicyVersion(),
      termsVersion: getTermsVersion(),
    }),
  })
}

async function countConsents(serviceClient: DbClient, userId: string): Promise<number> {
  const { count, error } = await serviceClient
    .from('consents')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  if (error) {
    throw new Error(`Unable to count consents: ${error.message}`)
  }

  return count ?? 0
}

async function checkpointConsentGateBlocksAccess(
  serviceClient: DbClient,
  server: WebServer
): Promise<void> {
  const user = await createTestUser(serviceClient, 'gate-block')
  try {
    const response = await fetchWithTimeout(`${server.baseUrl}/app/upload`, {
      headers: { cookie: user.cookieHeader },
      redirect: 'manual',
    })
    const location = response.headers.get('location') ?? ''

    assertCondition(
      response.status >= 300 && response.status < 400 && location.endsWith('/app/consent'),
      `Expected redirect to /app/consent, got ${String(response.status)} ${location}`
    )
  } finally {
    await deleteTestUser(serviceClient, user)
  }
}

async function checkpointConsentCaptureFiveRows(
  serviceClient: DbClient,
  server: WebServer
): Promise<void> {
  const user = await createTestUser(serviceClient, 'capture')
  try {
    const response = await postConsents(server.baseUrl, user, '203.0.113.10')
    assertCondition(response.ok, `Expected consent POST success, got ${String(response.status)}`)

    const consentCount = await countConsents(serviceClient, user.id)
    assertCondition(consentCount === 5, `Expected 5 consent rows, got ${String(consentCount)}`)
  } finally {
    await deleteTestUser(serviceClient, user)
  }
}

async function checkpointConsentGateAllowsAfter(
  serviceClient: DbClient,
  server: WebServer
): Promise<void> {
  const user = await createTestUser(serviceClient, 'gate-allow')
  try {
    await insertConsentRows(serviceClient, user.id)
    const response = await fetchWithTimeout(`${server.baseUrl}/app/upload`, {
      headers: { cookie: user.cookieHeader },
      redirect: 'manual',
    })
    const location = response.headers.get('location') ?? ''

    assertCondition(
      !(response.status >= 300 && response.status < 400 && location.endsWith('/app/consent')),
      `Expected no consent redirect after capture, got ${String(response.status)} ${location}`
    )
  } finally {
    await deleteTestUser(serviceClient, user)
  }
}

async function checkpointIpMasking(serviceClient: DbClient, server: WebServer): Promise<void> {
  const user = await createTestUser(serviceClient, 'ip-mask')
  try {
    const response = await postConsents(server.baseUrl, user, '192.168.100.50')
    assertCondition(response.ok, `Expected consent POST success, got ${String(response.status)}`)

    const { data, error } = await serviceClient
      .from('consents')
      .select('ip_address')
      .eq('user_id', user.id)

    if (error) {
      throw new Error(`Unable to read consent IP addresses: ${error.message}`)
    }

    assertCondition(data.length === 5, `Expected 5 consent rows, got ${String(data.length)}`)
    const invalid = data.find(row => row.ip_address !== '192.168.')
    assertCondition(!invalid, `Expected masked IP 192.168., got ${invalid?.ip_address ?? 'null'}`)
  } finally {
    await deleteTestUser(serviceClient, user)
  }
}

async function checkpointRlsCrossPatientBlocked(serviceClient: DbClient): Promise<void> {
  const userA = await createTestUser(serviceClient, 'rls-a')
  const userB = await createTestUser(serviceClient, 'rls-b')

  try {
    await insertConsentRows(serviceClient, userA.id)
    await insertConsentRows(serviceClient, userB.id)

    const patientClient = makeAuthenticatedClient(userA.accessToken)
    const { data, error } = await patientClient
      .from('consents')
      .select('id,user_id')
      .eq('user_id', userB.id)

    if (error) {
      throw new Error(`Cross-patient consent read errored: ${error.message}`)
    }

    assertCondition(data.length === 0, `Expected 0 cross-patient rows, got ${String(data.length)}`)
  } finally {
    await deleteTestUser(serviceClient, userA)
    await deleteTestUser(serviceClient, userB)
  }
}

async function checkpointRateLimiting(serviceClient: DbClient, server: WebServer): Promise<void> {
  const user = await createTestUser(serviceClient, 'rate-limit')
  const ipAddress = `198.51.100.${String(Number.parseInt(randomUUID().slice(0, 2), 16) || 1)}`

  try {
    const statuses: number[] = []
    for (let requestNumber = 0; requestNumber < 15; requestNumber += 1) {
      const response = await postConsents(server.baseUrl, user, ipAddress)
      statuses.push(response.status)
    }

    const blockedStatuses = statuses.slice(10)
    const allBlocked = blockedStatuses.every(status => status === 429)
    assertCondition(
      allBlocked,
      `Expected requests 11-15 to return 429, got ${blockedStatuses.join(', ')}`
    )
  } finally {
    await deleteTestUser(serviceClient, user)
  }
}

async function checkpointDeletionAnonymizes(serviceClient: DbClient, server: WebServer): Promise<void> {
  const user = await createTestUser(serviceClient, 'delete')
  const caseRef = `CC-M1-${randomUUID().slice(0, 8)}`
  let caseId: string | null = null

  try {
    const tombstone = await serviceClient
      .from('users')
      .select('id')
      .eq('id', TOMBSTONE_USER_ID)
      .maybeSingle()

    if (tombstone.error) {
      throw new Error(`Unable to read tombstone user: ${tombstone.error.message}`)
    }
    assertCondition(Boolean(tombstone.data), 'Tombstone user row is missing')

    const caseInsert = await serviceClient
      .from('cases')
      .insert({
        patient_id: user.id,
        case_ref: caseRef,
        intake_channel: 'patient_web',
        status: 'documents_pending',
      })
      .select('id')
      .single()

    if (caseInsert.error) {
      throw new Error(`Unable to create deletion test case: ${caseInsert.error.message}`)
    }
    caseId = caseInsert.data.id

    const paymentInsert = await serviceClient.from('payments').insert({
      case_id: caseId,
      patient_id: user.id,
      amount_inr: REPORT_PRICE_PAISE,
      payment_type: 'report',
      status: 'pending',
    })
    if (paymentInsert.error) {
      throw new Error(`Unable to create deletion test payment: ${paymentInsert.error.message}`)
    }

    const response = await fetchWithTimeout(`${server.baseUrl}/api/patients/delete-my-data`, {
      method: 'POST',
      headers: {
        cookie: user.cookieHeader,
        'x-forwarded-for': '203.0.113.99',
      },
    })
    assertCondition(response.ok, `Expected deletion route success, got ${String(response.status)}`)

    const caseRead = await serviceClient
      .from('cases')
      .select('patient_id')
      .eq('id', caseId)
      .single()
    if (caseRead.error) {
      throw new Error(`Unable to read anonymized case: ${caseRead.error.message}`)
    }

    const userRead = await serviceClient
      .from('users')
      .select('email')
      .eq('id', user.id)
      .single()
    if (userRead.error) {
      throw new Error(`Unable to read anonymized user: ${userRead.error.message}`)
    }

    assertCondition(
      caseRead.data.patient_id === TOMBSTONE_USER_ID,
      `Expected tombstone patient_id, got ${caseRead.data.patient_id}`
    )
    assertCondition(Boolean(userRead.data), 'Expected anonymized users row to still exist')
    assertCondition(
      userRead.data.email === `deleted-${user.id}@claimclarity.internal`,
      `Expected deleted email marker, got ${userRead.data.email}`
    )
  } finally {
    if (caseId) {
      await serviceClient.from('payments').delete().eq('case_id', caseId)
      await serviceClient.from('reports').delete().eq('case_id', caseId)
      await serviceClient.from('cases').delete().eq('id', caseId)
    }
    await serviceClient.from('consents').delete().eq('user_id', user.id)
    await serviceClient.auth.admin.deleteUser(user.id)
  }
}

async function runCheckpoint(
  name: CheckpointName,
  results: Partial<Record<CheckpointName, CheckpointResult>>,
  check: () => Promise<void>
): Promise<void> {
  try {
    await check()
    results[name] = { pass: true }
  } catch (error) {
    results[name] = {
      pass: false,
      detail: errorMessage(error),
    }
  }
}

function printReport(results: Partial<Record<CheckpointName, CheckpointResult>>): number {
  console.log('\nMODULE 1 CHECKPOINT REPORT')
  console.log('==========================')

  for (const checkpoint of CHECKPOINTS) {
    const result = results[checkpoint] ?? {
      pass: false,
      detail: 'Checkpoint did not run',
    }
    console.log(
      `${result.pass ? 'PASS' : 'FAIL'} ${checkpoint}${result.detail ? ` - ${result.detail}` : ''}`
    )
  }

  const passed = CHECKPOINTS.filter(checkpoint => results[checkpoint]?.pass === true).length
  console.log(`\n${String(passed)}/${String(CHECKPOINTS.length)} checks passed`)
  console.log(passed === CHECKPOINTS.length ? 'PASS - proceed to review' : 'FAIL - fix before Module 2')

  return passed === CHECKPOINTS.length ? 0 : 1
}

async function main(): Promise<void> {
  loadRootEnv()

  const serviceClient = makeServiceClient()
  const server = await startWebServer()
  const results: Partial<Record<CheckpointName, CheckpointResult>> = {}

  try {
    await runCheckpoint('consent_gate_blocks_access', results, () =>
      checkpointConsentGateBlocksAccess(serviceClient, server)
    )
    await runCheckpoint('consent_capture_five_rows', results, () =>
      checkpointConsentCaptureFiveRows(serviceClient, server)
    )
    await runCheckpoint('consent_gate_allows_after', results, () =>
      checkpointConsentGateAllowsAfter(serviceClient, server)
    )
    await runCheckpoint('ip_masking', results, () => checkpointIpMasking(serviceClient, server))
    await runCheckpoint('rls_cross_patient_blocked', results, () =>
      checkpointRlsCrossPatientBlocked(serviceClient)
    )
    await runCheckpoint('rate_limiting', results, () =>
      checkpointRateLimiting(serviceClient, server)
    )
    await runCheckpoint('deletion_anonymizes', results, () =>
      checkpointDeletionAnonymizes(serviceClient, server)
    )
  } finally {
    stopWebServer(server)
  }

  process.exit(printReport(results))
}

main().catch((error: unknown) => {
  console.error('Module 1 checkpoint runner crashed:', error)
  process.exit(1)
})
