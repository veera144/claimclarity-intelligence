/**
 * @file outcomes.queries.ts
 * @module db/queries
 *
 * Module 9 product outcome analytics SQL helpers.
 *
 * DEPENDENCIES:
 *   - none
 *
 * CALLED BY:
 *   - analytics setup and Module 9 checkpoint tests
 *
 * CALLS:
 *   - none
 */

export const OUTCOME_ANALYTICS_SQL = {
  actionRate: `
SELECT
  c.payment_reporting_category,
  COUNT(*) FILTER (
    WHERE o.patient_action_type IN (
      'asked_hospital','asked_insurer_tpa','submitted_appeal','waiting_response'
    )
  ) AS action_count,
  COUNT(*) AS outcome_count,
  ROUND(
    COUNT(*) FILTER (
      WHERE o.patient_action_type IN (
        'asked_hospital','asked_insurer_tpa','submitted_appeal','waiting_response'
      )
    ) * 100.0 / NULLIF(COUNT(*), 0),
    1
  ) AS action_rate_pct
FROM outcomes o
JOIN cases c ON c.id = o.case_id
WHERE c.payment_reporting_category != 'test'
GROUP BY c.payment_reporting_category;
`,
  appealRate: `
SELECT
  c.payment_reporting_category,
  COUNT(*) FILTER (WHERE o.patient_action_type = 'submitted_appeal') AS appeals,
  COUNT(*) AS outcome_count,
  ROUND(
    COUNT(*) FILTER (WHERE o.patient_action_type = 'submitted_appeal') * 100.0
    / NULLIF(COUNT(*), 0),
    1
  ) AS appeal_rate_pct
FROM outcomes o
JOIN cases c ON c.id = o.case_id
WHERE c.payment_reporting_category != 'test'
GROUP BY c.payment_reporting_category;
`,
  responseRate: `
SELECT
  f.sequence_number,
  c.payment_reporting_category,
  COUNT(*) AS emails_sent,
  COUNT(*) FILTER (WHERE f.response_received = TRUE) AS responses,
  ROUND(COUNT(*) FILTER (WHERE f.response_received) * 100.0 / NULLIF(COUNT(*), 0), 1)
    AS response_rate_pct
FROM follow_up_schedule f
JOIN cases c ON c.id = f.case_id
WHERE f.sent_at IS NOT NULL
  AND c.payment_reporting_category != 'test'
GROUP BY f.sequence_number, c.payment_reporting_category
ORDER BY f.sequence_number, c.payment_reporting_category;
`,
  recoveryAmount: `
SELECT
  c.payment_reporting_category,
  COUNT(*) FILTER (WHERE o.outcome_type IN ('full_reversal','partial_reversal')) AS reversals,
  SUM(o.reversal_amount_inr) FILTER (WHERE o.reversal_amount_inr > 0) AS total_recovered_inr,
  ROUND(AVG(o.reversal_amount_inr) FILTER (WHERE o.reversal_amount_inr > 0), 0)
    AS avg_recovery_inr
FROM outcomes o
JOIN cases c ON c.id = o.case_id
WHERE c.payment_reporting_category != 'test'
GROUP BY c.payment_reporting_category;
`,
  satisfactionDistribution: `
SELECT
  c.payment_reporting_category,
  o.user_satisfaction,
  COUNT(*) AS count
FROM outcomes o
JOIN cases c ON c.id = o.case_id
WHERE o.user_satisfaction IS NOT NULL
  AND c.payment_reporting_category != 'test'
GROUP BY c.payment_reporting_category, o.user_satisfaction
ORDER BY c.payment_reporting_category, o.user_satisfaction;
`,
  unresolvedCases: `
SELECT
  c.payment_reporting_category,
  COUNT(*) AS unresolved_cases
FROM outcomes o
JOIN cases c ON c.id = o.case_id
WHERE COALESCE(o.outcome_type, 'pending') = 'pending'
  AND c.status != 'closed'
  AND c.payment_reporting_category != 'test'
GROUP BY c.payment_reporting_category;
`,
  evidenceTypeCounts: `
SELECT
  c.payment_reporting_category,
  o.evidence_type,
  COUNT(*) AS count
FROM outcomes o
JOIN cases c ON c.id = o.case_id
WHERE c.payment_reporting_category != 'test'
GROUP BY c.payment_reporting_category, o.evidence_type
ORDER BY c.payment_reporting_category, o.evidence_type;
`,
} as const

export type OutcomeAnalyticsQueryName = keyof typeof OUTCOME_ANALYTICS_SQL

/**
 * Returns Module 9 analytics SQL by name.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes
 *
 * @param name - Analytics query key
 * @returns SQL text that excludes test cases by default
 */
export function getOutcomeAnalyticsSql(name: OutcomeAnalyticsQueryName): string {
  return OUTCOME_ANALYTICS_SQL[name]
}
