/**
 * @file benchmark.ts
 * @module processor/rules-engine
 *
 * Gold-standard benchmark runner for the deterministic Module 5 rules engine.
 *
 * DEPENDENCIES:
 *   - node:fs
 *   - /apps/processor/src/knowledgeBase/goldStandard.json
 *   - /apps/processor/src/knowledgeBase/seed.ts
 *   - /apps/processor/src/rulesEngine/engine.ts
 *
 * CALLED BY:
 *   - /apps/processor/src/rulesEngine/engine.ts
 *   - /apps/processor/tests/module5.test.ts
 *
 * CALLS:
 *   - local JSON fixture only
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { REQUIRED_KB_PATTERNS } from '../knowledgeBase/seed'

import { evaluateRules, type RulesPattern } from './engine'

type GoldFinding = {
  bill_line_item: string
  expected_finding_type: string
  expected_confidence: string
  expected_clause_category: string
}

type GoldCase = {
  caseId: string
  documents: {
    bill: Array<{
      line_item: string
      total_inr: number
      bill_category: string
      page_number: number
    }>
    policyChunks: Array<{
      heading: string
      clause_category: string
      text: string
      page_number: number
    }>
    insurerDeductions: Array<{
      item_description: string
      deducted_amount_inr: number | null
      stated_reason: string
    }>
  }
  expectedFindings: GoldFinding[]
}

export type BenchmarkReport = {
  matchRate: number
  totalExpected: number
  matched: number
  confidenceDistribution: Record<string, number>
  unmatchedItems: Record<string, string[]>
}

function goldPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'knowledgeBase', 'goldStandard.json')
}

function loadGoldCases(): GoldCase[] {
  return JSON.parse(readFileSync(goldPath(), 'utf8')) as GoldCase[]
}

function defaultPatterns(): RulesPattern[] {
  return REQUIRED_KB_PATTERNS.map((pattern) => ({
    id: `seed:${pattern.clause_category}`,
    insurer_name: pattern.insurer_name,
    clause_category: pattern.clause_category,
    clause_keywords: [...pattern.clause_keywords],
    typical_clause_text: pattern.typical_clause_text,
    common_deduction_trigger: pattern.common_deduction_trigger,
    operative_reason_template: pattern.operative_reason_template,
    appeal_point_template: pattern.appeal_point_template,
    is_active: true,
    verified_by_expert: false,
  }))
}

function categoryForFinding(patterns: RulesPattern[], patternId: string | null): string {
  if (!patternId) return 'none'
  return patterns.find((pattern) => pattern.id === patternId)?.clause_category ?? 'none'
}

/**
 * Runs the gold-standard Module 5 benchmark without touching the database.
 *
 * SIDE EFFECTS: reads goldStandard.json
 * THROWS: Error when fixture JSON is unreadable
 * IDEMPOTENT: yes
 *
 * @param input - Optional active patterns supplied by the DB runner
 * @returns Match-rate report used as the Module 5 hard gate
 */
export function runBenchmark(input: { patterns?: RulesPattern[] } = {}): BenchmarkReport {
  const patterns = input.patterns ?? defaultPatterns()
  const confidenceDistribution: Record<string, number> = {}
  const unmatchedItems: Record<string, string[]> = {}
  let totalExpected = 0
  let matched = 0

  for (const goldCase of loadGoldCases()) {
    const output = evaluateRules({
      caseId: goldCase.caseId,
      insurerName: null,
      billLines: goldCase.documents.bill,
      policyChunks: goldCase.documents.policyChunks,
      insurerDeductions: goldCase.documents.insurerDeductions,
      patterns,
      presentDocTypes: [
        'hospital_bill',
        'policy',
        'insurer_response',
        'discharge_summary',
        'preauth_letter',
      ],
    })

    for (const expected of goldCase.expectedFindings) {
      totalExpected += 1
      const actual = output.findings.find(
        (finding) => finding.bill_line_item === expected.bill_line_item
      )
      if (!actual) {
        unmatchedItems[goldCase.caseId] = [
          ...(unmatchedItems[goldCase.caseId] ?? []),
          expected.bill_line_item,
        ]
        continue
      }

      confidenceDistribution[actual.confidence_label] =
        (confidenceDistribution[actual.confidence_label] ?? 0) + 1

      const actualCategory = categoryForFinding(patterns, actual.kb_pattern_id)
      if (
        actual.finding_type === expected.expected_finding_type &&
        actual.confidence_label === expected.expected_confidence &&
        actualCategory === expected.expected_clause_category
      ) {
        matched += 1
      } else {
        unmatchedItems[goldCase.caseId] = [
          ...(unmatchedItems[goldCase.caseId] ?? []),
          expected.bill_line_item,
        ]
      }
    }
  }

  return {
    matchRate: totalExpected === 0 ? 0 : matched / totalExpected,
    totalExpected,
    matched,
    confidenceDistribution,
    unmatchedItems,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = runBenchmark()
  console.log(JSON.stringify(report, null, 2))
  process.exit(report.matchRate >= 0.7 ? 0 : 1)
}
