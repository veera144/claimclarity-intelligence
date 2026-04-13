/**
 * @file payments.queries.ts
 * @module db/queries/payments
 *
 * Payment and payment-activation query helpers for Module 3.
 *
 * DEPENDENCIES:
 *   - /packages/db/src/types.ts
 *   - /packages/shared/src/constants.ts
 *
 * CALLED BY:
 *   - /apps/web/app/api/payments/create/route.ts
 *   - /apps/web/app/api/payments/verify/route.ts
 *   - /apps/web/app/api/webhooks/razorpay/route.ts
 *   - /apps/web/app/api/admin/payments/[paymentId]/refund/route.ts
 *   - /apps/web/app/app/cases/[caseRef]/pay/page.tsx
 *
 * CALLS:
 *   - Supabase cases, documents, payments, processing_jobs, and users tables
 */

import { REPORT_PRICE_PAISE, SLA_HOURS } from '@claimclarity/shared/constants'

import type { Database, DbClient } from '../types'

type CaseStatus = Database['public']['Tables']['cases']['Row']['status']
type PaymentStatus = Database['public']['Tables']['payments']['Row']['status']

export type PaymentCase = {
  id: string
  case_ref: string
  patient_id: string
  status: CaseStatus
  payment_waived: boolean
}

export type PaymentRow = {
  id: string
  case_id: string
  patient_id: string
  amount_inr: number
  razorpay_order_id: string | null
  razorpay_payment_id: string | null
  status: PaymentStatus
}

export type PatientEmailLookup = {
  email: string
}

export type UserRoleLookup = {
  role: 'patient' | 'reviewer' | 'expert' | 'admin'
}

function deadlineAfterSla(now: Date): string {
  return new Date(now.getTime() + SLA_HOURS * 60 * 60 * 1000).toISOString()
}

/**
 * Reads a case by id for authenticated payment actions.
 *
 * SIDE EFFECTS: reads cases
 * THROWS: Error when Supabase rejects the query
 * IDEMPOTENT: yes, read-only
 *
 * @param input - Case id and database client
 * @returns The case row or null when not found
 */
export async function getPaymentCaseById(input: {
  caseId: string
  client: DbClient
}): Promise<PaymentCase | null> {
  const { data, error } = await input.client
    .from('cases')
    .select('id, case_ref, patient_id, status, payment_waived')
    .eq('id', input.caseId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

/**
 * Reads a case by public case reference for the authenticated payment page.
 *
 * SIDE EFFECTS: reads cases
 * THROWS: Error when Supabase rejects the query
 * IDEMPOTENT: yes, read-only
 *
 * @param input - Case reference and database client
 * @returns The case row or null when not found
 */
export async function getPaymentCaseByRef(input: {
  caseRef: string
  client: DbClient
}): Promise<PaymentCase | null> {
  const { data, error } = await input.client
    .from('cases')
    .select('id, case_ref, patient_id, status, payment_waived')
    .eq('case_ref', input.caseRef)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

/**
 * Reads an active pending or paid payment for a case.
 *
 * SIDE EFFECTS: reads payments
 * THROWS: Error when Supabase rejects the query
 * IDEMPOTENT: yes, read-only
 *
 * @param input - Case id and database client
 * @returns The active payment row or null when none exists
 */
export async function getActivePaymentForCase(input: {
  caseId: string
  client: DbClient
}): Promise<PaymentRow | null> {
  const { data, error } = await input.client
    .from('payments')
    .select('id, case_id, patient_id, amount_inr, razorpay_order_id, razorpay_payment_id, status')
    .eq('case_id', input.caseId)
    .in('status', ['pending', 'paid'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

/**
 * Inserts a pending report-fee payment row after Razorpay order creation.
 *
 * SIDE EFFECTS: writes payments
 * THROWS: Error when Supabase rejects the insert
 * IDEMPOTENT: no, protected by the active-payment partial unique index
 *
 * @param input - Pending payment details and database client
 * @returns The inserted payment row
 */
export async function createPendingReportPayment(input: {
  client: DbClient
  caseId: string
  patientId: string
  razorpayOrderId: string
}): Promise<PaymentRow> {
  const { data, error } = await input.client
    .from('payments')
    .insert({
      case_id: input.caseId,
      patient_id: input.patientId,
      amount_inr: REPORT_PRICE_PAISE,
      payment_type: 'report',
      razorpay_order_id: input.razorpayOrderId,
      status: 'pending',
    })
    .select('id, case_id, patient_id, amount_inr, razorpay_order_id, razorpay_payment_id, status')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

/**
 * Reads a payment row for patient-side signature verification.
 *
 * SIDE EFFECTS: reads payments
 * THROWS: Error when Supabase rejects the query
 * IDEMPOTENT: yes, read-only
 *
 * @param input - Case id, Razorpay order id, and database client
 * @returns The matching payment row or null when not found
 */
export async function getPaymentForVerification(input: {
  client: DbClient
  caseId: string
  razorpayOrderId: string
}): Promise<PaymentRow | null> {
  const { data, error } = await input.client
    .from('payments')
    .select('id, case_id, patient_id, amount_inr, razorpay_order_id, razorpay_payment_id, status')
    .eq('case_id', input.caseId)
    .eq('razorpay_order_id', input.razorpayOrderId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

/**
 * Reads a payment row by Razorpay order id for webhook reconciliation.
 *
 * SIDE EFFECTS: reads payments
 * THROWS: Error when Supabase rejects the query
 * IDEMPOTENT: yes, read-only
 *
 * @param input - Razorpay order id and database client
 * @returns The matching payment row or null
 */
export async function getPaymentByRazorpayOrderId(input: {
  client: DbClient
  razorpayOrderId: string
}): Promise<PaymentRow | null> {
  const { data, error } = await input.client
    .from('payments')
    .select('id, case_id, patient_id, amount_inr, razorpay_order_id, razorpay_payment_id, status')
    .eq('razorpay_order_id', input.razorpayOrderId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

/**
 * Reads a payment row by Razorpay payment id for webhook and refund reconciliation.
 *
 * SIDE EFFECTS: reads payments
 * THROWS: Error when Supabase rejects the query
 * IDEMPOTENT: yes, read-only
 *
 * @param input - Razorpay payment id and database client
 * @returns The matching payment row or null
 */
export async function getPaymentByRazorpayPaymentId(input: {
  client: DbClient
  razorpayPaymentId: string
}): Promise<PaymentRow | null> {
  const { data, error } = await input.client
    .from('payments')
    .select('id, case_id, patient_id, amount_inr, razorpay_order_id, razorpay_payment_id, status')
    .eq('razorpay_payment_id', input.razorpayPaymentId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

/**
 * Reads a payment by id for admin refund processing.
 *
 * SIDE EFFECTS: reads payments
 * THROWS: Error when Supabase rejects the query
 * IDEMPOTENT: yes, read-only
 *
 * @param input - Payment id and database client
 * @returns The payment row or null
 */
export async function getPaymentById(input: {
  client: DbClient
  paymentId: string
}): Promise<PaymentRow | null> {
  const { data, error } = await input.client
    .from('payments')
    .select('id, case_id, patient_id, amount_inr, razorpay_order_id, razorpay_payment_id, status')
    .eq('id', input.paymentId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

/**
 * Marks a payment as paid after verified Razorpay confirmation.
 *
 * SIDE EFFECTS: updates payments
 * THROWS: Error when Supabase rejects the mutation
 * IDEMPOTENT: yes, repeated calls leave the row paid with the same payment id
 *
 * @param input - Payment identifiers, signature, and database client
 * @returns The updated payment row
 */
export async function markPaymentPaid(input: {
  client: DbClient
  paymentId: string
  razorpayPaymentId: string
  razorpaySignature?: string
}): Promise<PaymentRow> {
  const { data, error } = await input.client
    .from('payments')
    .update({
      status: 'paid',
      razorpay_payment_id: input.razorpayPaymentId,
      razorpay_signature: input.razorpaySignature ?? null,
      paid_at: new Date().toISOString(),
    })
    .eq('id', input.paymentId)
    .select('id, case_id, patient_id, amount_inr, razorpay_order_id, razorpay_payment_id, status')
    .single()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

/**
 * Moves a paid case into processing and sets the 24-hour SLA deadline.
 *
 * SIDE EFFECTS: updates cases
 * THROWS: Error when Supabase rejects the mutation
 * IDEMPOTENT: yes, repeated calls keep the case processing with a refreshed SLA deadline
 *
 * @param input - Case id, database client, and optional current time for tests
 * @returns Nothing
 */
export async function activateCaseAfterPayment(input: {
  client: DbClient
  caseId: string
  now?: Date
}): Promise<void> {
  const now = input.now ?? new Date()
  const { error } = await input.client
    .from('cases')
    .update({
      status: 'processing',
      current_step: 'quality_check',
      sla_deadline: deadlineAfterSla(now),
      updated_at: now.toISOString(),
    })
    .eq('id', input.caseId)

  if (error) {
    throw new Error(error.message)
  }
}

/**
 * Marks a payment as failed after Razorpay failure confirmation.
 *
 * SIDE EFFECTS: updates payments
 * THROWS: Error when Supabase rejects the mutation
 * IDEMPOTENT: yes, repeated calls keep the same failure state
 *
 * @param input - Payment id and database client
 * @returns Nothing
 */
export async function markPaymentFailed(input: {
  client: DbClient
  paymentId: string
}): Promise<void> {
  const { error } = await input.client
    .from('payments')
    .update({ status: 'failed' })
    .eq('id', input.paymentId)

  if (error) {
    throw new Error(error.message)
  }
}

/**
 * Records a processed Razorpay refund.
 *
 * SIDE EFFECTS: updates payments
 * THROWS: Error when Supabase rejects the mutation
 * IDEMPOTENT: yes for the same refund id and amount
 *
 * @param input - Refund details and database client
 * @returns Nothing
 */
export async function markPaymentRefunded(input: {
  client: DbClient
  paymentId: string
  status: 'refunded' | 'partial_refund'
  refundAmountInr: number
  refundReason: string
  refundRazorpayId: string
}): Promise<void> {
  const { error } = await input.client
    .from('payments')
    .update({
      status: input.status,
      refund_amount_inr: input.refundAmountInr,
      refund_reason: input.refundReason,
      refund_razorpay_id: input.refundRazorpayId,
      refunded_at: new Date().toISOString(),
    })
    .eq('id', input.paymentId)

  if (error) {
    throw new Error(error.message)
  }
}

/**
 * Closes a case after refund processing.
 *
 * SIDE EFFECTS: updates cases
 * THROWS: Error when Supabase rejects the mutation
 * IDEMPOTENT: yes, repeated calls keep the case closed
 *
 * @param input - Case id and database client
 * @returns Nothing
 */
export async function closeCaseAfterRefund(input: {
  client: DbClient
  caseId: string
}): Promise<void> {
  const { error } = await input.client
    .from('cases')
    .update({
      status: 'closed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.caseId)

  if (error) {
    throw new Error(error.message)
  }
}

/**
 * Reads the email address for a patient user.
 *
 * SIDE EFFECTS: reads users
 * THROWS: Error when Supabase rejects the query
 * IDEMPOTENT: yes, read-only
 *
 * @param input - Patient id and database client
 * @returns The patient email or null when no user row exists
 */
export async function getPatientEmail(input: {
  client: DbClient
  patientId: string
}): Promise<PatientEmailLookup | null> {
  const { data, error } = await input.client
    .from('users')
    .select('email')
    .eq('id', input.patientId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data
}

/**
 * Reads a user's role for payment admin authorization.
 *
 * SIDE EFFECTS: reads users
 * THROWS: Error when Supabase rejects the query
 * IDEMPOTENT: yes, read-only
 *
 * @param input - User id and database client
 * @returns The user role or null when no user row exists
 */
export async function getUserRoleForPaymentAdmin(input: {
  client: DbClient
  userId: string
}): Promise<UserRoleLookup | null> {
  const { data, error } = await input.client
    .from('users')
    .select('role')
    .eq('id', input.userId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  return data
}
