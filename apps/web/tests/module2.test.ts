/**
 * @file module2.test.ts
 * @module web/tests
 *
 * Executable Module 2 document upload and quality-check checkpoints.
 *
 * DEPENDENCIES:
 *   - @supabase/ssr (session cookie generation)
 *   - @supabase/supabase-js (Supabase Auth admin APIs and service-role checks)
 *   - /apps/processor/src/jobs/quality-check.ts
 *   - /apps/web/lib/validation/document.schemas.ts
 *
 * CALLED BY:
 *   - pnpm test:module2
 *
 * CALLS:
 *   - Next.js web API routes over HTTP
 *   - Supabase Storage and public schema tables
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
import { queueProcessingJob } from '@claimclarity/db'
import { REQUIRED_CONSENT_TYPES } from '@claimclarity/shared/constants'

import { processQueuedQualityCheckJobs } from '../../../apps/processor/src/jobs/quality-check'
import { validateUploadFile, type UploadDocType } from '../lib/validation/document.schemas'

type DbClient = SupabaseClient<Database>

type CheckpointName =
  | 'client_blocks_oversized'
  | 'server_rejects_wrong_mime'
  | 'storage_path_uses_uuid'
  | 'quality_check_passes_good_document'
  | 'quality_check_fails_low_res_image'
  | 'case_moves_to_payment_pending'
  | 'waived_case_starts_processing'
  | 'idempotent_job_creation'

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

type TestCase = {
  id: string
  caseRef: string
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
  'client_blocks_oversized',
  'server_rejects_wrong_mime',
  'storage_path_uses_uuid',
  'quality_check_passes_good_document',
  'quality_check_fails_low_res_image',
  'case_moves_to_payment_pending',
  'waived_case_starts_processing',
  'idempotent_job_creation',
]

const MODULE2_TEST_PORT = 3102
const REQUEST_TIMEOUT_MS = 10_000
const SERVER_START_TIMEOUT_MS = 90_000
const SERVER_POLL_MS = 750
const DEFAULT_PRIVACY_POLICY_VERSION = 'v1.0-2024-04-01'
const DEFAULT_TERMS_VERSION = 'v1.0-2024-04-01'
const TEST_PASSWORD = 'Module2-test-password-12345'
const CASE_REF_PATTERN = /^case-documents\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/u

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
  const configuredBaseUrl = process.env.MODULE2_TEST_BASE_URL
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
    [nextCli, 'dev', '--hostname', '127.0.0.1', '--port', String(MODULE2_TEST_PORT)],
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

  const baseUrl = `http://127.0.0.1:${String(MODULE2_TEST_PORT)}`
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

function cookieHeaderFromMap(cookies: Map<string, string>): string {
  return Array.from(cookies.entries())
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .join('; ')
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

async function createTestUser(serviceClient: DbClient, label: string): Promise<TestUser> {
  const token = randomUUID()
  const email = `module2-${label}-${token}@claimclarity.internal`
  const password = TEST_PASSWORD
  const createResult = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      module: 'module2',
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

async function createTestCase(input: {
  serviceClient: DbClient
  userId: string
  label: string
  paymentWaived?: boolean
}): Promise<TestCase> {
  const caseRef = `CC-M2-${input.label}-${randomUUID().slice(0, 8)}`
  const { data, error } = await input.serviceClient
    .from('cases')
    .insert({
      patient_id: input.userId,
      case_ref: caseRef,
      intake_channel: 'patient_web',
      status: 'documents_pending',
      payment_waived: input.paymentWaived ?? false,
      ...(input.paymentWaived
        ? {
            payment_waived_reason: 'module2_test_waived',
            payment_mode: 'admin_waived',
            payment_reporting_category: 'waived',
          }
        : {}),
    })
    .select('id, case_ref')
    .single()

  if (error) {
    throw new Error(`Unable to create test case: ${error.message}`)
  }

  return { id: data.id, caseRef: data.case_ref }
}

async function cleanupCase(serviceClient: DbClient, caseId: string): Promise<void> {
  const { data: documents } = await serviceClient
    .from('documents')
    .select('storage_path')
    .eq('case_id', caseId)

  const paths =
    documents?.flatMap((document) =>
      document.storage_path.startsWith('case-documents/')
        ? [document.storage_path.slice('case-documents/'.length)]
        : []
    ) ?? []

  if (paths.length > 0) {
    await serviceClient.storage.from('case-documents').remove(paths)
  }

  await serviceClient.from('processing_jobs').delete().eq('case_id', caseId)
  await serviceClient.from('documents').delete().eq('case_id', caseId)
  await serviceClient.from('outcomes').delete().eq('case_id', caseId)
  await serviceClient.from('reports').delete().eq('case_id', caseId)
  await serviceClient.from('payments').delete().eq('case_id', caseId)
  await serviceClient.from('cases').delete().eq('id', caseId)
}

async function cleanupUser(serviceClient: DbClient, user: TestUser): Promise<void> {
  await serviceClient.from('consents').delete().eq('user_id', user.id)
  await serviceClient.auth.admin.deleteUser(user.id)
}

function makeGoodPdfFile(name = 'good_bill.pdf'): File {
  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R >>
endobj
4 0 obj
<< /Length 78 >>
stream
BT
/F1 12 Tf
72 220 Td
(Hospital bill table item amount English document) Tj
ET
endstream
endobj
trailer
<< /Root 1 0 R >>
%%EOF`

  return new File([new TextEncoder().encode(pdf)], name, { type: 'application/pdf' })
}

function makeLowResJpegFile(): File {
  const bytes = Uint8Array.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00,
    0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xd9,
  ])

  return new File([bytes], 'low_res.jpg', { type: 'image/jpeg' })
}

async function uploadDocument(input: {
  server: WebServer
  user: TestUser
  caseId: string
  file: File
  docType: UploadDocType
}): Promise<string> {
  const formData = new FormData()
  formData.append('file', input.file)
  formData.append('docType', input.docType)

  const response = await fetchWithTimeout(
    `${input.server.baseUrl}/api/cases/${input.caseId}/documents`,
    {
      method: 'POST',
      headers: {
        cookie: input.user.cookieHeader,
        'x-forwarded-for': `198.51.100.${String(Number.parseInt(randomUUID().slice(0, 2), 16) || 1)}`,
      },
      body: formData,
    }
  )

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    throw new Error(`Upload failed ${String(response.status)}: ${payload?.error ?? 'unknown'}`)
  }

  const payload = (await response.json()) as { documentId: string }
  return payload.documentId
}

async function readDocumentQuality(input: {
  serviceClient: DbClient
  documentId: string
}): Promise<{ quality_status: string | null; quality_failure_reason: string | null }> {
  const { data, error } = await input.serviceClient
    .from('documents')
    .select('quality_status, quality_failure_reason')
    .eq('id', input.documentId)
    .single()

  if (error) {
    throw new Error(`Unable to read document quality: ${error.message}`)
  }

  return data
}

function checkpointClientBlocksOversized(): void {
  let uploadCalled = false
  const validationError = validateUploadFile({
    size: 21 * 1024 * 1024,
    type: 'application/pdf',
  })

  if (!validationError) {
    uploadCalled = true
  }

  assertCondition(!uploadCalled, 'Expected oversized client validation to block upload')
  assertCondition(
    validationError === 'This file is 21MB. Maximum is 20MB.',
    `Unexpected oversized error: ${validationError ?? 'null'}`
  )
}

async function checkpointServerRejectsWrongMime(
  serviceClient: DbClient,
  server: WebServer
): Promise<void> {
  const user = await createTestUser(serviceClient, 'wrong-mime')
  let testCase: TestCase | null = null

  try {
    await insertConsentRows(serviceClient, user.id)
    testCase = await createTestCase({ serviceClient, userId: user.id, label: 'mime' })
    const formData = new FormData()
    formData.append('file', new File(['not a claim document'], 'wrong_type.txt', { type: 'text/plain' }))
    formData.append('docType', 'hospital_bill')

    const response = await fetchWithTimeout(
      `${server.baseUrl}/api/cases/${testCase.id}/documents`,
      {
        method: 'POST',
        headers: { cookie: user.cookieHeader, 'x-forwarded-for': '203.0.113.10' },
        body: formData,
      }
    )

    const { count, error } = await serviceClient
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('case_id', testCase.id)

    if (error) {
      throw new Error(`Unable to count wrong MIME documents: ${error.message}`)
    }

    assertCondition(response.status === 400, `Expected 400, got ${String(response.status)}`)
    assertCondition(count === 0, `Expected no document rows, got ${String(count ?? 0)}`)
  } finally {
    if (testCase) {
      await cleanupCase(serviceClient, testCase.id)
    }
    await cleanupUser(serviceClient, user)
  }
}

async function checkpointStoragePathUsesUuid(serviceClient: DbClient, server: WebServer): Promise<void> {
  const user = await createTestUser(serviceClient, 'storage-path')
  let testCase: TestCase | null = null

  try {
    await insertConsentRows(serviceClient, user.id)
    testCase = await createTestCase({ serviceClient, userId: user.id, label: 'path' })
    await uploadDocument({
      server,
      user,
      caseId: testCase.id,
      file: makeGoodPdfFile(),
      docType: 'hospital_bill',
    })

    const { data, error } = await serviceClient
      .from('documents')
      .select('storage_path')
      .eq('case_id', testCase.id)
      .single()

    if (error) {
      throw new Error(`Unable to read storage path: ${error.message}`)
    }

    assertCondition(!data.storage_path.includes('good_bill.pdf'), 'Storage path leaked original filename')
    assertCondition(
      CASE_REF_PATTERN.test(data.storage_path),
      `Storage path did not match UUID pattern: ${data.storage_path}`
    )
  } finally {
    if (testCase) {
      await cleanupCase(serviceClient, testCase.id)
    }
    await cleanupUser(serviceClient, user)
  }
}

async function checkpointQualityCheckPassesGoodDocument(
  serviceClient: DbClient,
  server: WebServer
): Promise<void> {
  const user = await createTestUser(serviceClient, 'good-quality')
  let testCase: TestCase | null = null

  try {
    await insertConsentRows(serviceClient, user.id)
    testCase = await createTestCase({ serviceClient, userId: user.id, label: 'good' })
    const documentId = await uploadDocument({
      server,
      user,
      caseId: testCase.id,
      file: makeGoodPdfFile(),
      docType: 'hospital_bill',
    })

    const start = Date.now()
    let status = await readDocumentQuality({ serviceClient, documentId })
    while (Date.now() - start < 30_000 && status.quality_status !== 'pass') {
      await processQueuedQualityCheckJobs(serviceClient, testCase.id)
      status = await readDocumentQuality({ serviceClient, documentId })
      if (status.quality_status !== 'pass') {
        await delay(500)
      }
    }

    assertCondition(status.quality_status === 'pass', `Expected pass, got ${status.quality_status ?? 'null'}`)
  } finally {
    if (testCase) {
      await cleanupCase(serviceClient, testCase.id)
    }
    await cleanupUser(serviceClient, user)
  }
}

async function checkpointQualityCheckFailsLowResImage(
  serviceClient: DbClient,
  server: WebServer
): Promise<void> {
  const user = await createTestUser(serviceClient, 'low-res')
  let testCase: TestCase | null = null

  try {
    await insertConsentRows(serviceClient, user.id)
    testCase = await createTestCase({ serviceClient, userId: user.id, label: 'lowres' })
    const documentId = await uploadDocument({
      server,
      user,
      caseId: testCase.id,
      file: makeLowResJpegFile(),
      docType: 'hospital_bill',
    })

    await processQueuedQualityCheckJobs(serviceClient, testCase.id)
    const status = await readDocumentQuality({ serviceClient, documentId })
    assertCondition(status.quality_status === 'fail', `Expected fail, got ${status.quality_status ?? 'null'}`)
    assertCondition(
      status.quality_failure_reason?.toLowerCase().includes('resolution') === true,
      `Expected resolution reason, got ${status.quality_failure_reason ?? 'null'}`
    )
  } finally {
    if (testCase) {
      await cleanupCase(serviceClient, testCase.id)
    }
    await cleanupUser(serviceClient, user)
  }
}

async function checkpointCaseMovesToPaymentPending(
  serviceClient: DbClient,
  server: WebServer
): Promise<void> {
  const user = await createTestUser(serviceClient, 'payment-pending')
  let testCase: TestCase | null = null

  try {
    await insertConsentRows(serviceClient, user.id)
    testCase = await createTestCase({ serviceClient, userId: user.id, label: 'pay' })
    await Promise.all([
      uploadDocument({ server, user, caseId: testCase.id, file: makeGoodPdfFile('policy.pdf'), docType: 'policy' }),
      uploadDocument({
        server,
        user,
        caseId: testCase.id,
        file: makeGoodPdfFile('bill.pdf'),
        docType: 'hospital_bill',
      }),
      uploadDocument({
        server,
        user,
        caseId: testCase.id,
        file: makeGoodPdfFile('insurer.pdf'),
        docType: 'insurer_response',
      }),
    ])

    await processQueuedQualityCheckJobs(serviceClient, testCase.id)
    const { data, error } = await serviceClient
      .from('cases')
      .select('status')
      .eq('id', testCase.id)
      .single()

    if (error) {
      throw new Error(`Unable to read case status: ${error.message}`)
    }

    assertCondition(data.status === 'payment_pending', `Expected payment_pending, got ${data.status}`)
  } finally {
    if (testCase) {
      await cleanupCase(serviceClient, testCase.id)
    }
    await cleanupUser(serviceClient, user)
  }
}

async function checkpointWaivedCaseStartsProcessing(
  serviceClient: DbClient,
  server: WebServer
): Promise<void> {
  const user = await createTestUser(serviceClient, 'waived')
  let testCase: TestCase | null = null

  try {
    await insertConsentRows(serviceClient, user.id)
    testCase = await createTestCase({
      serviceClient,
      userId: user.id,
      label: 'waived',
      paymentWaived: true,
    })
    await Promise.all([
      uploadDocument({ server, user, caseId: testCase.id, file: makeGoodPdfFile('policy.pdf'), docType: 'policy' }),
      uploadDocument({
        server,
        user,
        caseId: testCase.id,
        file: makeGoodPdfFile('bill.pdf'),
        docType: 'hospital_bill',
      }),
      uploadDocument({
        server,
        user,
        caseId: testCase.id,
        file: makeGoodPdfFile('insurer.pdf'),
        docType: 'insurer_response',
      }),
    ])

    await processQueuedQualityCheckJobs(serviceClient, testCase.id)
    const [caseResult, jobResult] = await Promise.all([
      serviceClient.from('cases').select('status').eq('id', testCase.id).single(),
      serviceClient
        .from('processing_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('case_id', testCase.id)
        .eq('job_type', 'ocr'),
    ])

    if (caseResult.error) {
      throw new Error(`Unable to read waived case: ${caseResult.error.message}`)
    }

    if (jobResult.error) {
      throw new Error(`Unable to count OCR jobs: ${jobResult.error.message}`)
    }

    assertCondition(caseResult.data.status === 'processing', `Expected processing, got ${caseResult.data.status}`)
    assertCondition((jobResult.count ?? 0) > 0, 'Expected OCR jobs for waived case')
  } finally {
    if (testCase) {
      await cleanupCase(serviceClient, testCase.id)
    }
    await cleanupUser(serviceClient, user)
  }
}

async function checkpointIdempotentJobCreation(
  serviceClient: DbClient,
  server: WebServer
): Promise<void> {
  const user = await createTestUser(serviceClient, 'idempotent')
  let testCase: TestCase | null = null

  try {
    await insertConsentRows(serviceClient, user.id)
    testCase = await createTestCase({ serviceClient, userId: user.id, label: 'idempotent' })
    const documentId = await uploadDocument({
      server,
      user,
      caseId: testCase.id,
      file: makeGoodPdfFile(),
      docType: 'hospital_bill',
    })
    const idempotencyKey = `quality_check:${testCase.id}:${documentId}`

    await Promise.all([
      queueProcessingJob({
        client: serviceClient,
        caseId: testCase.id,
        documentId,
        jobType: 'quality_check',
        idempotencyKey,
      }),
      queueProcessingJob({
        client: serviceClient,
        caseId: testCase.id,
        documentId,
        jobType: 'quality_check',
        idempotencyKey,
      }),
    ])

    const { count, error } = await serviceClient
      .from('processing_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('idempotency_key', idempotencyKey)

    if (error) {
      throw new Error(`Unable to count idempotent jobs: ${error.message}`)
    }

    assertCondition(count === 1, `Expected one idempotent job, got ${String(count ?? 0)}`)
  } finally {
    if (testCase) {
      await cleanupCase(serviceClient, testCase.id)
    }
    await cleanupUser(serviceClient, user)
  }
}

async function runCheckpoint(
  name: CheckpointName,
  results: Partial<Record<CheckpointName, CheckpointResult>>,
  check: () => void | Promise<void>
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
  console.log('\nMODULE 2 CHECKPOINT REPORT')
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

  const passed = CHECKPOINTS.filter((checkpoint) => results[checkpoint]?.pass === true).length
  console.log(`\n${String(passed)}/${String(CHECKPOINTS.length)} checks passed`)
  console.log(passed === CHECKPOINTS.length ? 'PASS - proceed to review' : 'FAIL - fix before Module 3')

  return passed === CHECKPOINTS.length ? 0 : 1
}

async function main(): Promise<void> {
  loadRootEnv()

  const serviceClient = makeServiceClient()
  const server = await startWebServer()
  const results: Partial<Record<CheckpointName, CheckpointResult>> = {}

  try {
    await runCheckpoint('client_blocks_oversized', results, checkpointClientBlocksOversized)
    await runCheckpoint('server_rejects_wrong_mime', results, () =>
      checkpointServerRejectsWrongMime(serviceClient, server)
    )
    await runCheckpoint('storage_path_uses_uuid', results, () =>
      checkpointStoragePathUsesUuid(serviceClient, server)
    )
    await runCheckpoint('quality_check_passes_good_document', results, () =>
      checkpointQualityCheckPassesGoodDocument(serviceClient, server)
    )
    await runCheckpoint('quality_check_fails_low_res_image', results, () =>
      checkpointQualityCheckFailsLowResImage(serviceClient, server)
    )
    await runCheckpoint('case_moves_to_payment_pending', results, () =>
      checkpointCaseMovesToPaymentPending(serviceClient, server)
    )
    await runCheckpoint('waived_case_starts_processing', results, () =>
      checkpointWaivedCaseStartsProcessing(serviceClient, server)
    )
    await runCheckpoint('idempotent_job_creation', results, () =>
      checkpointIdempotentJobCreation(serviceClient, server)
    )
  } finally {
    stopWebServer(server)
  }

  process.exit(printReport(results))
}

main().catch((error: unknown) => {
  console.error('Module 2 checkpoint runner crashed:', error)
  process.exit(1)
})
