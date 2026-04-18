/**
 * @file module10-analytics.queries.ts
 * @module db/queries
 *
 * Versioned Module 10 pilot operations and analytics SQL helpers.
 *
 * DEPENDENCIES:
 *   - none
 *
 * CALLED BY:
 *   - dashboard admin operations pages
 *   - Module 10 checkpoint tests
 *
 * CALLS:
 *   - none
 */

export const MODULE10_ANALYTICS_VERSION = 'module10_ops_analytics_v1'

const PRODUCT_PROOF_FILTER = "c.payment_reporting_category != 'test'"

export const MODULE10_PRODUCT_ANALYTICS_SQL = {
  deliveredCases: `
/* ${MODULE10_ANALYTICS_VERSION}: product proof, excludes test cases by default */
SELECT
  c.payment_reporting_category,
  COUNT(*) AS delivered_cases
FROM cases c
JOIN reports r ON r.case_id = c.id
WHERE r.delivered_at IS NOT NULL
  AND ${PRODUCT_PROOF_FILTER}
GROUP BY c.payment_reporting_category
ORDER BY c.payment_reporting_category;
`,
  actionRate: `
/* ${MODULE10_ANALYTICS_VERSION}: product proof, excludes test cases by default */
SELECT
  c.payment_reporting_category,
  COUNT(*) FILTER (
    WHERE o.patient_action_type IN (
      'asked_hospital','asked_insurer_tpa','submitted_appeal','waiting_response'
    )
  ) AS action_count,
  COUNT(*) AS delivered_outcomes,
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
JOIN reports r ON r.case_id = c.id
WHERE r.delivered_at IS NOT NULL
  AND ${PRODUCT_PROOF_FILTER}
GROUP BY c.payment_reporting_category
ORDER BY c.payment_reporting_category;
`,
  appealRequeryRate: `
/* ${MODULE10_ANALYTICS_VERSION}: product proof, excludes test cases by default */
SELECT
  c.payment_reporting_category,
  COUNT(*) FILTER (WHERE o.patient_action_type = 'submitted_appeal') AS appeal_count,
  COUNT(*) FILTER (
    WHERE o.patient_action_type IN ('asked_hospital','asked_insurer_tpa')
  ) AS requery_count,
  COUNT(*) AS delivered_outcomes,
  ROUND(
    COUNT(*) FILTER (
      WHERE o.patient_action_type IN ('submitted_appeal','asked_hospital','asked_insurer_tpa')
    ) * 100.0 / NULLIF(COUNT(*), 0),
    1
  ) AS appeal_or_requery_rate_pct
FROM outcomes o
JOIN cases c ON c.id = o.case_id
JOIN reports r ON r.case_id = c.id
WHERE r.delivered_at IS NOT NULL
  AND ${PRODUCT_PROOF_FILTER}
GROUP BY c.payment_reporting_category
ORDER BY c.payment_reporting_category;
`,
  recoveryAmount: `
/* ${MODULE10_ANALYTICS_VERSION}: product proof, outcomes.reversal_amount_inr is whole rupees */
SELECT
  c.payment_reporting_category,
  COUNT(*) FILTER (WHERE o.reversal_amount_inr > 0) AS recovered_cases,
  SUM(o.reversal_amount_inr) FILTER (WHERE o.reversal_amount_inr > 0) AS total_recovered_inr,
  ROUND(AVG(o.reversal_amount_inr) FILTER (WHERE o.reversal_amount_inr > 0), 0)
    AS avg_recovered_inr
FROM outcomes o
JOIN cases c ON c.id = o.case_id
JOIN reports r ON r.case_id = c.id
WHERE r.delivered_at IS NOT NULL
  AND ${PRODUCT_PROOF_FILTER}
GROUP BY c.payment_reporting_category
ORDER BY c.payment_reporting_category;
`,
  satisfactionScore: `
/* ${MODULE10_ANALYTICS_VERSION}: product proof, excludes test cases by default */
SELECT
  c.payment_reporting_category,
  ROUND(AVG(o.user_satisfaction), 2) AS avg_satisfaction,
  COUNT(*) FILTER (WHERE o.user_satisfaction IS NOT NULL) AS ratings_count
FROM outcomes o
JOIN cases c ON c.id = o.case_id
JOIN reports r ON r.case_id = c.id
WHERE r.delivered_at IS NOT NULL
  AND o.user_satisfaction IS NOT NULL
  AND ${PRODUCT_PROOF_FILTER}
GROUP BY c.payment_reporting_category
ORDER BY c.payment_reporting_category;
`,
  reviewerThroughput: `
/* ${MODULE10_ANALYTICS_VERSION}: operational quality metric, excludes test cases by default */
SELECT
  c.assigned_reviewer_id,
  COUNT(*) FILTER (WHERE r.signed_off_at IS NOT NULL) AS signed_off_cases,
  COUNT(*) FILTER (WHERE r.delivered_at IS NOT NULL) AS delivered_cases,
  ROUND(
    AVG(EXTRACT(EPOCH FROM (r.signed_off_at - c.created_at)) / 3600)
      FILTER (WHERE r.signed_off_at IS NOT NULL),
    1
  ) AS avg_hours_to_signoff
FROM cases c
JOIN reports r ON r.case_id = c.id
WHERE c.assigned_reviewer_id IS NOT NULL
  AND ${PRODUCT_PROOF_FILTER}
GROUP BY c.assigned_reviewer_id
ORDER BY delivered_cases DESC, signed_off_cases DESC;
`,
  aiFallbackRate: `
/* ${MODULE10_ANALYTICS_VERSION}: operational quality metric, excludes test cases by default */
SELECT
  COUNT(*) FILTER (
    WHERE c.ai_draft->>'fallback_used' = 'true'
       OR c.ai_draft->>'source' = 'fallback'
  ) AS fallback_cases,
  COUNT(*) AS ai_draft_cases,
  ROUND(
    COUNT(*) FILTER (
      WHERE c.ai_draft->>'fallback_used' = 'true'
         OR c.ai_draft->>'source' = 'fallback'
    ) * 100.0 / NULLIF(COUNT(*), 0),
    1
  ) AS fallback_rate_pct
FROM cases c
WHERE c.ai_draft IS NOT NULL
  AND ${PRODUCT_PROOF_FILTER};
`,
  ocrManualRequiredRate: `
/* ${MODULE10_ANALYTICS_VERSION}: operational quality metric, excludes test cases by default */
SELECT
  d.doc_type,
  COUNT(*) FILTER (WHERE d.quality_status = 'manual_required') AS manual_required_documents,
  COUNT(*) AS documents_checked,
  ROUND(
    COUNT(*) FILTER (WHERE d.quality_status = 'manual_required') * 100.0
    / NULLIF(COUNT(*), 0),
    1
  ) AS manual_required_rate_pct
FROM documents d
JOIN cases c ON c.id = d.case_id
WHERE d.quality_status IS NOT NULL
  AND ${PRODUCT_PROOF_FILTER}
GROUP BY d.doc_type
ORDER BY manual_required_rate_pct DESC, d.doc_type;
`,
} as const

export const MODULE10_SEGMENTATION_SQL = {
  casePaymentSegmentation: `
/* ${MODULE10_ANALYTICS_VERSION}: case segmentation, includes paid/waived/test categories */
SELECT
  c.payment_reporting_category,
  c.payment_mode,
  COUNT(*) AS cases_count
FROM cases c
GROUP BY c.payment_reporting_category, c.payment_mode
ORDER BY c.payment_reporting_category, c.payment_mode;
`,
  paymentRevenueSegmentation: `
/* ${MODULE10_ANALYTICS_VERSION}: payment/revenue analytics, kept separate from product outcomes */
SELECT
  c.payment_reporting_category,
  p.status,
  COUNT(*) AS payment_count,
  SUM(p.amount_inr) AS total_amount_paise
FROM payments p
JOIN cases c ON c.id = p.case_id
GROUP BY c.payment_reporting_category, p.status
ORDER BY c.payment_reporting_category, p.status;
`,
} as const

export const MODULE10_ANALYTICS_SQL = {
  ...MODULE10_PRODUCT_ANALYTICS_SQL,
  ...MODULE10_SEGMENTATION_SQL,
} as const

export type Module10AnalyticsQueryName = keyof typeof MODULE10_ANALYTICS_SQL

/**
 * Returns a versioned Module 10 analytics SQL query.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes
 *
 * @param name - Analytics query key
 * @returns SQL text for Metabase-compatible reporting
 */
export function getModule10AnalyticsSql(name: Module10AnalyticsQueryName): string {
  return MODULE10_ANALYTICS_SQL[name]
}
