/**
 * @file engine.ts
 * @module processor/rules-engine
 *
 * Deterministic Module 5 rules engine for KB pattern matching and finding creation.
 *
 * DEPENDENCIES:
 *   - @claimclarity/db
 *   - @claimclarity/shared/constants
 *   - /apps/processor/src/rulesEngine/benchmark.ts
 *
 * CALLED BY:
 *   - /apps/processor/tests/module5.test.ts
 *   - future processor job runner
 *
 * CALLS:
 *   - Supabase cases, documents, findings, and processing_jobs tables
 */

import {
  createServiceClient,
  queueProcessingJob,
  type DbClient,
  type Json,
} from '@claimclarity/db'
import { KEYWORD_SCORE_THRESHOLD, SIMILARITY_THRESHOLD } from '@claimclarity/shared/constants'

import { runBenchmark, type BenchmarkReport } from './benchmark'

export type RulesBillLine = {
  line_item: string
  total_inr: number
  bill_category: string
  page_number: number | null
}

export type RulesPolicyChunk = {
  heading: string
  clause_category: string
  text: string
  page_number: number | null
}

export type RulesInsurerDeduction = {
  item_description: string
  deducted_amount_inr: number | null
  stated_reason: string
}

export type RulesPattern = {
  id: string
  insurer_name: string | null
  clause_category: string
  clause_keywords: string[]
  typical_clause_text: string | null
  common_deduction_trigger: string
  operative_reason_template: string
  appeal_point_template: string
  is_active: boolean | null
  verified_by_expert: boolean | null
}

export type RulesFinding = {
  finding_type: 'covered' | 'deducted' | 'missing_document'
  bill_line_item: string | null
  bill_amount_inr: number | null
  bill_category: string | null
  clause_reference: string | null
  clause_text: string | null
  kb_pattern_id: string | null
  operative_reason: string
  confidence_label: 'clause_found_matched' | 'based_on_typical_policy' | 'insufficient_information'
  appeal_strength: 'strong' | 'moderate' | 'weak' | null
  appeal_basis: string | null
  ai_generated: false
  reviewer_confirmed: false
  reviewer_edited: false
  expert_confirmed: false
  sort_order: number
}

type CaseForRules = {
  id: string
  insurer_name: string | null
}

type DocumentForRules = {
  id: string
  doc_type: string
  extracted_json: Json | null
}

type DeductionMatch = {
  deduction: RulesInsurerDeduction
  similarity: number
}

type PatternScore = {
  pattern: RulesPattern
  score: number
}

type PolicyMatch = {
  chunk: RulesPolicyChunk
  keyword: string
}

export type RulesEvaluationInput = {
  caseId: string
  insurerName: string | null
  billLines: RulesBillLine[]
  policyChunks: RulesPolicyChunk[]
  insurerDeductions: RulesInsurerDeduction[]
  patterns: RulesPattern[]
  presentDocTypes: string[]
}

export type RulesEvaluationOutput = {
  findings: RulesFinding[]
  confidenceOverall: 'high' | 'low' | 'mixed'
}

const PATTERN_CACHE_TTL_MS = 60 * 60 * 1000
const CLAUSE_TEXT_LIMIT = 300

let cachedPatterns: { loadedAt: number; patterns: RulesPattern[] } | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function normalizeText(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ')
}

function levenshteinDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  const current = Array.from({ length: right.length + 1 }, () => 0)

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1
      current[rightIndex] = Math.min(
        (previous[rightIndex] ?? 0) + 1,
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + substitutionCost
      )
    }
    previous.splice(0, previous.length, ...current)
  }

  return previous[right.length] ?? 0
}

export function normalizedSimilarity(left: string, right: string): number {
  const normalizedLeft = normalizeText(left)
  const normalizedRight = normalizeText(right)
  const maxLength = Math.max(normalizedLeft.length, normalizedRight.length)
  if (maxLength === 0) return 1
  return 1 - levenshteinDistance(normalizedLeft, normalizedRight) / maxLength
}

function containsKeyword(haystack: string, keyword: string): boolean {
  const normalizedKeyword = normalizeText(keyword)
  return normalizedKeyword.length > 0 && normalizeText(haystack).includes(normalizedKeyword)
}

function matchDeduction(
  billLine: RulesBillLine,
  deductions: RulesInsurerDeduction[]
): DeductionMatch | null {
  let best: DeductionMatch | null = null

  for (const deduction of deductions) {
    const similarity = normalizedSimilarity(billLine.line_item, deduction.item_description)
    if (!best || similarity > best.similarity) best = { deduction, similarity }
  }

  return best && best.similarity >= SIMILARITY_THRESHOLD ? best : null
}

function scorePattern(input: {
  pattern: RulesPattern
  haystack: string
  insurerName: string | null
}): PatternScore {
  let score = input.pattern.clause_keywords.filter((keyword) =>
    containsKeyword(input.haystack, keyword)
  ).length

  if (
    input.pattern.insurer_name &&
    input.insurerName &&
    normalizeText(input.pattern.insurer_name) === normalizeText(input.insurerName)
  ) {
    score += 2
  }

  return { pattern: input.pattern, score }
}

function choosePattern(input: {
  billLine: RulesBillLine
  statedReason: string | null
  insurerName: string | null
  patterns: RulesPattern[]
}): PatternScore | null {
  const haystack = `${input.billLine.line_item} ${input.statedReason ?? ''}`
  const best = input.patterns
    .filter((pattern) => pattern.is_active !== false)
    .map((pattern) => scorePattern({ pattern, haystack, insurerName: input.insurerName }))
    .sort((left, right) => right.score - left.score)[0]

  return best && best.score >= KEYWORD_SCORE_THRESHOLD ? best : null
}

function findPolicyMatch(pattern: RulesPattern, chunks: RulesPolicyChunk[]): PolicyMatch | null {
  for (const chunk of chunks) {
    const chunkText = `${chunk.heading} ${chunk.text}`
    const keyword = pattern.clause_keywords.find((candidate) => containsKeyword(chunkText, candidate))
    if (keyword) return { chunk, keyword }
  }

  return null
}

function formatPaiseForTemplate(value: number): string {
  return (value / 100).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  })
}

function renderTemplate(template: string, billLine: RulesBillLine): string {
  return template
    .replace(/\{limit\}/gu, 'policy limit')
    .replace(/\{charged\}/gu, formatPaiseForTemplate(billLine.total_inr))
}

function sortPriority(category: string | null): number {
  const priorities: Record<string, number> = {
    room_charges: 10,
    icu_charges: 20,
    doctor_fees: 30,
    ot_charges: 40,
    pharmacy: 50,
    consumables: 60,
    investigations: 70,
    miscellaneous: 100,
  }

  return category ? priorities[category] ?? 90 : 900
}

function createLineFinding(input: {
  billLine: RulesBillLine
  deductionMatch: DeductionMatch | null
  patternScore: PatternScore | null
  policyMatch: PolicyMatch | null
  sortOrder: number
}): RulesFinding {
  const pattern = input.patternScore?.pattern ?? null
  const isVerifiedClauseMatch =
    pattern !== null && Boolean(pattern.verified_by_expert) && input.policyMatch !== null
  const confidence = pattern
    ? isVerifiedClauseMatch
      ? 'clause_found_matched'
      : 'based_on_typical_policy'
    : 'insufficient_information'

  return {
    finding_type: input.deductionMatch ? 'deducted' : 'covered',
    bill_line_item: input.billLine.line_item,
    bill_amount_inr: input.billLine.total_inr,
    bill_category: input.billLine.bill_category,
    clause_reference:
      confidence === 'clause_found_matched' && input.policyMatch
        ? `${input.policyMatch.chunk.heading} p.${String(input.policyMatch.chunk.page_number ?? 1)}`
        : null,
    clause_text:
      confidence === 'clause_found_matched' && input.policyMatch
        ? input.policyMatch.chunk.text.slice(0, CLAUSE_TEXT_LIMIT)
        : pattern?.typical_clause_text ?? null,
    kb_pattern_id: pattern?.id ?? null,
    operative_reason: pattern
      ? renderTemplate(pattern.operative_reason_template, input.billLine)
      : 'No active KB pattern matched this bill item strongly enough for a coverage conclusion.',
    confidence_label: confidence,
    appeal_strength:
      confidence === 'clause_found_matched'
        ? 'strong'
        : confidence === 'based_on_typical_policy'
          ? 'moderate'
          : 'weak',
    appeal_basis: pattern?.appeal_point_template ?? null,
    ai_generated: false,
    reviewer_confirmed: false,
    reviewer_edited: false,
    expert_confirmed: false,
    sort_order: input.sortOrder,
  }
}

function createMissingDocumentFinding(input: {
  missingDocTypes: string[]
  sortOrder: number
}): RulesFinding {
  const missingList = input.missingDocTypes.join(', ')
  return {
    finding_type: 'missing_document',
    bill_line_item: missingList,
    bill_amount_inr: null,
    bill_category: 'documents',
    clause_reference: null,
    clause_text: null,
    kb_pattern_id: null,
    operative_reason: `Additional document review is needed because ${missingList} is missing.`,
    confidence_label: 'insufficient_information',
    appeal_strength: 'weak',
    appeal_basis: 'Reviewer should request the missing document before final patient delivery.',
    ai_generated: false,
    reviewer_confirmed: false,
    reviewer_edited: false,
    expert_confirmed: false,
    sort_order: input.sortOrder,
  }
}

function summarizeConfidence(findings: RulesFinding[]): 'high' | 'low' | 'mixed' {
  const lineFindings = findings.filter((finding) => finding.finding_type !== 'missing_document')
  if (findings.some((finding) => finding.confidence_label === 'insufficient_information')) {
    return 'low'
  }

  if (
    lineFindings.length > 0 &&
    lineFindings.every((finding) => finding.confidence_label === 'clause_found_matched')
  ) {
    return 'high'
  }

  return 'mixed'
}

function asBillLine(value: unknown): RulesBillLine | null {
  if (!isRecord(value)) return null
  if (
    typeof value.line_item !== 'string' ||
    typeof value.total_inr !== 'number' ||
    typeof value.bill_category !== 'string'
  ) {
    return null
  }

  return {
    line_item: value.line_item,
    total_inr: value.total_inr,
    bill_category: value.bill_category,
    page_number: typeof value.page_number === 'number' ? value.page_number : null,
  }
}

function asPolicyChunk(value: unknown): RulesPolicyChunk | null {
  if (!isRecord(value)) return null
  if (
    typeof value.heading !== 'string' ||
    typeof value.clause_category !== 'string' ||
    typeof value.text !== 'string'
  ) {
    return null
  }

  return {
    heading: value.heading,
    clause_category: value.clause_category,
    text: value.text,
    page_number: typeof value.page_number === 'number' ? value.page_number : null,
  }
}

function asDeduction(value: unknown): RulesInsurerDeduction | null {
  if (!isRecord(value)) return null
  if (typeof value.item_description !== 'string' || typeof value.stated_reason !== 'string') {
    return null
  }

  return {
    item_description: value.item_description,
    deducted_amount_inr: typeof value.deducted_amount_inr === 'number' ? value.deducted_amount_inr : null,
    stated_reason: value.stated_reason,
  }
}

function extractionData(document: DocumentForRules): Record<string, unknown> | null {
  if (!isRecord(document.extracted_json)) return null
  const data = document.extracted_json.data
  return document.extracted_json.schema_version === 'module4.v1' && isRecord(data) ? data : null
}

function collectBillLines(documents: DocumentForRules[]): RulesBillLine[] {
  return documents
    .filter((document) => document.doc_type === 'hospital_bill')
    .flatMap((document) => {
      const lines = extractionData(document)?.bill_lines
      return Array.isArray(lines)
        ? lines.map(asBillLine).filter((line): line is RulesBillLine => line !== null)
        : []
    })
}

function collectPolicyChunks(documents: DocumentForRules[]): RulesPolicyChunk[] {
  return documents
    .filter((document) => document.doc_type === 'policy' || document.doc_type === 'cis')
    .flatMap((document) => {
      const chunks = extractionData(document)?.policy_chunks
      return Array.isArray(chunks)
        ? chunks.map(asPolicyChunk).filter((chunk): chunk is RulesPolicyChunk => chunk !== null)
        : []
    })
}

function collectDeductions(documents: DocumentForRules[]): RulesInsurerDeduction[] {
  return documents
    .filter((document) => document.doc_type === 'insurer_response')
    .flatMap((document) => {
      const insurerLetter = extractionData(document)?.insurer_letter
      if (!isRecord(insurerLetter) || !Array.isArray(insurerLetter.deductions)) return []
      return insurerLetter.deductions
        .map(asDeduction)
        .filter((deduction): deduction is RulesInsurerDeduction => deduction !== null)
    })
}

function toFindingInsert(caseId: string, finding: RulesFinding): Record<string, unknown> {
  return { case_id: caseId, ...finding }
}

function toPattern(value: unknown): RulesPattern | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== 'string' ||
    typeof value.clause_category !== 'string' ||
    !isStringArray(value.clause_keywords) ||
    typeof value.common_deduction_trigger !== 'string' ||
    typeof value.operative_reason_template !== 'string' ||
    typeof value.appeal_point_template !== 'string'
  ) {
    return null
  }

  return {
    id: value.id,
    insurer_name: typeof value.insurer_name === 'string' ? value.insurer_name : null,
    clause_category: value.clause_category,
    clause_keywords: value.clause_keywords,
    typical_clause_text: typeof value.typical_clause_text === 'string' ? value.typical_clause_text : null,
    common_deduction_trigger: value.common_deduction_trigger,
    operative_reason_template: value.operative_reason_template,
    appeal_point_template: value.appeal_point_template,
    is_active: typeof value.is_active === 'boolean' ? value.is_active : null,
    verified_by_expert:
      typeof value.verified_by_expert === 'boolean' ? value.verified_by_expert : null,
  }
}

async function loadActivePatterns(client: DbClient): Promise<RulesPattern[]> {
  const now = Date.now()
  if (cachedPatterns && now - cachedPatterns.loadedAt < PATTERN_CACHE_TTL_MS) {
    return cachedPatterns.patterns
  }

  const { data, error } = await client
    .from('kb_clause_patterns')
    .select(
      'id, insurer_name, clause_category, clause_keywords, typical_clause_text, common_deduction_trigger, operative_reason_template, appeal_point_template, is_active, verified_by_expert'
    )
    .eq('is_active', true)

  if (error) throw new Error(error.message)

  const patterns = data.map(toPattern).filter((pattern): pattern is RulesPattern => pattern !== null)
  cachedPatterns = { loadedAt: now, patterns }
  return patterns
}

async function loadCase(client: DbClient, caseId: string): Promise<CaseForRules> {
  const { data, error } = await client
    .from('cases')
    .select('id, insurer_name')
    .eq('id', caseId)
    .single()

  if (error) throw new Error(error.message)
  return data
}

async function loadDocuments(client: DbClient, caseId: string): Promise<DocumentForRules[]> {
  const { data, error } = await client
    .from('documents')
    .select('id, doc_type, extracted_json')
    .eq('case_id', caseId)
    .in('doc_type', ['hospital_bill', 'policy', 'cis', 'insurer_response', 'discharge_summary', 'preauth_letter'])

  if (error) throw new Error(error.message)
  return data
}

async function replaceGeneratedFindings(input: {
  client: DbClient
  caseId: string
  findings: RulesFinding[]
}): Promise<void> {
  const { error: deleteError } = await input.client
    .from('findings')
    .delete()
    .eq('case_id', input.caseId)
    .eq('reviewer_confirmed', false)
    .eq('expert_confirmed', false)

  if (deleteError) throw new Error(deleteError.message)
  if (input.findings.length === 0) return

  const { error } = await input.client
    .from('findings')
    .insert(input.findings.map((finding) => toFindingInsert(input.caseId, finding)))

  if (error) throw new Error(error.message)
}

/**
 * Clears the one-hour in-memory KB cache.
 *
 * SIDE EFFECTS: clears module-local cache
 * THROWS: none
 * IDEMPOTENT: yes
 *
 * @returns Nothing
 */
export function clearRulesPatternCache(): void {
  cachedPatterns = null
}

/**
 * Evaluates rules deterministically without reading or writing the database.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, pure transformation
 *
 * @param input - Structured Module 4 extraction data and active KB patterns
 * @returns Findings and overall confidence
 */
export function evaluateRules(input: RulesEvaluationInput): RulesEvaluationOutput {
  const findings = input.billLines.map((billLine, index) => {
    const deductionMatch = matchDeduction(billLine, input.insurerDeductions)
    const patternScore = choosePattern({
      billLine,
      statedReason: deductionMatch?.deduction.stated_reason ?? null,
      insurerName: input.insurerName,
      patterns: input.patterns,
    })
    const policyMatch = patternScore ? findPolicyMatch(patternScore.pattern, input.policyChunks) : null

    return createLineFinding({
      billLine,
      deductionMatch,
      patternScore,
      policyMatch,
      sortOrder: sortPriority(billLine.bill_category) + index,
    })
  })

  if (findings.some((finding) => finding.confidence_label === 'insufficient_information')) {
    const missingHelpfulDocs = ['discharge_summary', 'preauth_letter'].filter(
      (docType) => !input.presentDocTypes.includes(docType)
    )
    if (missingHelpfulDocs.length > 0) {
      findings.push(
        createMissingDocumentFinding({
          missingDocTypes: missingHelpfulDocs,
          sortOrder: 9000,
        })
      )
    }
  }

  return { findings, confidenceOverall: summarizeConfidence(findings) }
}

/**
 * Runs Module 5 rules for one case and queues AI draft generation only after benchmark gate pass.
 *
 * SIDE EFFECTS: replaces unreviewed findings, updates case confidence/current_step, queues ai_draft_generation
 * THROWS: Error when required extraction data is missing, benchmark gate fails, or Supabase rejects writes
 * IDEMPOTENT: yes, unreviewed generated findings and AI job idempotency key prevent duplicates
 *
 * @param caseId - Case id currently at current_step=rules_engine
 * @param input - Optional service client and benchmark gate override for tests
 * @returns Benchmark report and number of generated findings
 */
export async function runRulesEngine(
  caseId: string,
  input: {
    client?: DbClient
    benchmarkGate?: (patterns: RulesPattern[]) => BenchmarkReport
  } = {}
): Promise<{ findingsCreated: number; benchmark: BenchmarkReport }> {
  const client = input.client ?? createServiceClient()
  const [caseRow, documents, patterns] = await Promise.all([
    loadCase(client, caseId),
    loadDocuments(client, caseId),
    loadActivePatterns(client),
  ])
  const billLines = collectBillLines(documents)
  if (billLines.length === 0) {
    throw new Error('Rules engine requires at least one structured hospital bill line.')
  }

  const benchmark = input.benchmarkGate ? input.benchmarkGate(patterns) : runBenchmark({ patterns })
  if (benchmark.matchRate < 0.7) {
    throw new Error(`Module 5 benchmark gate failed: ${benchmark.matchRate.toFixed(2)} < 0.70`)
  }

  const evaluation = evaluateRules({
    caseId,
    insurerName: caseRow.insurer_name,
    billLines,
    policyChunks: collectPolicyChunks(documents),
    insurerDeductions: collectDeductions(documents),
    patterns,
    presentDocTypes: documents.map((document) => document.doc_type),
  })

  await replaceGeneratedFindings({ client, caseId, findings: evaluation.findings })

  const { error: caseUpdateError } = await client
    .from('cases')
    .update({
      confidence_overall: evaluation.confidenceOverall,
      status: 'processing',
      current_step: 'ai_draft',
      updated_at: new Date().toISOString(),
    })
    .eq('id', caseId)

  if (caseUpdateError) throw new Error(caseUpdateError.message)

  await queueProcessingJob({
    client,
    caseId,
    jobType: 'ai_draft_generation',
    idempotencyKey: `ai_draft:${caseId}`,
    payload: { source: 'module5_rules_engine' },
  })

  return { findingsCreated: evaluation.findings.length, benchmark }
}

/**
 * Processes queued rules_engine jobs.
 *
 * SIDE EFFECTS: updates processing_jobs and runs runRulesEngine for each queued job
 * THROWS: none for per-job failures; failed jobs are marked failed
 * IDEMPOTENT: yes, runRulesEngine is idempotent per case
 *
 * @param client - Optional service-role client
 * @param caseId - Optional case id filter for tests
 * @returns Number of jobs completed
 */
export async function processQueuedRulesEngineJobs(
  client: DbClient = createServiceClient(),
  caseId?: string
): Promise<number> {
  let query = client
    .from('processing_jobs')
    .select('id, case_id')
    .eq('job_type', 'rules_engine')
    .eq('status', 'queued')
    .order('queued_at', { ascending: true })

  if (caseId) query = query.eq('case_id', caseId)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  let completed = 0
  for (const job of data) {
    await client
      .from('processing_jobs')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', job.id)

    try {
      const result = await runRulesEngine(job.case_id, { client })
      await client
        .from('processing_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          result: {
            findings_created: result.findingsCreated,
            benchmark_match_rate: result.benchmark.matchRate,
          },
        })
        .eq('id', job.id)
      completed += 1
    } catch (caughtError) {
      await client
        .from('processing_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_message: caughtError instanceof Error ? caughtError.message : String(caughtError),
        })
        .eq('id', job.id)
    }
  }

  return completed
}
