/**
 * @file module3.test.ts
 * @module web/tests
 *
 * Executable Module 3 Razorpay payment integration checkpoints.
 *
 * DEPENDENCIES:
 *   - @supabase/ssr (session cookie generation)
 *   - @supabase/supabase-js (Supabase Auth admin APIs and service-role checks)
 *   - node:http (local Razorpay test API surface for deterministic refund checks)
 *
 * CALLED BY:
 *   - pnpm test:module3
 *
 * CALLS:
 *   - Next.js web API routes over HTTP
 *   - Supabase public schema tables
 *   - Local Razorpay-compatible test server
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { createBrowserClient } from '@supabase/ssr'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@claimclarity/db/types'
import { REPORT_PRICE_PAISE } from '@claimclarity/shared/constants'

type DbClient = SupabaseClient<Database>

type CheckpointName =
  | 'waived_order_blocked'
  | 'existing_payment_conflict'
  | 'tampered_signature_rejected'
  | 'tampered_signature_case_unchanged'
  | 'valid_payment_activates_case'
  | 'valid_payment_sets_sla'
  | 'valid_payment_queues_ocr_jobs'
  | 'webhook_duplicate_ignored'
  | 'invalid_webhook_no_db_changes'
  | 'full_refund_updates_payment'
  | 'full_refund_closes_case'

type CheckpointResult = {
  pass: boolean
  detail?: string
}

type TestUser = {
  id: string
  email: string
  password: string
  cookieHeader: string
}

type TestCase = {
  id: string
  caseRef: string
}

type TestPayment = {
  id: string
  razorpayOrderId: string
  razorpayPaymentId: string
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

type RazorpayMockServer = {
  baseUrl: string
  close: () => Promise<void>
  getOrderRequests: () => number
  getRefundRequests: () => number
}

type CaseStatusRead = {
  status: string
  current_step: string | null
  sla_deadline: string | null
}

type PaymentRead = {
  status: string
  refund_amount_inr: number | null
}

const CHECKPOINTS: readonly CheckpointName[] = [
  'waived_order_blocked',
  'existing_payment_conflict',
  'tampered_signature_rejected',
  'tampered_signature_case_unchanged',
  'valid_payment_activates_case',
  'valid_payment_sets_sla',
  'valid_payment_queues_ocr_jobs',
  'webhook_duplicate_ignored',
  'invalid_webhook_no_db_changes',
  'full_refund_updates_payment',
  'full_refund_closes_case',
]

const MODULE3_TEST_PORT = 3103
const REQUEST_TIMEOUT_MS = 15_000
const SERVER_START_TIMEOUT_MS = 90_000
const SERVER_POLL_MS = 750
const TEST_PASSWORD = 'Module3-test-password-12345'
const SLA_TOLERANCE_MINUTES = 5

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function makeServiceClient(): DbClient {
  return createClient<Database>(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
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

async function readRequestBody(request: IncomingMessage): Promise<string> {
  return await new Promise((resolvePromise, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.on('end', () => {
      resolvePromise(body)
    })
    request.on('error', reject)
  })
}

async function startRazorpayMockServer(): Promise<RazorpayMockServer> {
  let orderRequests = 0
  let refundRequests = 0

  const server = createServer((request, response) => {
    void (async () => {
      const url = request.url ?? ''
      const body = await readRequestBody(request)
      const payload = body ? (JSON.parse(body) as unknown) : {}
      response.setHeader('content-type', 'application/json')

      if (request.method === 'POST' && url === '/v1/orders') {
        orderRequests += 1
        response.statusCode = 200
        response.end(
          JSON.stringify({
            id: `order_module3_${randomUUID().slice(0, 8)}`,
            amount: isRecord(payload) && typeof payload.amount === 'number' ? payload.amount : 0,
            currency: 'INR',
          })
        )
        return
      }

      if (request.method === 'POST' && /^\/v1\/payments\/[^/]+\/refund$/u.test(url)) {
        refundRequests += 1
        response.statusCode = 200
        response.end(
          JSON.stringify({
            id: `rfnd_module3_${randomUUID().slice(0, 8)}`,
            amount: isRecord(payload) && typeof payload.amount === 'number' ? payload.amount : 0,
          })
        )
        return
      }

      response.statusCode = 404
      response.end(JSON.stringify({ error: 'not_found' }))
    })().catch((error: unknown) => {
      response.statusCode = 500
      response.end(JSON.stringify({ error: errorMessage(error) }))
    })
  })

  const baseUrl = await new Promise<string>((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      assertCondition(Boolean(address) && typeof address !== 'string', 'Mock server address missing')
      resolvePromise(`http://127.0.0.1:${String((address as AddressInfo).port)}/v1`)
    })
  })

  return {
    baseUrl,
    close: () =>
      new Promise<void>((resolvePromise, reject) => {
        server.close((error?: Error) => {
          if (error) {
            reject(error)
            return
          }
          resolvePromise()
        })
      }),
    getOrderRequests: () => orderRequests,
    getRefundRequests: () => refundRequests,
  }
}

async function startWebServer(razorpayApiBaseUrl: string): Promise<WebServer> {
  const configuredBaseUrl = process.env.MODULE3_TEST_BASE_URL
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
    [nextCli, 'dev', '--hostname', '127.0.0.1', '--port', String(MODULE3_TEST_PORT)],
    {
      cwd: resolve(rootDir, 'apps', 'web'),
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: '1',
        RAZORPAY_API_BASE_URL: razorpayApiBaseUrl,
        RESEND_API_KEY: '',
        RESEND_FROM_EMAIL: '',
      },
    }
  )

  child.stdout.on('data', (chunk: Buffer) => {
    logs.push(chunk.toString('utf8'))
  })
  child.stderr.on('data', (chunk: Buffer) => {
    logs.push(chunk.toString('utf8'))
  })

  const baseUrl = `http://127.0.0.1:${String(MODULE3_TEST_PORT)}`
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

async function createTestUser(
  serviceClient: DbClient,
  label: string,
  role: 'patient' | 'admin' = 'patient'
): Promise<TestUser> {
  const token = randomUUID()
  const email = `module3-${label}-${token}@claimclarity.internal`
  const password = TEST_PASSWORD
  const createResult = await serviceClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      module: 'module3',
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

    if (role !== 'patient') {
      const { error } = await serviceClient.from('users').update({ role }).eq('id', userId)
      if (error) {
        throw new Error(`Unable to promote test user: ${error.message}`)
      }
    }

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

    const cookieHeader = cookieHeaderFromMap(cookies)
    assertCondition(cookieHeader.length > 0, 'Supabase SSR client did not produce session cookies')

    return {
      id: userId,
      email,
      password,
      cookieHeader,
    }
  } catch (error) {
    await serviceClient.auth.admin.deleteUser(userId)
    throw error
  }
}

async function cleanupUser(serviceClient: DbClient, user: TestUser): Promise<void> {
  await serviceClient.from('consents').delete().eq('user_id', user.id)
  await serviceClient.auth.admin.deleteUser(user.id)
}

async function createTestCase(input: {
  serviceClient: DbClient
  userId: string
  label: string
  paymentWaived?: boolean
}): Promise<TestCase> {
  const caseRef = `CC-M3-${input.label}-${randomUUID().slice(0, 8)}`
  const { data, error } = await input.serviceClient
    .from('cases')
    .insert({
      patient_id: input.userId,
      case_ref: caseRef,
      intake_channel: 'patient_web',
      status: 'payment_pending',
      payment_waived: input.paymentWaived ?? false,
    })
    .select('id, case_ref')
    .single()

  if (error) {
    throw new Error(`Unable to create test case: ${error.message}`)
  }

  return { id: data.id, caseRef: data.case_ref }
}

async function createCaseDocuments(serviceClient: DbClient, caseId: string): Promise<string[]> {
  const rows = [
    {
      case_id: caseId,
      doc_type: 'policy',
      storage_path: `case-documents/${caseId}/policy.pdf`,
      is_required: true,
      quality_status: 'pass',
    },
    {
      case_id: caseId,
      doc_type: 'hospital_bill',
      storage_path: `case-documents/${caseId}/hospital-bill.pdf`,
      is_required: true,
      quality_status: 'pass',
    },
  ]

  const { data, error } = await serviceClient.from('documents').insert(rows).select('id')
  if (error) {
    throw new Error(`Unable to create test documents: ${error.message}`)
  }

  return data.map((document) => document.id)
}

async function cleanupCase(serviceClient: DbClient, caseId: string): Promise<void> {
  await serviceClient.from('processing_jobs').delete().eq('case_id', caseId)
  await serviceClient.from('documents').delete().eq('case_id', caseId)
  await serviceClient.from('outcomes').delete().eq('case_id', caseId)
  await serviceClient.from('outcome_tokens').delete().eq('case_id', caseId)
  await serviceClient.from('follow_up_schedule').delete().eq('case_id', caseId)
  await serviceClient.from('reports').delete().eq('case_id', caseId)
  await serviceClient.from('payments').delete().eq('case_id', caseId)
  await serviceClient.from('cases').delete().eq('id', caseId)
}

async function insertPayment(input: {
  serviceClient: DbClient
  caseId: string
  patientId: string
  label: string
  status?: 'pending' | 'paid'
  razorpayPaymentId?: string
}): Promise<TestPayment> {
  const razorpayOrderId = `order_m3_${input.label}_${randomUUID().slice(0, 8)}`
  const razorpayPaymentId =
    input.razorpayPaymentId ?? `pay_m3_${input.label}_${randomUUID().slice(0, 8)}`
  const { data, error } = await input.serviceClient
    .from('payments')
    .insert({
      case_id: input.caseId,
      patient_id: input.patientId,
      amount_inr: REPORT_PRICE_PAISE,
      payment_type: 'report',
      razorpay_order_id: razorpayOrderId,
      razorpay_payment_id: input.status === 'paid' ? razorpayPaymentId : null,
      status: input.status ?? 'pending',
      paid_at: input.status === 'paid' ? new Date().toISOString() : null,
    })
    .select('id')
    .single()

  if (error) {
    throw new Error(`Unable to create test payment: ${error.message}`)
  }

  return {
    id: data.id,
    razorpayOrderId,
    razorpayPaymentId,
  }
}

async function countPaymentsForCase(serviceClient: DbClient, caseId: string): Promise<number> {
  const { count, error } = await serviceClient
    .from('payments')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', caseId)

  if (error) {
    throw new Error(`Unable to count payments: ${error.message}`)
  }

  return count ?? 0
}

async function countOcrJobs(serviceClient: DbClient, caseId: string): Promise<number> {
  const { count, error } = await serviceClient
    .from('processing_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('case_id', caseId)
    .eq('job_type', 'ocr')

  if (error) {
    throw new Error(`Unable to count OCR jobs: ${error.message}`)
  }

  return count ?? 0
}

async function readCaseStatus(serviceClient: DbClient, caseId: string): Promise<CaseStatusRead> {
  const { data, error } = await serviceClient
    .from('cases')
    .select('status, current_step, sla_deadline')
    .eq('id', caseId)
    .single()

  if (error) {
    throw new Error(`Unable to read case status: ${error.message}`)
  }

  return data
}

async function readPayment(serviceClient: DbClient, paymentId: string): Promise<PaymentRead> {
  const { data, error } = await serviceClient
    .from('payments')
    .select('status, refund_amount_inr')
    .eq('id', paymentId)
    .single()

  if (error) {
    throw new Error(`Unable to read payment: ${error.message}`)
  }

  return data
}

function checkoutSignature(orderId: string, paymentId: string): string {
  return createHmac('sha256', requireEnv('RAZORPAY_KEY_SECRET'))
    .update(`${orderId}|${paymentId}`)
    .digest('hex')
}

function webhookSignature(rawBody: string): string {
  return createHmac('sha256', requireEnv('RAZORPAY_WEBHOOK_SECRET')).update(rawBody).digest('hex')
}

async function postCreatePayment(server: WebServer, user: TestUser, caseId: string): Promise<Response> {
  return fetchWithTimeout(`${server.baseUrl}/api/payments/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: user.cookieHeader,
    },
    body: JSON.stringify({ caseId }),
  })
}

async function postVerifyPayment(input: {
  server: WebServer
  user: TestUser
  caseId: string
  orderId: string
  paymentId: string
  signature: string
}): Promise<Response> {
  return fetchWithTimeout(`${input.server.baseUrl}/api/payments/verify`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: input.user.cookieHeader,
    },
    body: JSON.stringify({
      caseId: input.caseId,
      razorpay_order_id: input.orderId,
      razorpay_payment_id: input.paymentId,
      razorpay_signature: input.signature,
    }),
  })
}

async function postWebhook(server: WebServer, rawBody: string, signature: string): Promise<Response> {
  return fetchWithTimeout(`${server.baseUrl}/api/webhooks/razorpay`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Razorpay-Signature': signature,
    },
    body: rawBody,
  })
}

async function postFullRefund(input: {
  server: WebServer
  admin: TestUser
  paymentId: string
}): Promise<Response> {
  return fetchWithTimeout(`${input.server.baseUrl}/api/admin/payments/${input.paymentId}/refund`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: input.admin.cookieHeader,
    },
    body: JSON.stringify({ reason: 'sla_breach', refundType: 'full' }),
  })
}

async function checkpointWaivedOrderBlocked(input: {
  serviceClient: DbClient
  server: WebServer
  razorpay: RazorpayMockServer
}): Promise<void> {
  const user = await createTestUser(input.serviceClient, 'waived')
  let testCase: TestCase | null = null

  try {
    testCase = await createTestCase({
      serviceClient: input.serviceClient,
      userId: user.id,
      label: 'waived',
      paymentWaived: true,
    })
    const ordersBefore = input.razorpay.getOrderRequests()
    const response = await postCreatePayment(input.server, user, testCase.id)
    const paymentCount = await countPaymentsForCase(input.serviceClient, testCase.id)

    assertCondition(response.status === 400, `Expected 400, got ${String(response.status)}`)
    assertCondition(paymentCount === 0, `Expected 0 payment rows, got ${String(paymentCount)}`)
    assertCondition(
      input.razorpay.getOrderRequests() === ordersBefore,
      'Waived case unexpectedly called Razorpay order creation'
    )
  } finally {
    if (testCase) {
      await cleanupCase(input.serviceClient, testCase.id)
    }
    await cleanupUser(input.serviceClient, user)
  }
}

async function checkpointExistingPaymentConflict(input: {
  serviceClient: DbClient
  server: WebServer
  razorpay: RazorpayMockServer
}): Promise<void> {
  const user = await createTestUser(input.serviceClient, 'existing-payment')
  let testCase: TestCase | null = null

  try {
    testCase = await createTestCase({
      serviceClient: input.serviceClient,
      userId: user.id,
      label: 'exists',
    })
    await insertPayment({
      serviceClient: input.serviceClient,
      caseId: testCase.id,
      patientId: user.id,
      label: 'exists',
      status: 'paid',
    })

    const ordersBefore = input.razorpay.getOrderRequests()
    const response = await postCreatePayment(input.server, user, testCase.id)

    assertCondition(response.status === 409, `Expected 409, got ${String(response.status)}`)
    assertCondition(
      input.razorpay.getOrderRequests() === ordersBefore,
      'Existing payment unexpectedly called Razorpay order creation'
    )
  } finally {
    if (testCase) {
      await cleanupCase(input.serviceClient, testCase.id)
    }
    await cleanupUser(input.serviceClient, user)
  }
}

async function runTamperedSignatureCheckpoints(input: {
  serviceClient: DbClient
  server: WebServer
  results: Partial<Record<CheckpointName, CheckpointResult>>
}): Promise<void> {
  const user = await createTestUser(input.serviceClient, 'tampered')
  let testCase: TestCase | null = null

  try {
    testCase = await createTestCase({
      serviceClient: input.serviceClient,
      userId: user.id,
      label: 'tampered',
    })
    const caseId = testCase.id
    const payment = await insertPayment({
      serviceClient: input.serviceClient,
      caseId,
      patientId: user.id,
      label: 'tampered',
    })

    const response = await postVerifyPayment({
      server: input.server,
      user,
      caseId,
      orderId: payment.razorpayOrderId,
      paymentId: payment.razorpayPaymentId,
      signature: 'tampered-signature',
    })

    await runCheckpoint('tampered_signature_rejected', input.results, () => {
      assertCondition(response.status === 400, `Expected 400, got ${String(response.status)}`)
    })
    await runCheckpoint('tampered_signature_case_unchanged', input.results, async () => {
      const caseStatus = await readCaseStatus(input.serviceClient, caseId)
      assertCondition(
        caseStatus.status === 'payment_pending',
        `Expected payment_pending, got ${caseStatus.status}`
      )
    })
  } finally {
    if (testCase) {
      await cleanupCase(input.serviceClient, testCase.id)
    }
    await cleanupUser(input.serviceClient, user)
  }
}

async function runValidPaymentCheckpoints(input: {
  serviceClient: DbClient
  server: WebServer
  results: Partial<Record<CheckpointName, CheckpointResult>>
}): Promise<void> {
  const user = await createTestUser(input.serviceClient, 'valid-payment')
  let testCase: TestCase | null = null

  try {
    testCase = await createTestCase({
      serviceClient: input.serviceClient,
      userId: user.id,
      label: 'valid',
    })
    const caseId = testCase.id
    const documentIds = await createCaseDocuments(input.serviceClient, caseId)
    const payment = await insertPayment({
      serviceClient: input.serviceClient,
      caseId,
      patientId: user.id,
      label: 'valid',
    })
    const beforeVerify = Date.now()
    const response = await postVerifyPayment({
      server: input.server,
      user,
      caseId,
      orderId: payment.razorpayOrderId,
      paymentId: payment.razorpayPaymentId,
      signature: checkoutSignature(payment.razorpayOrderId, payment.razorpayPaymentId),
    })

    await runCheckpoint('valid_payment_activates_case', input.results, async () => {
      assertCondition(response.ok, `Expected success, got ${String(response.status)}`)
      const caseStatus = await readCaseStatus(input.serviceClient, caseId)
      assertCondition(
        caseStatus.status === 'processing',
        `Expected processing, got ${caseStatus.status}`
      )
      assertCondition(
        caseStatus.current_step === 'quality_check',
        `Expected quality_check, got ${caseStatus.current_step ?? 'null'}`
      )
    })
    await runCheckpoint('valid_payment_sets_sla', input.results, async () => {
      const caseStatus = await readCaseStatus(input.serviceClient, caseId)
      assertCondition(Boolean(caseStatus.sla_deadline), 'SLA deadline was not set')
      const deadline = new Date(caseStatus.sla_deadline ?? '').getTime()
      const expected = beforeVerify + 24 * 60 * 60 * 1000
      const deltaMinutes = Math.abs(deadline - expected) / 60_000
      assertCondition(
        deltaMinutes <= SLA_TOLERANCE_MINUTES,
        `Expected SLA around 24h, delta was ${String(deltaMinutes)} minutes`
      )
    })
    await runCheckpoint('valid_payment_queues_ocr_jobs', input.results, async () => {
      const jobCount = await countOcrJobs(input.serviceClient, caseId)
      assertCondition(
        jobCount === documentIds.length,
        `Expected ${String(documentIds.length)} OCR jobs, got ${String(jobCount)}`
      )
    })
  } finally {
    if (testCase) {
      await cleanupCase(input.serviceClient, testCase.id)
    }
    await cleanupUser(input.serviceClient, user)
  }
}

async function checkpointWebhookDuplicateIgnored(input: {
  serviceClient: DbClient
  server: WebServer
}): Promise<void> {
  const user = await createTestUser(input.serviceClient, 'webhook-dup')
  let testCase: TestCase | null = null

  try {
    testCase = await createTestCase({
      serviceClient: input.serviceClient,
      userId: user.id,
      label: 'whdup',
    })
    await createCaseDocuments(input.serviceClient, testCase.id)
    const payment = await insertPayment({
      serviceClient: input.serviceClient,
      caseId: testCase.id,
      patientId: user.id,
      label: 'whdup',
    })
    const rawBody = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: payment.razorpayPaymentId,
            order_id: payment.razorpayOrderId,
          },
        },
      },
    })
    const signature = webhookSignature(rawBody)

    const firstResponse = await postWebhook(input.server, rawBody, signature)
    const secondResponse = await postWebhook(input.server, rawBody, signature)
    const paymentCount = await countPaymentsForCase(input.serviceClient, testCase.id)
    const jobCount = await countOcrJobs(input.serviceClient, testCase.id)
    const paymentRead = await readPayment(input.serviceClient, payment.id)

    assertCondition(firstResponse.ok, `First webhook failed with ${String(firstResponse.status)}`)
    assertCondition(secondResponse.ok, `Second webhook failed with ${String(secondResponse.status)}`)
    assertCondition(paymentCount === 1, `Expected 1 payment row, got ${String(paymentCount)}`)
    assertCondition(
      jobCount === 2,
      `Expected duplicate webhook to keep 2 OCR jobs, got ${String(jobCount)}`
    )
    assertCondition(paymentRead.status === 'paid', `Expected paid, got ${paymentRead.status}`)
  } finally {
    if (testCase) {
      await cleanupCase(input.serviceClient, testCase.id)
    }
    await cleanupUser(input.serviceClient, user)
  }
}

async function checkpointInvalidWebhookNoDbChanges(input: {
  serviceClient: DbClient
  server: WebServer
}): Promise<void> {
  const user = await createTestUser(input.serviceClient, 'webhook-invalid')
  let testCase: TestCase | null = null

  try {
    testCase = await createTestCase({
      serviceClient: input.serviceClient,
      userId: user.id,
      label: 'whbad',
    })
    await createCaseDocuments(input.serviceClient, testCase.id)
    const payment = await insertPayment({
      serviceClient: input.serviceClient,
      caseId: testCase.id,
      patientId: user.id,
      label: 'whbad',
    })
    const rawBody = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: payment.razorpayPaymentId,
            order_id: payment.razorpayOrderId,
          },
        },
      },
    })
    const response = await postWebhook(input.server, rawBody, 'invalid-signature')
    const caseStatus = await readCaseStatus(input.serviceClient, testCase.id)
    const paymentRead = await readPayment(input.serviceClient, payment.id)
    const jobCount = await countOcrJobs(input.serviceClient, testCase.id)

    assertCondition(response.status === 400, `Expected 400, got ${String(response.status)}`)
    assertCondition(
      caseStatus.status === 'payment_pending',
      `Expected payment_pending, got ${caseStatus.status}`
    )
    assertCondition(paymentRead.status === 'pending', `Expected pending, got ${paymentRead.status}`)
    assertCondition(jobCount === 0, `Expected 0 OCR jobs, got ${String(jobCount)}`)
  } finally {
    if (testCase) {
      await cleanupCase(input.serviceClient, testCase.id)
    }
    await cleanupUser(input.serviceClient, user)
  }
}

async function runFullRefundCheckpoints(input: {
  serviceClient: DbClient
  server: WebServer
  razorpay: RazorpayMockServer
  results: Partial<Record<CheckpointName, CheckpointResult>>
}): Promise<void> {
  const patient = await createTestUser(input.serviceClient, 'refund-patient')
  const admin = await createTestUser(input.serviceClient, 'refund-admin', 'admin')
  let testCase: TestCase | null = null

  try {
    testCase = await createTestCase({
      serviceClient: input.serviceClient,
      userId: patient.id,
      label: 'refund',
    })
    const caseId = testCase.id
    const payment = await insertPayment({
      serviceClient: input.serviceClient,
      caseId,
      patientId: patient.id,
      label: 'refund',
      status: 'paid',
    })
    const refundsBefore = input.razorpay.getRefundRequests()
    const response = await postFullRefund({
      server: input.server,
      admin,
      paymentId: payment.id,
    })

    await runCheckpoint('full_refund_updates_payment', input.results, async () => {
      assertCondition(response.ok, `Expected refund success, got ${String(response.status)}`)
      assertCondition(
        input.razorpay.getRefundRequests() === refundsBefore + 1,
        'Refund endpoint did not call Razorpay refund API'
      )
      const paymentRead = await readPayment(input.serviceClient, payment.id)
      assertCondition(paymentRead.status === 'refunded', `Expected refunded, got ${paymentRead.status}`)
      assertCondition(
        paymentRead.refund_amount_inr === REPORT_PRICE_PAISE,
        `Expected refund ${String(REPORT_PRICE_PAISE)}, got ${String(paymentRead.refund_amount_inr)}`
      )
    })
    await runCheckpoint('full_refund_closes_case', input.results, async () => {
      assertCondition(response.ok, `Expected refund success, got ${String(response.status)}`)
      const caseStatus = await readCaseStatus(input.serviceClient, caseId)
      assertCondition(caseStatus.status === 'closed', `Expected closed, got ${caseStatus.status}`)
    })
  } finally {
    if (testCase) {
      await cleanupCase(input.serviceClient, testCase.id)
    }
    await cleanupUser(input.serviceClient, patient)
    await cleanupUser(input.serviceClient, admin)
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
  console.log('\nMODULE 3 CHECKPOINT REPORT')
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
  console.log(passed === CHECKPOINTS.length ? 'PASS - proceed to review' : 'FAIL - fix before review')

  return passed === CHECKPOINTS.length ? 0 : 1
}

async function main(): Promise<void> {
  loadRootEnv()

  const serviceClient = makeServiceClient()
  const razorpay = await startRazorpayMockServer()
  const server = await startWebServer(razorpay.baseUrl)
  const results: Partial<Record<CheckpointName, CheckpointResult>> = {}

  try {
    await runCheckpoint('waived_order_blocked', results, () =>
      checkpointWaivedOrderBlocked({ serviceClient, server, razorpay })
    )
    await runCheckpoint('existing_payment_conflict', results, () =>
      checkpointExistingPaymentConflict({ serviceClient, server, razorpay })
    )
    await runTamperedSignatureCheckpoints({ serviceClient, server, results })
    await runValidPaymentCheckpoints({ serviceClient, server, results })
    await runCheckpoint('webhook_duplicate_ignored', results, () =>
      checkpointWebhookDuplicateIgnored({ serviceClient, server })
    )
    await runCheckpoint('invalid_webhook_no_db_changes', results, () =>
      checkpointInvalidWebhookNoDbChanges({ serviceClient, server })
    )
    await runFullRefundCheckpoints({ serviceClient, server, razorpay, results })
  } finally {
    stopWebServer(server)
    await razorpay.close()
  }

  process.exit(printReport(results))
}

main().catch((error: unknown) => {
  console.error('Module 3 checkpoint runner crashed:', error)
  process.exit(1)
})
