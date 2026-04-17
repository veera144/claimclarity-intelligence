/**
 * @file approved-report-content.ts
 * @module processor/reports
 *
 * Builds the Module 8 patient-facing report model from reviewer-approved fields only.
 *
 * DEPENDENCIES:
 *   - @claimclarity/db (JSON type)
 *
 * CALLED BY:
 *   - /apps/processor/src/jobs/reportGenerationJob.ts
 *   - /apps/processor/src/reports/report-pdf.ts
 *
 * CALLS:
 *   - none
 */

import type { Json } from '@claimclarity/db'

export type ApprovedReportCase = {
  id: string
  case_ref: string
  status: string
  patient_id: string
  insurer_name: string | null
  claim_amount_inr: number | null
  is_partial_report: boolean | null
  partial_reason: string | null
  ai_draft: Json | null
}

export type ApprovedReportRow = {
  id: string
  case_id: string
  report_version: number | null
  is_partial: boolean | null
  partial_reason: string | null
  pdf_storage_path: string | null
  signed_off_by: string | null
  signed_off_at: string | null
  delivered_at: string | null
  delivery_email_id?: string | null
  correction_of_version: number | null
}

export type ApprovedReportDocument = {
  doc_type: string
  is_required: boolean | null
  quality_status: string | null
  ocr_status: string | null
}

export type ApprovedReportFinding = {
  id: string
  finding_type: string
  bill_line_item: string | null
  bill_amount_inr: number | null
  clause_reference: string | null
  operative_reason: string | null
  plain_language_explanation: string | null
  confidence_label: string
  appeal_strength: 'strong' | 'moderate' | 'weak' | null
  appeal_basis: string | null
  reviewer_confirmed: boolean | null
  reviewer_unassessable: boolean | null
  sort_order: number | null
}

export type ApprovedAppealPoint = {
  point: string
  strength: 'strong' | 'moderate' | 'weak'
  basis: string
}

export type ReportTableRow = {
  billItem: string
  billedAmount: string
  policyClause: string
  confidence: string
  likelyDeduction: string
  reasonSummary: string
}

export type ApprovedReportContent = {
  caseId: string
  caseRef: string
  deliveryDate: Date
  reportVersion: number
  correctionOfVersion: number | null
  isPartial: boolean
  partialReason: string | null
  documentsReviewed: string[]
  missingDocuments: string[]
  likelyCovered: ReportTableRow[]
  likelyDeducted: ReportTableRow[]
  deductionExplanations: string[]
  hospitalQuestions: string[]
  insurerQuestions: string[]
  appealPoints: ApprovedAppealPoint[]
  appealLetterDraft: string
}

const CONFIDENCE_TEXT: Record<string, string> = {
  clause_found_matched: 'Clause found and matched',
  based_on_typical_policy: 'Based on typical policy wording',
  insufficient_information: 'Insufficient information',
}

const DOC_TYPE_LABELS: Record<string, string> = {
  policy: 'Policy document',
  cis: 'Customer information sheet',
  hospital_bill: 'Hospital bill',
  insurer_response: 'Insurer response',
  discharge_summary: 'Discharge summary',
  preauth_letter: 'Pre-authorisation letter',
  investigation_report: 'Investigation report',
  prescription: 'Prescription',
  prior_policy: 'Prior policy',
  payment_receipt: 'Payment receipt',
  prior_correspondence: 'Prior correspondence',
  other: 'Other document',
}

const FORBIDDEN_PATIENT_MARKERS = [
  'raw ocr',
  'textract',
  'extracted_text',
  'extracted_json',
  'provider_metadata',
  'input_tokens',
  'output_tokens',
  'prompt_version',
  'audit_log',
  'stack trace',
  'reviewer-only',
] as const

export const MODULE8_REQUIRED_SECTION_HEADINGS = [
  'SCOPE',
  'LIKELY COVERED',
  'LIKELY DEDUCTED',
  'WHY THESE DEDUCTIONS',
  'WHAT TO ASK THE HOSPITAL',
  'WHAT TO ASK THE INSURER/TPA',
  'MISSING DOCUMENTS',
  'APPEAL POINTS',
  'DRAFT APPEAL LETTER',
  'WHAT THIS REPORT CANNOT TELL YOU',
] as const

export const CANNOT_TELL_YOU_ITEMS = [
  'Whether your specific claim will be approved or rejected',
  "The insurer's internal processing status",
  'Whether the hospital bill is fraudulent',
  'What medical treatment you should have received',
  'The outcome of any appeal you file',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function asAppealPoint(value: unknown): ApprovedAppealPoint | null {
  if (!isRecord(value)) return null
  if (typeof value.point !== 'string' || typeof value.basis !== 'string') return null
  if (value.strength !== 'strong' && value.strength !== 'moderate' && value.strength !== 'weak') {
    return null
  }

  const point = value.point.trim()
  const basis = value.basis.trim()
  if (!point || !basis) return null
  return { point, strength: value.strength, basis }
}

function asAppealPoints(value: unknown): ApprovedAppealPoint[] {
  if (!Array.isArray(value)) return []
  return value.map(asAppealPoint).filter((item): item is ApprovedAppealPoint => item !== null)
}

function labelDocType(docType: string): string {
  return DOC_TYPE_LABELS[docType] ?? docType.replaceAll('_', ' ')
}

function formatPaise(amount: number | null): string {
  if (typeof amount !== 'number') return 'Not stated'
  return `INR ${(amount / 100).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  })}`
}

function confidenceText(label: string): string {
  return CONFIDENCE_TEXT[label] ?? label.replaceAll('_', ' ')
}

function textOrFallback(value: string | null, fallback: string): string {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : fallback
}

function findingLabel(finding: ApprovedReportFinding): string {
  return textOrFallback(finding.bill_line_item, 'Finding')
}

function rankAppealStrength(value: 'strong' | 'moderate' | 'weak'): number {
  if (value === 'strong') return 1
  if (value === 'moderate') return 2
  return 3
}

function stableFindings(findings: ApprovedReportFinding[]): ApprovedReportFinding[] {
  return findings
    .slice()
    .sort((left, right) => (left.sort_order ?? 9999) - (right.sort_order ?? 9999))
}

function assertNoForbiddenMarkers(content: ApprovedReportContent): void {
  const haystack = JSON.stringify(content).toLowerCase()
  const marker = FORBIDDEN_PATIENT_MARKERS.find((value) => haystack.includes(value))
  if (marker) {
    throw new Error(`Patient report content contains forbidden marker: ${marker}`)
  }
}

/**
 * Builds a strict patient-facing report model from post-sign-off database rows.
 *
 * SIDE EFFECTS: none
 * THROWS: Error when Module 7 sign-off gates are not represented in the rows
 * IDEMPOTENT: yes, pure mapping
 *
 * @param input - Approved case, report, findings, and document metadata
 * @returns Patient-facing report content safe for PDF rendering
 */
export function buildApprovedReportContent(input: {
  caseRow: ApprovedReportCase
  report: ApprovedReportRow
  findings: ApprovedReportFinding[]
  documents: ApprovedReportDocument[]
  deliveryDate: Date
  nextReportVersion?: number
}): ApprovedReportContent {
  if (input.caseRow.status !== 'approved' && input.caseRow.status !== 'generating_report') {
    throw new Error('Report generation requires an approved case.')
  }

  if (!input.report.signed_off_at || !input.report.signed_off_by) {
    throw new Error('Report generation requires reviewer sign-off.')
  }

  if (!isRecord(input.caseRow.ai_draft)) {
    throw new Error('Report generation requires reviewer-approved draft sections.')
  }

  const confirmedFindings = stableFindings(
    input.findings.filter((finding) => finding.reviewer_confirmed === true)
  )
  const unreviewedFinding = input.findings.find(
    (finding) => finding.reviewer_confirmed !== true && finding.reviewer_unassessable !== true
  )
  if (unreviewedFinding) {
    throw new Error('Report generation found an unreviewed finding.')
  }

  const draft = input.caseRow.ai_draft
  const hospitalQuestions = asStringArray(draft.hospital_questions)
  const insurerQuestions = asStringArray(draft.insurer_questions)
  const appealLetterDraft =
    typeof draft.appeal_letter_draft === 'string' ? draft.appeal_letter_draft.trim() : ''

  if (!appealLetterDraft) {
    throw new Error('Report generation requires an approved draft appeal letter.')
  }

  const coveredFindings = confirmedFindings.filter((finding) => finding.finding_type === 'covered')
  const deductedFindings = confirmedFindings.filter((finding) => finding.finding_type === 'deducted')
  const missingDocuments = confirmedFindings
    .filter((finding) => finding.finding_type === 'missing_document')
    .map((finding) => findingLabel(finding))

  const fallbackAppealPoints = confirmedFindings
    .filter((finding) => finding.finding_type === 'appeal_point' || finding.appeal_basis)
    .map((finding) => ({
      point: textOrFallback(finding.appeal_basis, findingLabel(finding)),
      strength: finding.appeal_strength ?? 'weak',
      basis: textOrFallback(finding.clause_reference, 'Reviewer-approved finding'),
    }))

  const content: ApprovedReportContent = {
    caseId: input.caseRow.id,
    caseRef: input.caseRow.case_ref,
    deliveryDate: input.deliveryDate,
    reportVersion: input.nextReportVersion ?? input.report.report_version ?? 1,
    correctionOfVersion: input.report.delivered_at ? input.report.report_version ?? 1 : null,
    isPartial: input.caseRow.is_partial_report === true || input.report.is_partial === true,
    partialReason: input.caseRow.partial_reason ?? input.report.partial_reason ?? null,
    documentsReviewed: input.documents
      .filter(
        (document) => document.quality_status === 'pass' || document.ocr_status === 'completed'
      )
      .map((document) => labelDocType(document.doc_type)),
    missingDocuments,
    likelyCovered: coveredFindings.map((finding) => ({
      billItem: findingLabel(finding),
      billedAmount: formatPaise(finding.bill_amount_inr),
      policyClause: textOrFallback(finding.clause_reference, 'Reviewer-approved finding'),
      confidence: confidenceText(finding.confidence_label),
      likelyDeduction: '',
      reasonSummary: '',
    })),
    likelyDeducted: deductedFindings.map((finding) => ({
      billItem: findingLabel(finding),
      billedAmount: formatPaise(finding.bill_amount_inr),
      policyClause: '',
      confidence: confidenceText(finding.confidence_label),
      likelyDeduction: textOrFallback(finding.clause_reference, 'Possible deduction'),
      reasonSummary: textOrFallback(
        finding.operative_reason,
        finding.plain_language_explanation ?? 'Reviewer-approved reason'
      ),
    })),
    deductionExplanations: deductedFindings.map((finding) =>
      textOrFallback(finding.plain_language_explanation, 'Reviewer-approved deduction note')
    ),
    hospitalQuestions:
      hospitalQuestions.length > 0
        ? hospitalQuestions
        : ['No specific hospital questions were identified.'],
    insurerQuestions:
      insurerQuestions.length > 0
        ? insurerQuestions
        : ['No specific insurer or TPA questions were identified.'],
    appealPoints: (asAppealPoints(draft.appeal_points).length > 0
      ? asAppealPoints(draft.appeal_points)
      : fallbackAppealPoints
    )
      .slice()
      .sort((left, right) => rankAppealStrength(left.strength) - rankAppealStrength(right.strength)),
    appealLetterDraft,
  }

  assertNoForbiddenMarkers(content)
  return content
}
