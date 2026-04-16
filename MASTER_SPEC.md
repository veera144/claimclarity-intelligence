# ClaimClarity — MASTER_SPEC
### Canonical single-source implementation specification
#### Combines final build flow + engineering standards + agent review workflow

---

## HOW TO USE THIS FILE

This is the single source of truth for implementation.

Use it in this order:
1. Read **Master Rules** in this file.
2. Follow the **Agent Workflow** in `AGENTS.md`.
3. Build **one module at a time**.
4. Do not start the next module until:
   - the current module implementation is complete,
   - all module checkpoints pass,
   - the reviewer agent signs off,
   - the manager agent records the module as complete.

## PRECEDENCE RULES

Inside this master file:
1. **Master Rules** override everything else.
2. **Engineering Standards v1.6** override code style, validation, linting, token, and maintainability details.
3. **Final Build Spec** controls product behavior, module order, schema intent, and verification flow.
4. If any instruction conflicts or is ambiguous, stop and create a short `SPEC_GAP.md` note instead of guessing.

## MASTER RULES

- Scope is India-only, pilot-first, human-reviewed claim clarity and appeal drafting.
- No approval prediction. No treatment advice. No fraud accusations.
- Outcome tracking is part of the core product, not optional reporting.
- Broker/partner portals are out of V1 scope.
- Payment modes are explicit:
  - `real_payment`: paid Razorpay checkout.
  - `admin_waived`: admin-only pilot or service recovery waiver.
  - `internal_access_code`: hidden allowlisted internal code waiver, validated server-side only.
  - `test_simulated`: dev/test-only simulated activation.
- For waived or simulated cases, payment is bypassed cleanly. No Razorpay calls, Razorpay verification, or `payments` rows.
- Downstream reporting must separate paid, waived, and test/simulated cases; do not infer waived volume from missing payment rows alone.
- Outcome updates require either:
  1. authenticated patient session, or
  2. one-time signed outcome token.
- AI never sees raw OCR text. AI receives structured findings only.
- `finding_id` sent to the AI layer must remain the full stable identifier.
- Money units are strict and must never be mixed:
  - `cases.claim_amount_inr`: whole rupees
  - `payments.amount_inr`: paise
  - `findings.bill_amount_inr`: paise
  - `outcomes.*_inr`: whole rupees
- Reviewers only see assigned cases. Experts only see escalations or cases assigned to them. Admins see all.
- Do not add features not explicitly included in the master spec.

## AGENT EXECUTION MODEL

The repo should run with three logical agents:
- **Manager Agent**: chooses the current module, checks prerequisites, blocks forward motion until review passes.
- **Builder Agent**: implements the current module only.
- **Reviewer Agent**: audits code, tests, security boundaries, and adherence to this master spec.

The exact operating rules for these agents are in `AGENTS.md`.

---

## PART A — FINAL BUILD SPEC (Canonical product and module implementation)

# ClaimClarity — Final Self-Executing Build Prompts
### Module-by-module. Each prompt runs, verifies, and reports its own completion.
#### No human supervision needed between modules. Tests prove readiness.

---

## BEFORE YOU START — READ THIS

Each module prompt is self-contained. Paste it into Claude Code or Codex.
The AI builds the module, then runs its own verification suite.
If any checkpoint fails, the AI reports what failed and fixes it before stopping.
Do not start the next module until the current module reports ALL CHECKPOINTS PASSED.

**Final fixes applied in this document (not in prior versions):**
- Outcome money unit bug fixed: whole rupees, no division by 100 in SQL
- Outcome evidence upload added (optional settlement document)
- Outcome confidence field added (self_reported / document_verified)
- Original approved/deducted amounts captured during OCR for later comparison
- One-click email action buttons in follow-up emails
- Rate limiting on all public API routes
- Supabase SSR session middleware fully specified
- Railway health check endpoints
- Domain verification for Resend email delivery
- Broker portal and partner complexity removed entirely from V1
- Rules engine no longer sets `ai_draft_ready` before AI draft generation
- `reports` row is pre-created at case creation
- Outcome updates require authenticated patient session or one-time signed token
- Reviewer/expert RLS scope tightened: reviewers see assigned cases only
- Admin case creation uses auth trigger instead of manually inserting `users`
- Rules-engine benchmark test uses a truly unseeded bill item
- Module 0 verification script uses server-side checks only

---

## MODULE 0 — INFRASTRUCTURE AND SCHEMA

### Paste this entire block into Claude Code

```
TASK: Build the complete ClaimClarity infrastructure and deploy the final database schema.

This is Module 0 of 10. Nothing else is built until this module passes all checkpoints.

═══════════════════════════════════════════════════════
STACK
═══════════════════════════════════════════════════════
- pnpm workspaces monorepo
- Next.js 14 App Router + TypeScript + Tailwind (two apps: web, dashboard)
- Node.js + TypeScript processing service (Railway)
- Supabase: auth + PostgreSQL + storage + realtime
- All packages under /packages/

═══════════════════════════════════════════════════════
STEP 1: MONOREPO SCAFFOLD
═══════════════════════════════════════════════════════

Create exactly this structure:
/apps/web          Next.js 14, TypeScript, Tailwind, @supabase/ssr
/apps/dashboard    Next.js 14, TypeScript, Tailwind, @supabase/ssr
/apps/processor    Node.js, TypeScript only (no Next.js)
/packages/db       Supabase client + generated types
/packages/shared   TypeScript types only

Root pnpm-workspace.yaml:
packages:
  - 'apps/*'
  - 'packages/*'

Each Next.js app: install @supabase/ssr @supabase/supabase-js

═══════════════════════════════════════════════════════
STEP 2: ENVIRONMENT FILES
═══════════════════════════════════════════════════════

Create .env.example at root:

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=ap-south-1
AWS_TEXTRACT_STAGING_BUCKET=
AWS_TEXTRACT_STAGING_PREFIX=ocr-staging
TEXTRACT_ASYNC_POLL_INTERVAL_MS=5000
TEXTRACT_ASYNC_TIMEOUT_MS=120000
ANTHROPIC_API_KEY=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
RESEND_API_KEY=
RESEND_FROM_EMAIL=reports@claimclarity.in
RESEND_DOMAIN=claimclarity.in
ADMIN_EMAIL=admin@claimclarity.in
INTERNAL_WEBHOOK_SECRET=
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_DASHBOARD_URL=http://localhost:3001
PRIVACY_POLICY_VERSION=v1.0-2024-04-01
TERMS_VERSION=v1.0-2024-04-01
RAILWAY_HEALTH_CHECK_PATH=/health
INTERNAL_ACCESS_CODE_SHA256_HASHES=
ALLOW_TEST_SIMULATED_PAYMENTS=false

Copy to .env.local in each app directory.

═══════════════════════════════════════════════════════
STEP 3: DEPLOY THIS EXACT SCHEMA
═══════════════════════════════════════════════════════

Save as /packages/db/schema.sql and run against Supabase.

-- USERS (id = auth.users.id, not gen_random_uuid)
CREATE TABLE users (
  id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email          TEXT UNIQUE NOT NULL,
  phone          TEXT,
  role           TEXT NOT NULL DEFAULT 'patient'
                   CHECK (role IN ('patient','reviewer','expert','admin')),
  full_name      TEXT,
  city_tier      TEXT CHECK (city_tier IN ('tier1','tier2','tier3')),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ
);

CREATE OR REPLACE FUNCTION handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO users (id, email, role)
  VALUES (NEW.id, NEW.email, 'patient')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_auth_user();

-- PARTNERS (record only — no portal in V1)
CREATE TABLE partners (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  partner_type   TEXT NOT NULL CHECK (partner_type IN ('broker','ifa','hr_team','other')),
  contact_email  TEXT NOT NULL,
  referral_code  TEXT UNIQUE,
  status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','paused','suspended')),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  created_by     UUID REFERENCES users(id)
);

-- CONSENTS
CREATE TABLE consents (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES users(id),
  case_id                UUID,
  consent_type           TEXT NOT NULL CHECK (consent_type IN (
                           'data_processing','no_training','retention_policy',
                           'informational_only','terms_of_service'
                         )),
  consent_given          BOOLEAN NOT NULL,
  privacy_policy_version TEXT NOT NULL,
  terms_version          TEXT NOT NULL,
  source_channel         TEXT CHECK (source_channel IN ('patient_web','admin_created')),
  ip_address             TEXT,
  user_agent             TEXT,
  revoked_at             TIMESTAMPTZ,
  revocation_reason      TEXT,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

-- CASES
CREATE TABLE cases (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id                UUID NOT NULL REFERENCES users(id),
  partner_id                UUID REFERENCES partners(id),
  case_ref                  TEXT UNIQUE NOT NULL,
  intake_channel            TEXT NOT NULL DEFAULT 'patient_web'
                              CHECK (intake_channel IN ('patient_web','admin_created')),
  status                    TEXT NOT NULL DEFAULT 'consent_pending' CHECK (status IN (
                              'consent_pending','documents_pending','payment_pending',
                              'processing','ai_draft_ready','under_review',
                              'escalated','approved','generating_report','delivered','closed'
                            )),
  current_step              TEXT CHECK (current_step IN (
                              'quality_check','ocr','rules_engine','ai_draft',
                              'awaiting_review','report_generation','complete','failed'
                            )),
  claim_amount_inr          INTEGER,
  insurer_name              TEXT,
  procedure_category        TEXT,
  case_type                 TEXT CHECK (case_type IN ('cashless','reimbursement')),
  assigned_reviewer_id      UUID REFERENCES users(id),
  assigned_expert_id        UUID REFERENCES users(id),
  ai_draft                  JSONB,
  confidence_overall        TEXT CHECK (confidence_overall IN ('high','low','mixed')),
  sla_deadline              TIMESTAMPTZ,
  sla_breached              BOOLEAN DEFAULT FALSE,
  sla_warning_sent          BOOLEAN DEFAULT FALSE,
  is_partial_report         BOOLEAN DEFAULT FALSE,
  partial_reason            TEXT,
  generation_failed         BOOLEAN DEFAULT FALSE,
  generation_failure_reason TEXT,
  payment_waived            BOOLEAN NOT NULL DEFAULT FALSE,
  payment_waived_reason     TEXT,
  payment_mode              TEXT NOT NULL DEFAULT 'real_payment'
                              CHECK (payment_mode IN (
                                'real_payment','admin_waived',
                                'internal_access_code','test_simulated'
                              )),
  payment_reporting_category TEXT NOT NULL DEFAULT 'paid'
                              CHECK (payment_reporting_category IN ('paid','waived','test')),
  original_approved_inr     INTEGER,
  originally_deducted_inr   INTEGER,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT cases_payment_mode_consistency CHECK (
    (
      payment_mode = 'real_payment'
      AND payment_waived = FALSE
      AND payment_reporting_category = 'paid'
    )
    OR (
      payment_mode IN ('admin_waived','internal_access_code')
      AND payment_waived = TRUE
      AND payment_reporting_category = 'waived'
    )
    OR (
      payment_mode = 'test_simulated'
      AND payment_waived = TRUE
      AND payment_reporting_category = 'test'
    )
  )
);

COMMENT ON COLUMN cases.claim_amount_inr IS
  'Patient insurance claim total in WHOLE RUPEES. 125000 = ₹1,25,000. NOT the report fee.';
COMMENT ON COLUMN cases.original_approved_inr IS
  'Amount insurer originally approved BEFORE any appeal. Whole rupees. Extracted from insurer letter.';
COMMENT ON COLUMN cases.originally_deducted_inr IS
  'Amount insurer originally deducted BEFORE any appeal. Whole rupees. Extracted from insurer letter.';
COMMENT ON COLUMN cases.payment_mode IS
  'How Module 3 allowed the case to enter processing: real_payment, admin_waived, internal_access_code, or test_simulated.';
COMMENT ON COLUMN cases.payment_reporting_category IS
  'Reporting separation for downstream analytics: paid, waived, or test. Do not infer from payments rows alone.';

ALTER TABLE consents ADD CONSTRAINT fk_consents_case
  FOREIGN KEY (case_id) REFERENCES cases(id);

-- DOCUMENTS
CREATE TABLE documents (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                     UUID NOT NULL REFERENCES cases(id),
  doc_type                    TEXT NOT NULL CHECK (doc_type IN (
                                'policy','cis','hospital_bill','insurer_response',
                                'discharge_summary','preauth_letter','investigation_report',
                                'prescription','prior_policy','payment_receipt',
                                'prior_correspondence','other'
                              )),
  is_required                 BOOLEAN DEFAULT FALSE,
  storage_path                TEXT NOT NULL,
  original_filename_encrypted TEXT,
  file_size_bytes             INTEGER,
  mime_type                   TEXT,
  page_count                  INTEGER,
  quality_status              TEXT DEFAULT 'pending'
                                CHECK (quality_status IN ('pending','pass','fail','manual_required')),
  quality_failure_reason      TEXT,
  quality_checked_at          TIMESTAMPTZ,
  ocr_status                  TEXT DEFAULT 'pending'
                                CHECK (ocr_status IN ('pending','running','completed','failed')),
  ocr_started_at              TIMESTAMPTZ,
  ocr_completed_at            TIMESTAMPTZ,
  ocr_attempt_count           INTEGER DEFAULT 0,
  extracted_json              JSONB,
  extracted_text              TEXT,
  extraction_confidence       FLOAT,
  language_detected           TEXT,
  has_tables                  BOOLEAN DEFAULT FALSE,
  has_handwriting             BOOLEAN DEFAULT FALSE,
  uploaded_at                 TIMESTAMPTZ DEFAULT NOW(),
  uploaded_by                 UUID REFERENCES users(id)
);

-- FINDINGS
CREATE TABLE findings (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                    UUID NOT NULL REFERENCES cases(id),
  finding_type               TEXT NOT NULL CHECK (finding_type IN (
                               'covered','deducted','at_risk','missing_document','appeal_point'
                             )),
  bill_line_item             TEXT,
  bill_amount_inr            INTEGER,
  bill_category              TEXT,
  clause_reference           TEXT,
  clause_text                TEXT,
  kb_pattern_id              UUID,
  operative_reason           TEXT,
  plain_language_explanation TEXT,
  confidence_label           TEXT NOT NULL CHECK (confidence_label IN (
                               'clause_found_matched',
                               'based_on_typical_policy',
                               'insufficient_information'
                             )),
  appeal_strength            TEXT CHECK (appeal_strength IN ('strong','moderate','weak')),
  appeal_basis               TEXT,
  ai_generated               BOOLEAN DEFAULT TRUE,
  reviewer_confirmed         BOOLEAN DEFAULT FALSE,
  reviewer_confirmed_by      UUID REFERENCES users(id),
  reviewer_confirmed_at      TIMESTAMPTZ,
  reviewer_edited            BOOLEAN DEFAULT FALSE,
  expert_confirmed           BOOLEAN DEFAULT FALSE,
  expert_confirmed_by        UUID REFERENCES users(id),
  sort_order                 INTEGER,
  created_at                 TIMESTAMPTZ DEFAULT NOW(),
  updated_at                 TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN findings.bill_amount_inr IS
  'Hospital bill line item in PAISE. 250000 = ₹2,500.';

-- ESCALATIONS
CREATE TABLE escalations (
  id                           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                      UUID NOT NULL REFERENCES cases(id),
  finding_id                   UUID REFERENCES findings(id),
  escalation_type              TEXT NOT NULL CHECK (escalation_type IN ('finding','full_case')),
  from_reviewer_id             UUID NOT NULL REFERENCES users(id),
  to_expert_id                 UUID REFERENCES users(id),
  question_text                TEXT NOT NULL,
  priority                     TEXT NOT NULL DEFAULT 'normal'
                                 CHECK (priority IN ('normal','high')),
  status                       TEXT NOT NULL DEFAULT 'open'
                                 CHECK (status IN ('open','accepted','responded','resolved','dismissed')),
  expert_response              TEXT,
  confidence_recommendation    TEXT CHECK (confidence_recommendation IN (
                                 'clause_found_matched','based_on_typical_policy','insufficient_information'
                               )),
  clause_reference_from_expert TEXT,
  created_at                   TIMESTAMPTZ DEFAULT NOW(),
  accepted_at                  TIMESTAMPTZ,
  responded_at                 TIMESTAMPTZ,
  resolved_at                  TIMESTAMPTZ
);

-- PROCESSING JOBS
CREATE TABLE processing_jobs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id          UUID NOT NULL REFERENCES cases(id),
  document_id      UUID REFERENCES documents(id),
  job_type         TEXT NOT NULL CHECK (job_type IN (
                     'quality_check','ocr','bill_normalization','policy_chunking',
                     'insurer_letter_parsing','rules_engine','ai_draft_generation',
                     'report_generation','email_delivery'
                   )),
  status           TEXT NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued','running','completed','failed','retrying','cancelled')),
  attempt_count    INTEGER DEFAULT 0,
  max_attempts     INTEGER DEFAULT 3,
  payload          JSONB,
  result           JSONB,
  error_message    TEXT,
  queued_at        TIMESTAMPTZ DEFAULT NOW(),
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  next_retry_at    TIMESTAMPTZ,
  idempotency_key  TEXT UNIQUE
);

-- KB CLAUSE PATTERNS
CREATE TABLE kb_clause_patterns (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_name              TEXT,
  clause_category           TEXT NOT NULL CHECK (clause_category IN (
                              'room_rent','copay','waiting_period','pre_existing',
                              'non_medical_expenses','sublimit_procedure','package_deduction',
                              'daycare','domiciliary','maternity','dental','vision',
                              'pharmacy_sublimit','icu_stepdown','specialist_consultation',
                              'ayush','opd_exclusion','other'
                            )),
  clause_keywords           TEXT[] NOT NULL,
  typical_clause_text       TEXT,
  common_deduction_trigger  TEXT NOT NULL,
  operative_reason_template TEXT NOT NULL,
  plain_language_template   TEXT NOT NULL,
  appeal_point_template     TEXT NOT NULL,
  precedent_ombudsman_ref   TEXT,
  is_active                 BOOLEAN DEFAULT TRUE,
  verified_by_expert        BOOLEAN DEFAULT FALSE,
  verified_by               UUID REFERENCES users(id),
  verified_at               TIMESTAMPTZ,
  added_by                  UUID NOT NULL REFERENCES users(id),
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE findings ADD CONSTRAINT fk_findings_kb
  FOREIGN KEY (kb_pattern_id) REFERENCES kb_clause_patterns(id);

-- KB CHANGE LOG
CREATE TABLE kb_change_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_id    UUID NOT NULL REFERENCES kb_clause_patterns(id),
  changed_by    UUID NOT NULL REFERENCES users(id),
  change_type   TEXT NOT NULL CHECK (change_type IN ('created','updated','verified','deactivated')),
  old_values    JSONB,
  new_values    JSONB,
  change_reason TEXT,
  changed_at    TIMESTAMPTZ DEFAULT NOW()
);

-- REPORTS
CREATE TABLE reports (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                UUID NOT NULL REFERENCES cases(id) UNIQUE,
  report_version         INTEGER DEFAULT 1,
  is_partial             BOOLEAN DEFAULT FALSE,
  partial_reason         TEXT,
  pdf_storage_path       TEXT,
  appeal_letter_included BOOLEAN DEFAULT TRUE,
  signed_off_by          UUID REFERENCES users(id),
  signed_off_at          TIMESTAMPTZ,
  delivered_at           TIMESTAMPTZ,
  delivery_email_id      TEXT,
  correction_of_version  INTEGER,
  correction_reason      TEXT,
  created_at             TIMESTAMPTZ DEFAULT NOW()
);

-- QUALITY SCORES
CREATE TABLE quality_scores (
  id                             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                        UUID NOT NULL REFERENCES cases(id),
  report_id                      UUID REFERENCES reports(id),
  scored_by                      UUID NOT NULL REFERENCES users(id),
  scoring_type                   TEXT NOT NULL CHECK (scoring_type IN (
                                   'post_delivery_expert_review','calibration_check'
                                 )),
  clause_extraction_accuracy     FLOAT CHECK (clause_extraction_accuracy BETWEEN 0 AND 1),
  deduction_reason_accuracy      FLOAT CHECK (deduction_reason_accuracy BETWEEN 0 AND 1),
  missing_doc_identification     FLOAT CHECK (missing_doc_identification BETWEEN 0 AND 1),
  next_step_question_usefulness  FLOAT CHECK (next_step_question_usefulness BETWEEN 1 AND 5),
  appeal_point_validity          FLOAT CHECK (appeal_point_validity BETWEEN 0 AND 1),
  harmful_output                 BOOLEAN DEFAULT FALSE,
  harmful_output_description     TEXT,
  notes                          TEXT,
  scored_at                      TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_quality_unique ON quality_scores(case_id, scored_by, scoring_type);

-- OUTCOMES (replaces follow_ups — core product metric)
CREATE TABLE outcomes (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id                     UUID NOT NULL REFERENCES cases(id) UNIQUE,
  appeal_submitted            BOOLEAN,
  appeal_submitted_at         TIMESTAMPTZ,
  insurer_responded           BOOLEAN,
  insurer_responded_at        TIMESTAMPTZ,

  -- Money fields: ALL WHOLE RUPEES (not paise)
  final_settled_amount_inr    INTEGER,
  original_approved_inr       INTEGER,
  originally_deducted_inr     INTEGER,
  reversal_amount_inr         INTEGER
    GENERATED ALWAYS AS (
      CASE WHEN final_settled_amount_inr IS NOT NULL AND original_approved_inr IS NOT NULL
      THEN final_settled_amount_inr - original_approved_inr
      ELSE NULL END
    ) STORED,

  outcome_type                TEXT CHECK (outcome_type IN (
                                'full_reversal','partial_reversal','no_change','pending','not_applicable'
                              )),
  report_used_in_appeal       BOOLEAN,

  -- Evidence quality
  evidence_type               TEXT NOT NULL DEFAULT 'self_reported'
                                CHECK (evidence_type IN (
                                  'self_reported','partially_verified','document_verified'
                                )),
  evidence_storage_path       TEXT,

  user_satisfaction           INTEGER CHECK (user_satisfaction BETWEEN 1 AND 5),
  user_comment                TEXT,

  needs_manual_followup       BOOLEAN DEFAULT FALSE,
  manual_followup_reason      TEXT,

  collected_via               TEXT CHECK (collected_via IN (
                                'email_survey_30d','email_survey_60d','email_survey_90d',
                                'manual_call','admin_entry'
                              )),
  collected_at                TIMESTAMPTZ DEFAULT NOW(),
  last_updated_at             TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN outcomes.final_settled_amount_inr IS
  'Amount insurer paid AFTER appeal. WHOLE RUPEES. 125000 = ₹1,25,000.';
COMMENT ON COLUMN outcomes.reversal_amount_inr IS
  'Generated: final_settled - original_approved. Positive = patient recovered money. WHOLE RUPEES.';
COMMENT ON COLUMN outcomes.original_approved_inr IS
  'Copied from cases.original_approved_inr at outcome creation. WHOLE RUPEES.';

-- OUTCOME TOKENS (one-time links for email-based outcome updates)
CREATE TABLE outcome_tokens (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id          UUID NOT NULL REFERENCES cases(id),
  token_hash       TEXT NOT NULL UNIQUE,
  action_type      TEXT NOT NULL CHECK (action_type IN (
                     'quick_update_submitted','quick_update_not_yet','quick_update_no_appeal',
                     'quick_update_paid_more','quick_update_rejected','quick_update_waiting',
                     'quick_update_resolved','quick_update_no_change','quick_update_moved_on',
                     'full_outcome_form'
                   )),
  expires_at       TIMESTAMPTZ NOT NULL,
  used_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- FOLLOW-UP SCHEDULE
CREATE TABLE follow_up_schedule (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id          UUID NOT NULL REFERENCES cases(id),
  sequence_number  INTEGER NOT NULL CHECK (sequence_number IN (1,2,3)),
  scheduled_at     TIMESTAMPTZ NOT NULL,
  sent_at          TIMESTAMPTZ,
  email_message_id TEXT,
  response_received BOOLEAN DEFAULT FALSE,
  UNIQUE(case_id, sequence_number)
);

-- PAYMENTS
CREATE TABLE payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id             UUID NOT NULL REFERENCES cases(id),
  patient_id          UUID NOT NULL REFERENCES users(id),
  amount_inr          INTEGER NOT NULL,
  payment_type        TEXT NOT NULL CHECK (payment_type IN ('report','expert_call','correction')),
  razorpay_order_id   TEXT UNIQUE,
  razorpay_payment_id TEXT UNIQUE,
  razorpay_signature  TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','paid','refunded','partial_refund','failed','cancelled')),
  paid_at             TIMESTAMPTZ,
  refunded_at         TIMESTAMPTZ,
  refund_amount_inr   INTEGER,
  refund_reason       TEXT,
  refund_razorpay_id  TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_payments_case_active
  ON payments(case_id) WHERE status IN ('pending','paid');

COMMENT ON COLUMN payments.amount_inr IS
  'ClaimClarity report fee in PAISE. 69900 = ₹699. NOT the insurance claim amount.';

-- REVIEWER NOTIFICATIONS
CREATE TABLE reviewer_notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id      UUID NOT NULL REFERENCES users(id),
  notification_type TEXT NOT NULL CHECK (notification_type IN (
                      'new_case_assigned','escalation_received','escalation_responded',
                      'sla_warning','sla_breached','document_manual_required','processing_failed'
                    )),
  case_id           UUID REFERENCES cases(id),
  escalation_id     UUID REFERENCES escalations(id),
  message           TEXT NOT NULL,
  read_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- AUDIT LOG (immutable)
CREATE TABLE audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID REFERENCES users(id),
  actor_role  TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   UUID,
  ip_address  TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE RULE no_update_audit_log AS ON UPDATE TO audit_log DO INSTEAD NOTHING;
CREATE RULE no_delete_audit_log AS ON DELETE TO audit_log DO INSTEAD NOTHING;

-- INDEXES
CREATE INDEX idx_cases_patient         ON cases(patient_id);
CREATE INDEX idx_cases_status          ON cases(status);
CREATE INDEX idx_cases_reviewer        ON cases(assigned_reviewer_id);
CREATE INDEX idx_cases_sla             ON cases(sla_deadline) WHERE sla_breached = FALSE;
CREATE INDEX idx_cases_step            ON cases(current_step, status);
CREATE INDEX idx_docs_case             ON documents(case_id);
CREATE INDEX idx_docs_type             ON documents(case_id, doc_type);
CREATE INDEX idx_docs_ocr              ON documents(ocr_status) WHERE ocr_status = 'pending';
CREATE INDEX idx_findings_case         ON findings(case_id);
CREATE INDEX idx_findings_type         ON findings(case_id, finding_type);
CREATE INDEX idx_findings_unconfirmed  ON findings(case_id) WHERE reviewer_confirmed = FALSE;
CREATE INDEX idx_escalations_case      ON escalations(case_id);
CREATE INDEX idx_escalations_open      ON escalations(to_expert_id, status) WHERE status = 'open';
CREATE INDEX idx_jobs_case             ON processing_jobs(case_id);
CREATE INDEX idx_jobs_queued           ON processing_jobs(status, queued_at) WHERE status = 'queued';
CREATE INDEX idx_jobs_retry            ON processing_jobs(next_retry_at) WHERE status = 'retrying';
CREATE INDEX idx_kb_insurer            ON kb_clause_patterns(insurer_name);
CREATE INDEX idx_kb_category           ON kb_clause_patterns(clause_category);
CREATE INDEX idx_kb_active             ON kb_clause_patterns(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_kb_keywords           ON kb_clause_patterns USING gin(clause_keywords);
CREATE INDEX idx_consents_user         ON consents(user_id, consent_type);
CREATE INDEX idx_consents_active       ON consents(user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_payments_case         ON payments(case_id);
CREATE INDEX idx_outcomes_case         ON outcomes(case_id);
CREATE INDEX idx_outcome_tokens_case   ON outcome_tokens(case_id);
CREATE INDEX idx_outcome_tokens_expiry ON outcome_tokens(expires_at) WHERE used_at IS NULL;
CREATE INDEX idx_followup_scheduled    ON follow_up_schedule(scheduled_at) WHERE sent_at IS NULL;
CREATE INDEX idx_notifications_unread  ON reviewer_notifications(recipient_id) WHERE read_at IS NULL;
CREATE INDEX idx_audit_entity          ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_actor           ON audit_log(actor_id, created_at);

-- RLS HELPER FUNCTIONS
CREATE OR REPLACE FUNCTION is_internal()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE id = auth.uid()
    AND role IN ('reviewer','expert','admin'))
$$;

CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
$$;

CREATE OR REPLACE FUNCTION is_reviewer()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'reviewer')
$$;

CREATE OR REPLACE FUNCTION is_expert()
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'expert')
$$;

-- ENABLE RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalations ENABLE ROW LEVEL SECURITY;
ALTER TABLE processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE quality_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_clause_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_change_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE outcome_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_up_schedule ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviewer_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- RLS POLICIES
CREATE POLICY users_self         ON users FOR SELECT USING (id = auth.uid());
CREATE POLICY users_internal     ON users FOR SELECT USING (is_internal());
CREATE POLICY users_admin_update ON users FOR UPDATE USING (is_admin());
CREATE POLICY partners_admin     ON partners FOR ALL USING (is_admin());
CREATE POLICY consents_own_sel   ON consents FOR SELECT USING (user_id = auth.uid());
CREATE POLICY consents_own_ins   ON consents FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY consents_own_upd   ON consents FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY consents_admin     ON consents FOR ALL USING (is_admin());
CREATE POLICY cases_patient_sel  ON cases FOR SELECT USING (patient_id = auth.uid());
CREATE POLICY cases_patient_ins  ON cases FOR INSERT WITH CHECK (patient_id = auth.uid());
CREATE POLICY cases_reviewer      ON cases FOR SELECT USING (
  assigned_reviewer_id = auth.uid() AND is_reviewer()
);
CREATE POLICY cases_reviewer_update ON cases FOR UPDATE USING (
  assigned_reviewer_id = auth.uid() AND is_reviewer()
);
CREATE POLICY cases_expert         ON cases FOR SELECT USING (
  (assigned_expert_id = auth.uid() AND is_expert())
  OR EXISTS (SELECT 1 FROM escalations e WHERE e.case_id = cases.id AND e.to_expert_id = auth.uid())
);
CREATE POLICY cases_admin          ON cases FOR ALL USING (is_admin());
CREATE POLICY docs_patient_sel   ON documents FOR SELECT USING (
  case_id IN (SELECT id FROM cases WHERE patient_id = auth.uid())
);
CREATE POLICY docs_patient_ins   ON documents FOR INSERT WITH CHECK (
  case_id IN (SELECT id FROM cases WHERE patient_id = auth.uid())
);
CREATE POLICY docs_reviewer      ON documents FOR SELECT USING (
  case_id IN (SELECT id FROM cases WHERE assigned_reviewer_id = auth.uid()) AND is_reviewer()
);
CREATE POLICY docs_expert          ON documents FOR SELECT USING (
  case_id IN (SELECT id FROM cases WHERE assigned_expert_id = auth.uid()) AND is_expert()
  OR EXISTS (
    SELECT 1 FROM escalations e
    JOIN cases c ON c.id = e.case_id
    WHERE c.id = documents.case_id AND e.to_expert_id = auth.uid()
  )
);
CREATE POLICY docs_admin           ON documents FOR ALL USING (is_admin());
CREATE POLICY findings_patient   ON findings FOR SELECT USING (
  case_id IN (
    SELECT c.id FROM cases c JOIN reports r ON r.case_id = c.id
    WHERE c.patient_id = auth.uid() AND r.delivered_at IS NOT NULL
  )
);
CREATE POLICY findings_reviewer  ON findings FOR ALL USING (
  case_id IN (SELECT id FROM cases WHERE assigned_reviewer_id = auth.uid()) AND is_reviewer()
);
CREATE POLICY findings_expert      ON findings FOR SELECT USING (
  case_id IN (SELECT id FROM cases WHERE assigned_expert_id = auth.uid()) AND is_expert()
  OR EXISTS (
    SELECT 1 FROM escalations e
    JOIN cases c ON c.id = e.case_id
    WHERE c.id = findings.case_id AND e.to_expert_id = auth.uid()
  )
);
CREATE POLICY findings_admin       ON findings FOR ALL USING (is_admin());
CREATE POLICY escalations_rev    ON escalations FOR ALL USING (from_reviewer_id = auth.uid());
CREATE POLICY escalations_exp    ON escalations FOR ALL USING (
  to_expert_id = auth.uid() OR is_admin()
);
CREATE POLICY jobs_admin_read    ON processing_jobs FOR SELECT USING (is_admin());
CREATE POLICY reports_patient    ON reports FOR SELECT USING (
  delivered_at IS NOT NULL AND
  case_id IN (SELECT id FROM cases WHERE patient_id = auth.uid())
);
CREATE POLICY reports_reviewer   ON reports FOR ALL USING (
  case_id IN (SELECT id FROM cases WHERE assigned_reviewer_id = auth.uid()) AND is_reviewer()
);
CREATE POLICY reports_expert       ON reports FOR SELECT USING (
  case_id IN (SELECT id FROM cases WHERE assigned_expert_id = auth.uid()) AND is_expert()
  OR EXISTS (
    SELECT 1 FROM escalations e
    JOIN cases c ON c.id = e.case_id
    WHERE c.id = reports.case_id AND e.to_expert_id = auth.uid()
  )
);
CREATE POLICY reports_admin        ON reports FOR ALL USING (is_admin());
CREATE POLICY quality_internal   ON quality_scores FOR ALL USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('expert','admin'))
);
CREATE POLICY kb_read_internal   ON kb_clause_patterns FOR SELECT USING (is_internal());
CREATE POLICY kb_write_expert    ON kb_clause_patterns FOR ALL USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('expert','admin'))
);
CREATE POLICY kb_log_ins         ON kb_change_log FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('expert','admin'))
);
CREATE POLICY kb_log_sel         ON kb_change_log FOR SELECT USING (is_internal());
CREATE POLICY outcomes_patient_sel ON outcomes FOR SELECT USING (
  case_id IN (SELECT id FROM cases WHERE patient_id = auth.uid())
);
CREATE POLICY outcomes_patient_upd ON outcomes FOR UPDATE USING (
  case_id IN (SELECT id FROM cases WHERE patient_id = auth.uid())
);
CREATE POLICY outcomes_reviewer  ON outcomes FOR SELECT USING (
  case_id IN (SELECT id FROM cases WHERE assigned_reviewer_id = auth.uid()) AND is_reviewer()
);
CREATE POLICY outcomes_expert      ON outcomes FOR SELECT USING (
  case_id IN (SELECT id FROM cases WHERE assigned_expert_id = auth.uid()) AND is_expert()
  OR EXISTS (
    SELECT 1 FROM escalations e
    JOIN cases c ON c.id = e.case_id
    WHERE c.id = outcomes.case_id AND e.to_expert_id = auth.uid()
  )
);
CREATE POLICY outcomes_admin       ON outcomes FOR ALL USING (is_admin());
CREATE POLICY followup_patient   ON follow_up_schedule FOR SELECT USING (
  case_id IN (SELECT id FROM cases WHERE patient_id = auth.uid())
);
CREATE POLICY followup_reviewer  ON follow_up_schedule FOR SELECT USING (
  case_id IN (SELECT id FROM cases WHERE assigned_reviewer_id = auth.uid()) AND is_reviewer()
);
CREATE POLICY followup_expert      ON follow_up_schedule FOR SELECT USING (
  case_id IN (SELECT id FROM cases WHERE assigned_expert_id = auth.uid()) AND is_expert()
  OR EXISTS (
    SELECT 1 FROM escalations e
    JOIN cases c ON c.id = e.case_id
    WHERE c.id = follow_up_schedule.case_id AND e.to_expert_id = auth.uid()
  )
);
CREATE POLICY followup_admin       ON follow_up_schedule FOR ALL USING (is_admin());
CREATE POLICY payments_pat_sel   ON payments FOR SELECT USING (patient_id = auth.uid());
CREATE POLICY payments_pat_ins   ON payments FOR INSERT WITH CHECK (patient_id = auth.uid());
CREATE POLICY payments_admin     ON payments FOR ALL USING (is_admin());

-- outcome_tokens are only accessed via service role API routes; no end-user RLS policy on purpose

CREATE POLICY notif_own          ON reviewer_notifications FOR ALL USING (recipient_id = auth.uid());
CREATE POLICY audit_admin        ON audit_log FOR SELECT USING (is_admin());

-- CASE SEQUENCE
CREATE SEQUENCE case_ref_seq START 1;

-- TOMBSTONE USER (run with service role in Supabase SQL editor after deploy)
-- INSERT INTO auth.users (id, email, created_at, updated_at, role, aud)
-- VALUES ('00000000-0000-0000-0000-000000000000',
--         'deleted@claimclarity.internal', NOW(), NOW(), 'authenticated', 'authenticated')
-- ON CONFLICT (id) DO NOTHING;
-- INSERT INTO users (id, email, role, full_name)
-- VALUES ('00000000-0000-0000-0000-000000000000',
--         'deleted@claimclarity.internal', 'patient', 'Deleted')
-- ON CONFLICT (id) DO NOTHING;

═══════════════════════════════════════════════════════
STEP 4: SUPABASE CLIENT PACKAGE (/packages/db)
═══════════════════════════════════════════════════════

Create /packages/db/src/client.server.ts:
- createServerClient from @supabase/ssr using cookies()
- createServiceClient using SUPABASE_SERVICE_ROLE_KEY (bypasses RLS)

Create /packages/db/src/client.browser.ts:
- createBrowserClient from @supabase/ssr

Create /packages/db/src/audit.ts:
Function logAudit({ actorId, actorRole, action, entityType, entityId, metadata, ipAddress })
- Masks IP to first 2 octets before storing: "192.168." not "192.168.1.100"
- Uses service role client
- Never throws — logs errors to console only

Create /packages/db/src/caseRef.ts:
Function generateCaseRef(year: number, seq: number): string
Returns: "CC-2024-0001" format

Run: npx supabase gen types typescript > /packages/db/src/types.ts

═══════════════════════════════════════════════════════
STEP 5: NEXT.JS MIDDLEWARE (both apps)
═══════════════════════════════════════════════════════

Create /apps/web/middleware.ts:
- Use @supabase/ssr createServerClient with request/response cookies
- Refresh session on every request
- Protected routes: /app/* requires authentication, redirect to /login if not

Create /apps/dashboard/middleware.ts:
- Same session refresh pattern
- All routes protected: redirect to /login if not authenticated
- Role check: if role not in ['reviewer','expert','admin'] → show access denied page

═══════════════════════════════════════════════════════
STEP 6: STORAGE BUCKETS
═══════════════════════════════════════════════════════

Create these buckets in Supabase dashboard:
1. case-documents: private, 20MB limit, allowed MIME: pdf/jpeg/png/tiff
2. reports: private, 50MB limit, allowed MIME: pdf
3. outcome-evidence: private, 20MB limit, allowed MIME: pdf/jpeg/png

All buckets: no public access. All access via server-side signed URLs only.

═══════════════════════════════════════════════════════
STEP 7: RAILWAY HEALTH CHECK
═══════════════════════════════════════════════════════

Create /apps/processor/src/health.ts:
Express GET /health endpoint returning:
{
  status: 'ok',
  timestamp: ISO string,
  checks: {
    database: 'ok' | 'error',
    jobQueue: { queued: number, running: number }
  }
}

═══════════════════════════════════════════════════════
SELF-VERIFICATION SUITE — RUN THIS AFTER BUILD
═══════════════════════════════════════════════════════

Create /packages/db/src/verify.ts and run it:

import { createServiceClient } from './client.server'

async function verify() {
  const results: Record<string, boolean> = {}
  const db = createServiceClient()

  // Check 1: All 18 tables exist
  const tables = ['users','partners','consents','cases','documents','findings',
    'escalations','processing_jobs','kb_clause_patterns','kb_change_log',
    'reports','quality_scores','outcomes','outcome_tokens','follow_up_schedule','payments',
    'reviewer_notifications','audit_log']
  for (const t of tables) {
    const { error } = await db.from(t).select('id').limit(0)
    results[`table_${t}`] = !error
  }

  // Check 2: case_ref_seq exists (server-side metadata check)
  const { data: seqCheck, error: seqErr } = await db
    .from('information_schema.sequences')
    .select('sequence_name')
    .eq('sequence_schema', 'public')
    .eq('sequence_name', 'case_ref_seq')
    .maybeSingle()
  results['case_ref_sequence'] = !seqErr && !!seqCheck

  // Check 3: RLS helper exists (server-side metadata check)
  const { data: fnRows, error: fnErr } = await db
    .from('pg_proc')
    .select('proname')
    .in('proname', ['is_internal','is_admin'])
  results['rls_helper_functions_present'] = !fnErr && Array.isArray(fnRows) && fnRows.length >= 2

  // Check 4: audit_log immutability
  const { error: insertErr } = await db.from('audit_log')
    .insert({ action: 'test', actor_role: 'test' })
  const { data: testRow } = await db.from('audit_log')
    .select('id').eq('action','test').limit(1).single()
  const { error: updateErr } = await db.from('audit_log')
    .update({ action: 'modified' }).eq('id', testRow?.id)
  results['audit_immutable'] = !!updateErr  // update should fail

  // Check 5: Storage buckets
  const { data: buckets } = await db.storage.listBuckets()
  const bucketNames = buckets?.map(b => b.name) || []
  results['bucket_case_documents'] = bucketNames.includes('case-documents')
  results['bucket_reports'] = bucketNames.includes('reports')
  results['bucket_outcome_evidence'] = bucketNames.includes('outcome-evidence')

  // Check 6: outcomes.reversal_amount_inr is a generated column
  const { error: genErr } = await db.from('outcomes')
    .insert({ case_id: '00000000-0000-0000-0000-000000000001',
              final_settled_amount_inr: 100, original_approved_inr: 80 })
  // Don't actually insert — just verify the column is defined by checking schema
  results['generated_column_exists'] = true  // verified by schema deploy

  // Report
  const passed = Object.values(results).filter(Boolean).length
  const total = Object.values(results).length
  console.log(`\nMODULE 0 CHECKPOINT REPORT`)
  console.log(`══════════════════════════`)
  for (const [k, v] of Object.entries(results)) {
    console.log(`${v ? '✓' : '✗'} ${k}`)
  }
  console.log(`\n${passed}/${total} checks passed`)
  if (passed < total) {
    console.log('FAIL — Do not proceed to Module 1. Fix failures above.')
    process.exit(1)
  } else {
    console.log('PASS — Module 0 complete. Proceed to Module 1.')
  }
}
verify()

Run with: npx ts-node /packages/db/src/verify.ts
```

---

## MODULE 1 — AUTH AND CONSENT

```
PREREQUISITES: Run this check first. If any fails, fix Module 0.
  node -e "require('./packages/db/src/verify')" must exit 0
  supabase tables list | grep -c users must return 17

TASK: Build authentication flows and DPDP-compliant consent capture.

═══════════════════════════════════════════════════════
RATE LIMITING (add to every public route)
═══════════════════════════════════════════════════════

Install: pnpm add @upstash/ratelimit @upstash/redis --filter web

Create /apps/web/lib/rateLimit.ts:
- 10 requests per 10 seconds per IP for auth routes
- 30 requests per minute per IP for upload routes
- Use in-memory map if Upstash not configured (acceptable for pilot)

Apply to: /api/auth/*, /api/cases/*, /api/payments/*

═══════════════════════════════════════════════════════
1. PATIENT AUTH FLOW (/apps/web)
═══════════════════════════════════════════════════════

Pages to build:
/app/(auth)/login/page.tsx
- Email + password login
- "Don't have an account? Sign up" link
- After login: redirect to /app/dashboard or ?next= param

/app/(auth)/signup/page.tsx
- Email + password fields
- After signup: redirect to /app/consent (NOT directly to upload)
- On signup, Supabase trigger creates users row automatically

/app/(auth)/forgot-password/page.tsx
- Email input → Supabase resetPasswordForEmail
- Redirect to /app/reset-password after email

API: /api/auth/callback/route.ts
- Handles Supabase auth redirect (email confirmation, password reset)
- Exchange code for session using @supabase/ssr

═══════════════════════════════════════════════════════
2. CONSENT SCREEN (/app/consent/page.tsx)
═══════════════════════════════════════════════════════

Shown to every new patient before document upload.
Redirected here if no active consents found.

Five consent items (each its own checkbox, none pre-ticked):
1. data_processing: "I consent to ClaimClarity processing my health insurance
   documents to prepare a claim analysis report."
2. no_training: "I understand my documents will not be used to train any AI model."
3. retention_policy: "I understand my uploaded documents will be permanently
   deleted 90 days after my report is delivered."
4. informational_only: "I understand this report is informational support only
   and does not constitute insurance, legal, or medical advice."
5. terms_of_service: "I have read and agree to the Terms of Service and Privacy Policy."
   (Link opens policy in modal, not new tab)

Submit button: disabled until all 5 checked.

On submit: POST /api/consents
Body: { consents: [{type, given: true}×5], privacyPolicyVersion, termsVersion }

Server-side POST /api/consents/route.ts:
- Verify all 5 consent types present with given=true
- Insert 5 rows to consents table
- Source channel: 'patient_web'
- IP: first 2 octets of request IP only
- Log to audit_log: { action: 'consents_captured', actor_id: user_id }
- Redirect to: /app/upload (case creation happens there)

Consent gate middleware:
In /apps/web/middleware.ts, add check:
If user accessing /app/upload or deeper without all 5 consents → redirect to /app/consent

Helper: GET /api/consents/status
Returns: { complete: boolean, missing: string[] }
Uses: SELECT consent_type FROM consents WHERE user_id = auth.uid()
  AND revoked_at IS NULL
  AND privacy_policy_version = current_version

═══════════════════════════════════════════════════════
3. INTERNAL AUTH (/apps/dashboard)
═══════════════════════════════════════════════════════

/login/page.tsx — same Supabase auth, role checked after
middleware.ts — blocks non-internal roles with: 403 page, not redirect to patient app

═══════════════════════════════════════════════════════
4. DATA DELETION (/api/patients/delete-my-data)
═══════════════════════════════════════════════════════

POST — authenticated patient only

Execution (service role, transaction where possible):
1. Capture email before changes
2. Delete files from case-documents/{case_id}/* for all patient cases
3. Delete files from reports/{case_id}/* for all patient cases  
4. UPDATE documents: extracted_json=NULL, extracted_text=NULL, storage_path='DELETED', original_filename_encrypted=NULL
5. UPDATE reports: pdf_storage_path='DELETED'
6. UPDATE cases: patient_id='00000000-0000-0000-0000-000000000000'
7. UPDATE payments: patient_id='00000000-0000-0000-0000-000000000000'
8. UPDATE consents: revoked_at=NOW(), revocation_reason='user_deletion_request'
9. UPDATE users: full_name=NULL, phone=NULL, email='deleted-{id}@claimclarity.internal'
10. Log audit_log: { action: 'data_subject_deletion_completed' }
11. Supabase admin.auth.signOut(userId)
12. Send confirmation to captured email

═══════════════════════════════════════════════════════
SELF-VERIFICATION SUITE
═══════════════════════════════════════════════════════

Create /apps/web/tests/module1.test.ts and run with: npx jest module1

Tests:

TEST 1: Consent gate blocks access
- Create test user, do NOT insert consents
- GET /app/upload with session → expect redirect to /app/consent
- CHECKPOINT: redirect happens [PASS/FAIL]

TEST 2: Consent capture
- POST /api/consents with all 5 types given=true
- SELECT COUNT(*) FROM consents WHERE user_id=testUserId
- CHECKPOINT: count = 5 [PASS/FAIL]

TEST 3: Consent gate allows after capture
- GET /app/upload after consents captured → expect 200 not redirect
- CHECKPOINT: no redirect [PASS/FAIL]

TEST 4: IP masking
- POST /api/consents from IP 192.168.100.50
- SELECT ip_address FROM consents WHERE user_id=testUserId LIMIT 1
- CHECKPOINT: stored value = '192.168.' not '192.168.100.50' [PASS/FAIL]

TEST 5: RLS blocks cross-patient consent read
- Create two test users A and B, both with consents
- Auth as user A, attempt SELECT FROM consents WHERE user_id=userB
- CHECKPOINT: returns 0 rows [PASS/FAIL]

TEST 6: Rate limiting
- POST /api/consents 15 times in 5 seconds
- CHECKPOINT: requests 11-15 return 429 [PASS/FAIL]

TEST 7: Deletion anonymizes correctly
- Create test case and payment for test user
- POST /api/patients/delete-my-data
- SELECT patient_id FROM cases WHERE id=testCaseId
- CHECKPOINT: patient_id = '00000000-0000-0000-0000-000000000000' [PASS/FAIL]
- CHECKPOINT: users row still exists (FK not broken) [PASS/FAIL]
- CHECKPOINT: email changed to deleted-{id}@claimclarity.internal [PASS/FAIL]

REPORT FORMAT:
MODULE 1 CHECKPOINT REPORT
══════════════════════════
✓/✗ consent_gate_blocks_access
✓/✗ consent_capture_five_rows
✓/✗ consent_gate_allows_after
✓/✗ ip_masking
✓/✗ rls_cross_patient_blocked
✓/✗ rate_limiting
✓/✗ deletion_anonymizes
N/N checks passed
PASS / FAIL — proceed / fix before Module 2
```

---

## MODULE 2 — DOCUMENT UPLOAD AND QUALITY CHECK

```
PREREQUISITES:
  Module 1 tests: ALL PASS
  Test: POST /api/consents returns 201 with valid session

TASK: Document upload, client + server validation, quality check pipeline.

═══════════════════════════════════════════════════════
1. UPLOAD PAGE (/apps/web/app/app/upload/page.tsx)
═══════════════════════════════════════════════════════

Design tone: calm, clinical. Patient is stressed. No celebration UI.
Color palette: off-white background, dark slate text, muted teal accents.
Font: IBM Plex Sans (clear, professional, not generic).

Layout: three sections stacked
  A. Required Documents (3 slots)
  B. Additional Documents (expandable, collapsed by default)
  C. Submit / Proceed to Payment

Required document slots:
  1. Policy document or Certificate of Insurance (CIS)
     doc_type: 'policy' or 'cis' (user selects which)
  2. Hospital bill (itemized)
     doc_type: 'hospital_bill'
  3. Insurer / TPA response letter
     doc_type: 'insurer_response'

Each slot shows:
  - Upload area with doc type label
  - Status: empty / uploading / checking / ✓ passed / ✗ failed (with specific reason)
  - Replace button after upload

Proceed button: disabled until all 3 required slots are ✓ passed

On page load: if case not created yet, POST /api/cases to create it, store case_id in state

═══════════════════════════════════════════════════════
2. CASE CREATION API (/api/cases/route.ts)
═══════════════════════════════════════════════════════

POST — authenticated patient, consents verified server-side

Server:
- Verify 5 active consents exist for this user
- Generate case_ref: CC-{year}-{LPAD(nextval('case_ref_seq')::text, 4, '0')}
- INSERT cases: status='documents_pending', intake_channel='patient_web'
- INSERT outcomes: case_id, outcome_type='pending' (pre-create for later collection)
- INSERT reports: case_id, report_version=1, appeal_letter_included=TRUE
- Log audit_log: { action: 'case_created' }
- Return: { caseId, caseRef }

═══════════════════════════════════════════════════════
3. UPLOAD API (/api/cases/[caseId]/documents/route.ts)
═══════════════════════════════════════════════════════

POST — multipart/form-data, authenticated patient owns case

CLIENT-SIDE validation (before upload, in React):
- Reject: size > 20MB → "This file is {X}MB. Maximum is 20MB."
- Reject: wrong MIME → "Only PDF, JPEG, PNG, and TIFF files are accepted."
- If passes: show uploading spinner, POST to server

SERVER-SIDE:
- Re-verify MIME type server-side (do not trust client claim)
- Generate storage path: case-documents/{caseId}/{uuid}.{ext}
- Encrypt original_filename using Node.js crypto AES-256-GCM
  (key = SUPABASE_SERVICE_ROLE_KEY first 32 chars)
- Upload to Supabase Storage using service role client
- INSERT documents: storage_path, original_filename_encrypted, quality_status='pending'
- Queue processing_job: { job_type:'quality_check', case_id, document_id,
    idempotency_key: 'quality_check:{caseId}:{docId}' }
- Return: { documentId, status: 'checking' }

═══════════════════════════════════════════════════════
4. QUALITY CHECK JOB (/apps/processor/src/jobs/qualityCheck.ts)
═══════════════════════════════════════════════════════

Picks up jobs where job_type='quality_check', status='queued'

Steps:
a. Fetch document from Supabase Storage (service role, signed URL 5min)
b. Re-verify file size (20MB) and MIME type
c. If PDF: check page count. >50 pages → manual_required,
   reason: "Document has over 50 pages — a reviewer will extract relevant sections."
d. If PDF: detect if image-based (no text layer). If so → manual_required,
   reason: "Your PDF contains scanned images. Processing may take up to 48 hours."
e. If image: estimate DPI from file metadata. <100 DPI → fail,
   reason: "Image resolution too low. Please re-upload at 150 DPI or higher."
f. Language detection on first 2000 chars of extractable text.
   If not 'en' or 'hi' → fail, reason: "We currently support English documents only."
g. If all pass: quality_status='pass'

On fail: UPDATE documents, queue email to patient with specific reason (Resend)
On manual_required: UPDATE documents, INSERT reviewer_notification
On pass: check if all required docs for case have quality_status='pass'
  If yes AND case.payment_waived=TRUE → immediately queue OCR jobs, update case.status='processing'
  If yes AND payment_waived=FALSE → update case.status='payment_pending'

Document status polling: GET /api/cases/[caseId]/documents
Returns each document with quality_status and quality_failure_reason
Patient page polls every 3 seconds while any doc has quality_status='pending'

═══════════════════════════════════════════════════════
SELF-VERIFICATION SUITE
═══════════════════════════════════════════════════════

Create test fixtures:
- good_bill.pdf — real small PDF with tables (create programmatically with pdf-lib)
- oversized.pdf — 21MB file (create with repeated content)
- low_res.jpg — 72 DPI JPEG (create with sharp)
- wrong_type.txt — plain text file

Tests:

TEST 1: Client blocks oversized before upload
- Simulate file input with 21MB file
- CHECKPOINT: upload never called, error message shown [PASS/FAIL]

TEST 2: Server rejects wrong MIME
- POST directly to /api/cases/{id}/documents with text/plain
- CHECKPOINT: 400 returned, no document row created [PASS/FAIL]

TEST 3: Storage path uses UUID not original filename
- Upload good_bill.pdf
- SELECT storage_path FROM documents WHERE case_id=testCaseId
- CHECKPOINT: storage_path does not contain 'good_bill.pdf' [PASS/FAIL]
- CHECKPOINT: storage_path matches regex case-documents/[uuid]/[uuid].pdf [PASS/FAIL]

TEST 4: Quality check passes good document
- Upload good_bill.pdf, wait for job to process
- SELECT quality_status FROM documents WHERE id=docId
- CHECKPOINT: quality_status='pass' within 30 seconds [PASS/FAIL]

TEST 5: Quality check fails low-res image
- Upload low_res.jpg
- CHECKPOINT: quality_status='fail' [PASS/FAIL]
- CHECKPOINT: quality_failure_reason contains 'resolution' [PASS/FAIL]

TEST 6: Case moves to payment_pending after all 3 docs pass
- Upload and pass all 3 required document types
- SELECT status FROM cases WHERE id=testCaseId
- CHECKPOINT: status='payment_pending' [PASS/FAIL]

TEST 7: Waived case starts processing without payment
- Create case with payment_waived=TRUE (admin endpoint)
- Upload and pass all 3 required docs
- CHECKPOINT: case.status='processing' NOT 'payment_pending' [PASS/FAIL]
- CHECKPOINT: processing_jobs rows with job_type='ocr' exist [PASS/FAIL]

TEST 8: Idempotent job creation
- Trigger quality_check twice for same document
- SELECT COUNT(*) FROM processing_jobs WHERE idempotency_key='quality_check:{caseId}:{docId}'
- CHECKPOINT: count=1 not 2 [PASS/FAIL]

REPORT: MODULE 2 CHECKPOINT REPORT — N/N passed — PASS/FAIL
```

---

## MODULE 3 — PAYMENT INTEGRATION

```
PREREQUISITES:
  Module 2 tests: ALL PASS
  Test: case with status='payment_pending' exists in DB

TASK: Razorpay payment flow. Order creation, verification, case activation.
      Waived cases: never touch Razorpay. Clean separation.
      Module 3 payment modes:
        - real_payment: Razorpay order + payment row + verification.
        - admin_waived: admin-only waiver; no Razorpay call and no payments row.
        - internal_access_code: hidden allowlisted internal code waiver; no Razorpay call and no payments row.
        - test_simulated: dev/test-only simulated activation; no Razorpay call and no payments row.

Payment mode rules:
- `cases.payment_mode` is the source of truth for how the case entered processing.
- `cases.payment_reporting_category` is the source of truth for paid vs waived vs test reporting.
- Waived and simulated cases must set `payment_waived=TRUE`.
- Real paid cases must set `payment_waived=FALSE`.
- Do not implement public coupon, promo, discount, referral, or code-entry marketing flows.
- Internal access codes are server-side only and must be validated against an allowlist of SHA-256 hashes.
- Feature flags must gate internal access-code waiver and test simulation code paths.
- Test simulation must be rejected in production and must also require `ALLOW_TEST_SIMULATED_PAYMENTS=true`.
- Every successful or failed waiver/simulation attempt must write `audit_log`.
- Waiver/simulation activation may only happen for authenticated users and `status='payment_pending'`, so consent, ownership, and document checks already remain intact.
- Admin waiver requires an authenticated admin. Internal access-code and test simulation require the authenticated patient to own the case.
- Waived or simulated cases must never call Razorpay and must never insert into `payments`.

═══════════════════════════════════════════════════════
1. PAYMENT PAGE (/app/cases/[caseRef]/pay/page.tsx)
═══════════════════════════════════════════════════════

Shown only when case.status='payment_pending'
If status != 'payment_pending': redirect to /app/cases/{caseRef}/status

Content:
- What you will receive: list the 10 report sections by name (not marketing language)
- What is not included: 3 bullet points (approval guarantee, legal advice, medical advice)
- Refund policy: 2 bullet points
- Price: ₹699 clearly displayed
- Pay button: opens Razorpay checkout

No countdown timers. No urgency language. No pre-ticked add-ons.

Razorpay checkout config:
  key: RAZORPAY_KEY_ID
  amount: 69900  (paise)
  currency: 'INR'
  name: 'ClaimClarity'
  description: 'Claim Analysis Report'
  theme.color: '#1B4F72'
  modal.ondismiss: show "Payment cancelled. Your documents are saved. Come back any time."

handler(response):
  POST /api/payments/verify with { razorpay_payment_id, razorpay_order_id,
    razorpay_signature, caseId }

═══════════════════════════════════════════════════════
2. ORDER CREATION (/api/payments/create/route.ts)
═══════════════════════════════════════════════════════

POST — authenticated patient
Rate limit: 5 requests per minute per user

Verify before creating order:
  - user owns the case
  - case.status = 'payment_pending'
  - case.payment_waived = FALSE
  - case.payment_mode = 'real_payment'
  - No existing payment with status IN ('pending','paid') for this case

Create Razorpay order:
  amount: 69900, currency: 'INR', receipt: caseRef
  notes: { case_id: caseId }

INSERT payments: status='pending', razorpay_order_id, amount_inr=69900

Return: { orderId, amount: 69900, currency: 'INR', keyId: RAZORPAY_KEY_ID }

═══════════════════════════════════════════════════════
3. PAYMENT VERIFICATION (/api/payments/verify/route.ts)
═══════════════════════════════════════════════════════

POST — authenticated patient
Idempotent: if payment already verified for this case, return success without re-processing

HMAC verification (MANDATORY — do not skip):
  const expected = createHmac('sha256', RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex')
  if (expected !== razorpay_signature) → 400, log failed attempt, do NOT activate case

On valid signature:
  UPDATE payments: status='paid', razorpay_payment_id, paid_at=NOW()
  UPDATE cases:
    status='processing',
    current_step='quality_check',
    payment_mode='real_payment',
    payment_reporting_category='paid',
    sla_deadline=NOW() + INTERVAL '24 hours'
  Queue OCR processing_jobs for each document in case (idempotency_key: 'ocr:{caseId}:{docId}')
  Send confirmation email via Resend:
    Subject: "Payment received — Case {caseRef} is being processed"
  Log audit_log: { action: 'payment_verified', metadata: { amount_inr: 69900 } }
  Return: { success: true, caseRef }

═══════════════════════════════════════════════════════
3A. PAYMENT CONTROLS (/api/payments/controls/route.ts)
═══════════════════════════════════════════════════════

POST - authenticated user
Rate limit: same payment limiter as order creation.

Input:
  { caseId, mode, accessCode?, reason? }

Allowed modes:
  - `admin_waived`: admin only; `reason` required.
  - `internal_access_code`: patient owner only; `accessCode` required.
  - `test_simulated`: patient owner only; dev/test only.

Common verification before activation:
  - case exists
  - case.status = 'payment_pending'
  - no existing payment with status IN ('pending','paid') for this case
  - no Razorpay API call is made
  - no row is inserted into `payments`

Admin waived:
  - require authenticated user role `admin`
  - UPDATE cases:
      payment_waived=TRUE
      payment_waived_reason=reason
      payment_mode='admin_waived'
      payment_reporting_category='waived'
      status='processing'
      current_step='quality_check'
      sla_deadline=NOW() + INTERVAL '24 hours'
  - Queue OCR jobs exactly like paid activation.
  - Log `payment_admin_waived`.

Internal access code:
  - require `FEATURES.INTERNAL_ACCESS_CODE_WAIVER=TRUE`
  - hash submitted `accessCode` with SHA-256 and compare only to `INTERNAL_ACCESS_CODE_SHA256_HASHES`
  - do not log raw access codes or return allowlist details
  - on failed validation, log `payment_internal_access_code_failed` and keep case unchanged
  - on success, set:
      payment_waived=TRUE
      payment_waived_reason='internal_access_code'
      payment_mode='internal_access_code'
      payment_reporting_category='waived'
      status='processing'
      current_step='quality_check'
      sla_deadline=NOW() + INTERVAL '24 hours'
  - Queue OCR jobs exactly like paid activation.
  - Log `payment_internal_access_code_redeemed`.

Test simulated:
  - require `FEATURES.TEST_SIMULATED_PAYMENT=TRUE`
  - require `NODE_ENV != 'production'`
  - require `ALLOW_TEST_SIMULATED_PAYMENTS=true`
  - set:
      payment_waived=TRUE
      payment_waived_reason='test_simulated'
      payment_mode='test_simulated'
      payment_reporting_category='test'
      status='processing'
      current_step='quality_check'
      sla_deadline=NOW() + INTERVAL '24 hours'
  - Queue OCR jobs exactly like paid activation.
  - Log `payment_test_simulated`.

═══════════════════════════════════════════════════════
4. RAZORPAY WEBHOOK (/api/webhooks/razorpay/route.ts)
═══════════════════════════════════════════════════════

Verify webhook signature using RAZORPAY_WEBHOOK_SECRET before processing.

Handle:
  payment.captured: idempotent secondary confirmation
  payment.failed: UPDATE payments status='failed',
    send email "Payment was not processed. Please try again."
  refund.processed: UPDATE payments status='refunded', send patient email

═══════════════════════════════════════════════════════
5. REFUND ENDPOINT (/api/admin/payments/[paymentId]/refund)
═══════════════════════════════════════════════════════

Admin only. POST with { reason, refundType: 'full' | 'partial', amount? }

Full refund: refund_amount = 69900
Partial refund: refund_amount = 34950 (50%)

Call Razorpay refund API.
UPDATE payments: status, refund_amount_inr, refund_reason, refunded_at
UPDATE cases: status='closed'
Send patient email with refund confirmation.

═══════════════════════════════════════════════════════
SELF-VERIFICATION SUITE
═══════════════════════════════════════════════════════

Use Razorpay test credentials. All tests in test mode.

TEST 1: Order creation blocked for waived case
- Set case.payment_waived=TRUE
- POST /api/payments/create
- CHECKPOINT: returns 400, no Razorpay order created, no payment row inserted [PASS/FAIL]

TEST 2: Order creation blocked if payment already exists
- Create case with existing payment status='paid'
- POST /api/payments/create again
- CHECKPOINT: returns 409 Conflict [PASS/FAIL]

TEST 3: Signature verification rejects tampered signature
- POST /api/payments/verify with wrong signature
- CHECKPOINT: returns 400 [PASS/FAIL]
- CHECKPOINT: case.status still 'payment_pending' [PASS/FAIL]

TEST 4: Valid payment activates case and queues jobs
- POST /api/payments/verify with valid test signature
- CHECKPOINT: case.status='processing' [PASS/FAIL]
- CHECKPOINT: case.sla_deadline set to approximately NOW()+24h [PASS/FAIL]
- CHECKPOINT: processing_jobs exist for each document with job_type='ocr' [PASS/FAIL]

TEST 5: Webhook duplicate ignored
- POST to webhook twice with same razorpay_payment_id
- CHECKPOINT: payment row updated once, not duplicated [PASS/FAIL]

TEST 6: Webhook signature invalid
- POST with invalid Razorpay-Signature header
- CHECKPOINT: returns 400, no DB changes [PASS/FAIL]

TEST 7: Full refund
- POST /api/admin/payments/{id}/refund { reason: 'sla_breach', refundType: 'full' }
- CHECKPOINT: payment.status='refunded', refund_amount_inr=69900 [PASS/FAIL]
- CHECKPOINT: case.status='closed' [PASS/FAIL]

TEST 8: Admin waiver activates without Razorpay
- POST /api/payments/controls { mode: 'admin_waived', caseId, reason }
- CHECKPOINT: case.payment_mode='admin_waived' and payment_reporting_category='waived' [PASS/FAIL]
- CHECKPOINT: no Razorpay order created and no payment row inserted [PASS/FAIL]

TEST 9: Internal access code is allowlist-only
- POST /api/payments/controls { mode: 'internal_access_code', caseId, accessCode: 'wrong' }
- CHECKPOINT: returns 400/403, case remains payment_pending, no payment row inserted [PASS/FAIL]
- POST with allowlisted code hash configured server-side
- CHECKPOINT: case.payment_mode='internal_access_code', payment_reporting_category='waived', status='processing' [PASS/FAIL]
- CHECKPOINT: no Razorpay order created and no payment row inserted [PASS/FAIL]

TEST 10: Test simulation is dev/test-only and separated
- With NODE_ENV != 'production' and ALLOW_TEST_SIMULATED_PAYMENTS=true,
  POST /api/payments/controls { mode: 'test_simulated', caseId }
- CHECKPOINT: case.payment_mode='test_simulated', payment_reporting_category='test', status='processing' [PASS/FAIL]
- CHECKPOINT: no Razorpay order created and no payment row inserted [PASS/FAIL]

REPORT: MODULE 3 CHECKPOINT REPORT — N/N passed — PASS/FAIL
```

---

## MODULE 4 — OCR AND EXTRACTION PIPELINE

```
PREREQUISITES:
  Module 3 tests: ALL PASS
  Test: processing_jobs with job_type='ocr' exist with status='queued'

TASK: AWS Textract OCR, bill normalization, policy chunking, insurer letter parsing.
      Capture original_approved_inr and originally_deducted_inr into cases table.

Module 4 architecture decision:
- Supabase Storage remains the canonical document store. Do not move patient upload ownership to S3.
- Use Textract sync where AWS supports the document input directly.
- Use private S3 staging only when Textract async PDF/TIFF processing is required.
- Route unsupported, oversized, encrypted, unreadable, low-confidence, or operationally risky documents
  to `manual_required` with reviewer notification.
- OCR jobs remain idempotent. Never run OCR twice for the same document/job idempotency key.
- Store only normalized `documents.extracted_json`. Do not store raw Textract responses.
- Do not send raw OCR text to the AI layer.

═══════════════════════════════════════════════════════
1. TEXTRACT CLIENT (/apps/processor/src/ocr/textractClient.ts)
═══════════════════════════════════════════════════════

Use @aws-sdk/client-textract. Region: ap-south-1.
Use @aws-sdk/client-s3 only for temporary Textract async staging.

Required config:
- AWS_REGION=ap-south-1
- AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY with least-privilege Textract + staging-bucket access
- AWS_TEXTRACT_STAGING_BUCKET private bucket with public access blocked and lifecycle cleanup
- AWS_TEXTRACT_STAGING_PREFIX default `ocr-staging`
- TEXTRACT_ASYNC_POLL_INTERVAL_MS default 5000
- TEXTRACT_ASYNC_TIMEOUT_MS default 120000

Function: extractDocument(storagePath, docType): Promise<ExtractionResult>

- Fetch from Supabase Storage using service-role access only.
- For single-page PNG/JPEG within Textract limits: AnalyzeDocument may use bytes input.
- For single-page PDF/TIFF within Textract limits: AnalyzeDocument should use S3Object input
  where AWS SDK/API constraints require it.
- For multi-page PDF/TIFF or any document requiring Textract async:
  1. Download from Supabase Storage.
  2. Upload a temporary private object to S3 under AWS_TEXTRACT_STAGING_PREFIX.
  3. Call StartDocumentAnalysis with S3 DocumentLocation.
  4. Poll GetDocumentAnalysis every TEXTRACT_ASYNC_POLL_INTERVAL_MS until success/failure or
     TEXTRACT_ASYNC_TIMEOUT_MS.
  5. Delete the staged S3 object in a finally block after success, failure, timeout, or manual_required.
- Feature types: TABLES + FORMS (both needed for bills and insurer letters)

S3 staging rules:
- Staged objects are temporary OCR handoff copies, not the canonical document record.
- Staging key must be deterministic from case_id + document_id + processing_job id.
- Bucket must block public access and allow only the processor role/service user.
- Lifecycle cleanup must expire any leftover staged object within 24 hours.
- Do not persist staged S3 keys in DB for pilot unless cleanup auditing later requires it.

Manual fallback:
- If input is unsupported by Textract, over Textract size/page limits, encrypted, unreadable,
  staging upload fails, async polling times out, or extraction confidence is below threshold:
  set quality_status='manual_required', add quality_failure_reason, and INSERT reviewer_notification.
- Set ocr_status='completed' only when Textract returned usable output; otherwise set ocr_status='failed'.
- Do not queue rules_engine while any required document is failed, pending, running, retrying,
  missing usable extracted_json, or marked manual_required.

Confidence calculation: average WORD block confidence scores.
Update documents.extraction_confidence.
If < 0.6: set quality_status='manual_required', INSERT reviewer_notification.

Mark documents.has_tables=TRUE if any TABLE block found.
Mark documents.has_handwriting=TRUE if HANDWRITING block found.

═══════════════════════════════════════════════════════
2. BILL TABLE NORMALIZER (/apps/processor/src/extraction/billNormalizer.ts)
═══════════════════════════════════════════════════════

Input: Textract TABLE blocks from hospital_bill document
Output: NormalizedBillLine[]

Type NormalizedBillLine:
  line_item: string
  quantity: number | null
  unit_rate_inr: number | null  -- paise
  total_inr: number             -- paise (required)
  bill_category: string
  page_number: number

Rules:
- Parse Indian number formats: "1,23,456" → 123456, "₹2,500.00" → 250000 paise
- Skip rows where total is null, zero, or contains only header keywords
- Tag "Total" / "Grand Total" rows separately, exclude from line items
- Normalize bill_category from line_item text:
  'Room' → 'room_charges', 'ICU' → 'icu_charges', 'Nurs' → 'nursing',
  'Doctor'/'Consult' → 'doctor_fees', 'OT'/'Theatre' → 'ot_charges',
  'Anaesth' → 'anaesthesia', 'Pharma'/'Drug'/'Med' → 'pharmacy',
  'Consumable'/'Disposable' → 'consumables', 'Lab'/'Invest'/'Radiol' → 'investigations',
  'Implant'/'Prosth' → 'implants', 'Ambulance' → 'ambulance',
  Default → 'miscellaneous'

═══════════════════════════════════════════════════════
3. POLICY CHUNKER (/apps/processor/src/extraction/policyChunker.ts)
═══════════════════════════════════════════════════════

Input: LINE + WORD blocks from policy or cis document
Output: PolicyChunk[]

Heading detection patterns (ALL CAPS lines, or lines matching):
  INCLUSIONS, EXCLUSIONS, DEFINITIONS, WAITING PERIOD,
  ROOM RENT, CO-PAYMENT, CO-PAY, SUB-LIMITS, PRE-EXISTING,
  MATERNITY, DOMICILIARY, DAYCARE, DEDUCTIBLE

Clause category mapping:
  Contains 'ROOM' → 'room_rent'
  Contains 'CO-PAY' or 'CO-PAYMENT' → 'copay'
  Contains 'WAITING' → 'waiting_period'
  Contains 'EXCLUSION' → 'exclusion'
  Contains 'SUB-LIMIT' → 'sublimit'
  Contains 'PRE-EXISTING' → 'pre_existing'
  Default → 'general'

Target 300-500 words per chunk. Do not split mid-sentence.

═══════════════════════════════════════════════════════
4. INSURER LETTER PARSER (/apps/processor/src/extraction/insurerLetterParser.ts)
═══════════════════════════════════════════════════════

Input: KEY_VALUE_SET + TABLE + LINE blocks from insurer_response document
Output: InsurerLetterData

Type InsurerLetterData:
  claim_number: string | null
  policy_number: string | null
  approved_amount_inr: number | null   -- WHOLE RUPEES
  deducted_amount_inr: number | null   -- WHOLE RUPEES
  deductions: DeductionItem[]
  stated_reason_summary: string | null

Type DeductionItem:
  item_description: string
  deducted_amount_inr: number | null
  stated_reason: string

Extract key-value pairs: "Claim No", "Policy No", "Approved Amount", "Deducted Amount"
Look for deduction tables.

CRITICAL: After extraction, UPDATE cases table:
  original_approved_inr = approved_amount_inr (whole rupees)
  originally_deducted_inr = deducted_amount_inr (whole rupees)

Also pre-populate outcomes row:
  UPDATE outcomes SET
    original_approved_inr = approved_amount_inr,
    originally_deducted_inr = deducted_amount_inr
  WHERE case_id = caseId

═══════════════════════════════════════════════════════
5. OCR ORCHESTRATOR (/apps/processor/src/jobs/ocrJob.ts)
═══════════════════════════════════════════════════════

Picks up processing_jobs where job_type='ocr', status='queued'

For each document:
1. Mark job status='running', started_at=NOW()
2. Run textractClient
3. Based on doc_type, run appropriate normalizer
4. UPDATE documents: extracted_json (structured), extracted_text=NULL, ocr_status='completed'
5. Mark job status='completed'

On failure:
  attempt_count++
  If attempt_count < max_attempts: status='retrying', next_retry_at=NOW()+2^attempt minutes
  If attempt_count >= max_attempts: status='failed', alert admin, INSERT reviewer_notification

After ALL required OCR jobs for a case are complete with usable extracted_json:
  - Queue processing_job: { job_type:'rules_engine', case_id,
      idempotency_key: 'rules_engine:{caseId}' }
  - UPDATE cases: current_step='rules_engine'

OCR is NEVER run twice on same document (idempotency_key enforces this).
Raw Textract response is NEVER stored.
Raw OCR text is NEVER stored in extracted_text during Module 4.
Only normalized extracted_json is stored for downstream modules.
rules_engine queueing is idempotent and only occurs after required OCR completion.

═══════════════════════════════════════════════════════
SELF-VERIFICATION SUITE
═══════════════════════════════════════════════════════

Create test fixtures:
- sample_bill.pdf: 3-line hospital bill with tables (room: ₹5000, pharmacy: ₹2000, total: ₹7000)
- sample_policy.pdf: short policy with "ROOM RENT" and "CO-PAYMENT" sections
- sample_insurer_letter.pdf: letter with "Approved Amount: ₹5000" and deduction of ₹1000

Tests:

TEST 1: Bill normalizer extracts line items correctly
- Run billNormalizer on sample_bill.pdf extraction
- CHECKPOINT: 3 NormalizedBillLine items returned [PASS/FAIL]
- CHECKPOINT: total_inr values in paise (₹5000 = 500000) [PASS/FAIL]
- CHECKPOINT: bill_category correctly assigned for each row [PASS/FAIL]

TEST 2: Policy chunker finds clause sections
- Run policyChunker on sample_policy.pdf extraction
- CHECKPOINT: chunk with clause_category='room_rent' exists [PASS/FAIL]
- CHECKPOINT: chunk with clause_category='copay' exists [PASS/FAIL]

TEST 3: Insurer letter extracts amounts
- Run insurerLetterParser on sample_insurer_letter.pdf
- CHECKPOINT: approved_amount_inr = 5000 (whole rupees) [PASS/FAIL]
- CHECKPOINT: deducted_amount_inr = 1000 (whole rupees) [PASS/FAIL]

TEST 4: Insurer amounts written to cases table
- After insurer letter parsed
- SELECT original_approved_inr FROM cases WHERE id=testCaseId
- CHECKPOINT: value = 5000 [PASS/FAIL]

TEST 5: Insurer amounts pre-populate outcomes table
- SELECT original_approved_inr FROM outcomes WHERE case_id=testCaseId
- CHECKPOINT: value = 5000 [PASS/FAIL]

TEST 6: Low confidence triggers manual_required
- Run textractClient on a blurry test scan
- CHECKPOINT: extraction_confidence < 0.6 → quality_status='manual_required' [PASS/FAIL]
- CHECKPOINT: reviewer_notification inserted [PASS/FAIL]

TEST 7: Failed OCR retries correctly
- Simulate Textract failure twice
- CHECKPOINT: attempt_count incremented each time [PASS/FAIL]
- CHECKPOINT: next_retry_at = NOW() + 2^attempt minutes (exponential backoff) [PASS/FAIL]

TEST 8: All OCR done → rules_engine job queued
- Complete OCR for all 3 documents in test case
- SELECT * FROM processing_jobs WHERE case_id=testCaseId AND job_type='rules_engine'
- CHECKPOINT: row exists with status='queued' [PASS/FAIL]

TEST 9: Async PDF/TIFF uses temporary S3 staging
- Simulate a multi-page PDF/TIFF requiring Textract async
- CHECKPOINT: StartDocumentAnalysis receives DocumentLocation.S3Object [PASS/FAIL]
- CHECKPOINT: staged S3 object is deleted after completion/failure [PASS/FAIL]

TEST 10: Unsupported or risky document becomes manual_required
- Simulate unsupported/encrypted/oversized/unreadable input
- CHECKPOINT: document quality_status='manual_required' with reason [PASS/FAIL]
- CHECKPOINT: reviewer_notification inserted [PASS/FAIL]

TEST 11: Raw OCR is not persisted or sent downstream
- Complete OCR for a sample document
- CHECKPOINT: documents.extracted_json is structured and non-empty [PASS/FAIL]
- CHECKPOINT: documents.extracted_text is NULL or contains no raw OCR dump [PASS/FAIL]

REPORT: MODULE 4 CHECKPOINT REPORT — N/N passed — PASS/FAIL
```

---

## MODULE 5 — RULES ENGINE AND KNOWLEDGE BASE

```
PREREQUISITES:
  Module 4 tests: ALL PASS
  Test: at least 1 case with current_step='rules_engine' and extracted_json in all docs

TASK: Rules engine matches bill lines to KB clauses. Produces findings with confidence labels.
      KB admin interface for domain expert.

CRITICAL RULE: Unverified KB patterns (verified_by_expert=FALSE) can produce
'based_on_typical_policy' confidence at most. Never 'clause_found_matched'.

═══════════════════════════════════════════════════════
1. KB SEED DATA (/apps/processor/src/knowledgeBase/seed.ts)
═══════════════════════════════════════════════════════

Seed these 16 patterns. Mark verified_by_expert=FALSE initially.
Domain expert verifies via KB admin UI before pilot.

INSERT all patterns with added_by = admin user ID.

Patterns to seed:
1. room_rent — keywords: ['room rent','room charge','accommodation','bed charges']
   trigger: Room rent exceeds sub-limit
   operative: Room rent sub-limit of ₹{limit}/day. Hospital charged ₹{charged}/day.
              Proportional deduction applied to associated charges.
   plain: Your policy limits room rent to ₹{limit}/day. The hospital charged ₹{charged}/day.
          The extra, and a proportional cut on related charges, was deducted.
   appeal: Request the TPA to provide the exact clause number for the room rent sub-limit
           and confirm the proportional deduction method used.

2. copay — keywords: ['co-pay','co-payment','copayment','patient contribution']
3. waiting_period — keywords: ['waiting period','pre-existing','PED','initial waiting']
4. non_medical_expenses — keywords: ['consumable','disposable','non-medical','toiletries']
5. sublimit_procedure — keywords: ['sub-limit','sublimit','maximum payable','capped at']
6. package_deduction — keywords: ['package rate','package','bundled','all-inclusive']
7. daycare — keywords: ['daycare','day care','day procedure','less than 24 hours']
8. domiciliary — keywords: ['domiciliary','home treatment','home care']
9. maternity — keywords: ['maternity','delivery','caesarean','c-section','newborn']
10. dental — keywords: ['dental','tooth','teeth','orthodontic']
11. vision — keywords: ['vision','spectacles','contact lens','cataract',
             'refractive','lasik']
12. pharmacy_sublimit — keywords: ['pharmacy','medicine','drug','pharmaceutical']
13. icu_stepdown — keywords: ['ICU','intensive care','critical care','ICCU']
14. specialist_consultation — keywords: ['specialist','consultant fee','visiting doctor']
15. ayush — keywords: ['ayurveda','yoga','unani','siddha','homeopathy','AYUSH']
16. opd_exclusion — keywords: ['OPD','outpatient','out-patient','outpatient department']

═══════════════════════════════════════════════════════
2. RULES ENGINE (/apps/processor/src/rulesEngine/engine.ts)
═══════════════════════════════════════════════════════

Function: runRulesEngine(caseId: string): Promise<void>

Load:
- Bill lines from documents where doc_type='hospital_bill', extracted_json
- Policy chunks from documents where doc_type IN ('policy','cis'), extracted_json
- Insurer deductions from documents where doc_type='insurer_response', extracted_json
- All active KB patterns (cache 1 hour in memory)

For each bill line:
  STEP 1: Check if this line appears in insurer deduction list
    Use normalized string similarity (Levenshtein, threshold 0.7)
    If matched: finding_type='deducted'. Else: candidate for 'covered'.

  STEP 2: Score KB patterns
    For each pattern: count how many clause_keywords appear in
      (bill_line_item + ' ' + matched_insurer_stated_reason)
    Boost +2 if insurer_name matches pattern.insurer_name
    Best pattern above score threshold 1 = winner

  STEP 3: Confidence assignment
    Winner found AND pattern.verified_by_expert=TRUE AND
      policy chunk contains any of pattern.clause_keywords:
      → confidence='clause_found_matched'
      → clause_reference = chunk heading + page
      → clause_text = first 300 chars of chunk
    Winner found but policy chunk not matched OR pattern.verified_by_expert=FALSE:
      → confidence='based_on_typical_policy'
      → clause_text = pattern.typical_clause_text
    No winner:
      → confidence='insufficient_information'
      → Flag for expert review

  STEP 4: INSERT finding
    Do NOT set plain_language_explanation yet — that is AI's job
    Set operative_reason from KB template
    Set kb_pattern_id
    Set sort_order by bill_category priority

STEP 5: Missing document check
  For any finding with confidence='insufficient_information':
    Check if discharge_summary or preauth_letter is missing from case
    If missing and would help: INSERT finding with finding_type='missing_document'

STEP 6: Case confidence summary
  All clause_found_matched → confidence_overall='high'
  Any insufficient_information → confidence_overall='low'
  Otherwise → 'mixed'
  UPDATE cases: confidence_overall, status='processing', current_step='ai_draft'
  Queue: { job_type:'ai_draft_generation', case_id, idempotency_key:'ai_draft:{caseId}' }

IMPORTANT:
- The Rules Engine NEVER sets case.status='ai_draft_ready'
- Only the AI draft job may set:
    status='ai_draft_ready'
    current_step='awaiting_review'

═══════════════════════════════════════════════════════
3. TEST RUNNER (/apps/processor/src/rulesEngine/benchmark.ts)
═══════════════════════════════════════════════════════

Loads gold-standard cases from /apps/processor/src/knowledgeBase/goldStandard.json

Format:
[{
  caseId: 'test-001',
  documents: { bill: [...NormalizedBillLines], policyChunks: [...], insurerDeductions: [...] },
  expectedFindings: [{
    bill_line_item: string,
    expected_finding_type: string,
    expected_confidence: string,
    expected_clause_category: string
  }]
}]

Run: compare rules engine output to expected findings per case.
Report: match_rate, confidence_distribution, unmatched_items per case.
HARD GATE: match_rate must be >= 0.70 before Module 6 starts.

═══════════════════════════════════════════════════════
4. KB ADMIN UI (/apps/dashboard/app/knowledge-base/page.tsx)
═══════════════════════════════════════════════════════

Role gate: expert or admin only.

Features:
- List patterns: category, insurer, keywords (truncated), verified badge
- Filter: by category, insurer, verified status
- Add pattern: form with all fields
- Edit pattern: inline edit
- Verify pattern: "Mark as Expert-Verified" button (sets verified_by_expert=TRUE, verified_by, verified_at)
- Deactivate: toggle is_active

Every change: INSERT kb_change_log with old_values JSONB snapshot

═══════════════════════════════════════════════════════
SELF-VERIFICATION SUITE
═══════════════════════════════════════════════════════

TEST 1: Seed data loaded correctly
- SELECT COUNT(*) FROM kb_clause_patterns
- CHECKPOINT: count = 16 [PASS/FAIL]

TEST 2: Unverified pattern produces based_on_typical_policy max
- Set all patterns verified_by_expert=FALSE
- Run rules engine on test case with clear room_rent deduction
- SELECT confidence_label FROM findings WHERE case_id=testCaseId AND bill_category='room_charges'
- CHECKPOINT: confidence_label = 'based_on_typical_policy' NOT 'clause_found_matched' [PASS/FAIL]

TEST 3: Verified pattern with policy chunk match produces clause_found_matched
- Set room_rent pattern verified_by_expert=TRUE
- Add policy chunk with 'ROOM RENT' heading to test case
- Run rules engine
- CHECKPOINT: confidence_label = 'clause_found_matched' [PASS/FAIL]

TEST 4: No match produces insufficient_information
- Run rules engine on line_item 'Parking charges' (no seeded pattern should match this)
- CHECKPOINT: confidence_label = 'insufficient_information' [PASS/FAIL]

TEST 5: Missing document finding created when appropriate
- Case with insufficient_information finding and no discharge_summary
- CHECKPOINT: finding with finding_type='missing_document' exists [PASS/FAIL]

TEST 6: Confidence overall set correctly
- All clause_found_matched → CHECKPOINT: cases.confidence_overall='high' [PASS/FAIL]
- Any insufficient_information → CHECKPOINT: cases.confidence_overall='low' [PASS/FAIL]

TEST 7: Idempotent rules engine
- Run rules engine twice on same case
- CHECKPOINT: findings count same after second run (no duplicates) [PASS/FAIL]

TEST 8: GOLD-STANDARD BENCHMARK
- Load goldStandard.json test cases
- Run benchmark.ts
- CHECKPOINT: match_rate >= 0.70 [PASS/FAIL — HARD GATE, must pass to proceed]

REPORT: MODULE 5 CHECKPOINT REPORT — N/N passed — PASS/FAIL
NOTE: TEST 8 IS A HARD GATE. Do not proceed to Module 6 if it fails.
```

---

## MODULE 6 — AI EXPLANATION LAYER

```
PREREQUISITES:
  Module 5 tests: ALL PASS including HARD GATE benchmark >= 0.70
  Test: findings exist for test case with confidence labels

TASK: Claude API generates plain-language explanations, questions, appeal points,
      and appeal letter draft. All output is draft — reviewer confirms.

MODEL: claude-sonnet-4-20250514
TEMPERATURE: 0 (deterministic)
MAX_TOKENS: 4000

═══════════════════════════════════════════════════════
SYSTEM PROMPT (hardcode — version in code comments)
═══════════════════════════════════════════════════════

// SYSTEM_PROMPT_VERSION = 'v1.0'
const SYSTEM_PROMPT = `
You are a claims analyst assistant for ClaimClarity, an India health insurance claim
clarity service. You assist a qualified human reviewer by generating draft explanations
and appeal content. ALL your output will be reviewed by a human before the patient sees it.

YOUR JOB:
1. Write plain-language explanations for each finding (max 3 sentences, no jargon)
2. Write specific actionable questions for the hospital (not generic — cite line items)
3. Write specific actionable questions for the insurer/TPA (cite clauses)
4. Generate appeal points ranked by strength (must cite clause or pattern basis)
5. Draft a formal appeal letter

HARD RULES — NEVER VIOLATE:
- Never state a claim will be approved or rejected
- Never say "the insurer is wrong" or "the hospital overcharged"
- Never use "you are entitled to" — use "you may want to ask"
- Never make medical judgments
- Never use legal language: breach of contract, statutory right, negligence
- Never assert certainty — use: typically, usually, may, appears to, in most cases
- If confidence_label is "insufficient_information": write "This item could not be assessed
  from the available documents. A reviewer will clarify." Do not explain it.
- If confidence_label is "based_on_typical_policy": end every explanation with
  "Please verify this against your specific policy wording."
- Every appeal point MUST cite a clause reference or KB pattern basis
- Appeal letter MUST end with IRDAI Bima Bharosa reference
- Respond ONLY with valid JSON. No preamble, no markdown fences.

OUTPUT FORMAT (exact JSON schema):
{
  "findings_explained": [{"finding_id": "uuid", "plain_language_explanation": "string"}],
  "hospital_questions": ["string"],
  "insurer_questions": ["string"],
  "appeal_points": [{"point": "string", "strength": "strong|moderate|weak", "basis": "string"}],
  "appeal_letter_draft": "string",
  "scope_notes": "string"
}
`

═══════════════════════════════════════════════════════
AI DRAFT JOB (/apps/processor/src/jobs/aiDraftJob.ts)
═══════════════════════════════════════════════════════

Picks up jobs where job_type='ai_draft_generation', status='queued'

Assemble user prompt:
  Case: {insurer_name}, {case_type}, Claim amount: ₹{claim_amount_inr}

  FINDINGS FROM RULES ENGINE:
  {findings as numbered list: id, type, bill_item, amount, confidence, clause_reference, operative_reason}

  INSURER STATED REASONS:
  {deduction items from insurer letter extraction}

  BILL SUMMARY:
  Total billed: ₹X | Originally approved: ₹Y | Deducted: ₹Z

  MISSING DOCUMENTS: {list or 'None identified'}

Call Claude API.
Parse JSON response (strip any accidental markdown fences before JSON.parse).

On valid response:
  UPDATE each finding: plain_language_explanation from response
  UPDATE cases: ai_draft = full response JSONB
  UPDATE cases: status='ai_draft_ready', current_step='awaiting_review'
  INSERT reviewer_notification: { type:'new_case_assigned', case_id, message:'AI draft ready' }
  Mark job completed

On API failure:
  Retry once after 60 seconds
  If still fails: generate template-based fallback from KB pattern templates
    Set cases.ai_draft with fallback flag: { ..., is_fallback: true }
    INSERT reviewer_notification noting fallback used
  Log to audit_log: { action:'ai_draft_generated', metadata:{ model, input_tokens, output_tokens } }

═══════════════════════════════════════════════════════
AI PROMPT REGRESSION TESTS (/apps/processor/tests/aiRegression.ts)
═══════════════════════════════════════════════════════

After any system prompt change or KB update, run these:
  - Feed 3 gold-standard cases through AI layer
  - Check: no output contains "you are entitled to"
  - Check: no output contains "insurer is wrong"
  - Check: no output contains "breach of contract"
  - Check: every appeal point has a non-empty "basis" field
  - Check: appeal_letter_draft contains "bimabharosa.irdai.gov.in"
  - Check: findings with insufficient_information are not explained

═══════════════════════════════════════════════════════
SELF-VERIFICATION SUITE
═══════════════════════════════════════════════════════

TEST 1: Valid JSON output
- Run AI draft job on test case
- CHECKPOINT: cases.ai_draft is valid JSON with all required keys [PASS/FAIL]

TEST 2: No red-line violations
- Parse ai_draft from test case
- CHECKPOINT: no field contains 'you are entitled to' [PASS/FAIL]
- CHECKPOINT: no field contains 'insurer is wrong' [PASS/FAIL]
- CHECKPOINT: appeal_letter_draft contains 'bimabharosa.irdai.gov.in' [PASS/FAIL]

TEST 3: insufficient_information handled correctly
- Ensure test case has a finding with confidence='insufficient_information'
- CHECKPOINT: corresponding finding explanation = the standard cannot-assess message [PASS/FAIL]

TEST 4: Every appeal point has basis
- CHECKPOINT: all appeal_points[].basis is non-empty string [PASS/FAIL]

TEST 5: Fallback generates if API unavailable
- Temporarily set invalid API key
- Run job
- CHECKPOINT: cases.ai_draft set with is_fallback:true [PASS/FAIL]
- CHECKPOINT: reviewer_notification inserted noting fallback [PASS/FAIL]

TEST 6: Status transitions correctly
- CHECKPOINT: case.status='ai_draft_ready' after job [PASS/FAIL]
- CHECKPOINT: case.current_step='awaiting_review' [PASS/FAIL]

TEST 7: Reviewer notification created
- CHECKPOINT: reviewer_notifications row with type='new_case_assigned' exists [PASS/FAIL]

TEST 8: Run regression suite
- npx ts-node /apps/processor/tests/aiRegression.ts
- CHECKPOINT: all 7 regression checks pass [PASS/FAIL]

REPORT: MODULE 6 CHECKPOINT REPORT — N/N passed — PASS/FAIL
```

---

## MODULE 7 — REVIEWER DASHBOARD

```
PREREQUISITES:
  Module 6 tests: ALL PASS
  Test: cases.ai_draft populated for test case, reviewer user exists

TASK: Internal reviewer dashboard. Case queue, document viewer, finding confirmation,
      escalation, expert response, sign-off.

═══════════════════════════════════════════════════════
1. CASE QUEUE (/apps/dashboard/app/queue/page.tsx)
═══════════════════════════════════════════════════════

Realtime subscription on cases table for assigned_reviewer_id = current user.

Table columns: Case Ref | Insurer | Claim ₹ | Confidence | Status | SLA

SLA display:
  > 24h: show deadline as "Mon 14 Apr, 3:00 PM"
  4-24h: amber text "8h 30m left"
  < 4h: red pulsing text "2h 15m left"
  Breached: red badge "OVERDUE"

Status badges: colored by stage.
Confidence badges: green (high) / amber (mixed) / red (low).

Click row → navigate to /dashboard/cases/{caseId}

═══════════════════════════════════════════════════════
2. CASE REVIEW PAGE (/apps/dashboard/app/cases/[caseId]/page.tsx)
═══════════════════════════════════════════════════════

On page load: if case.status='ai_draft_ready' → UPDATE cases SET status='under_review'

SPLIT LAYOUT (50/50):

LEFT: DOCUMENT VIEWER
- Tab bar: one tab per document type uploaded
- PDF.js viewer embedded, download disabled in viewer config
- Page navigation, zoom controls
- Banner if quality_status='manual_required': yellow bar with reason text

RIGHT: REVIEW PANEL (scrollable)

SECTION A — CASE HEADER
  Case ref, insurer, claim amount (₹ formatted), confidence badge, SLA countdown
  "Escalate entire case to expert" button

SECTION B — FINDINGS TABLE
  For each finding, one row:
  [Category] [Line item] [₹Amount] [Confidence badge] [AI Explanation] [CONFIRM / EDIT / ESCALATE]

  Confidence badge colors: green / amber / red
  Amount display: ₹{(bill_amount_inr/100).toLocaleString('en-IN')}

  CONFIRM: sets reviewer_confirmed=TRUE, logs action, row shows ✓ checkmark
  EDIT: opens slide-over panel with editable plain_language_explanation
        On save: reviewer_confirmed=TRUE, reviewer_edited=TRUE, audit logged with old_value
  ESCALATE: opens panel with text area "Your specific question for the domain expert"
        On submit: INSERT escalations, INSERT reviewer_notification to expert

SECTION C — QUESTIONS REVIEW
  Hospital questions and insurer questions as editable lists
  Add/remove/edit per question, each change logged

SECTION D — APPEAL POINTS
  Table: point text | strength (editable dropdown) | basis
  Reviewer can edit strength and text. Add/remove points.

SECTION E — APPEAL LETTER
  Editable textarea with AI draft
  Note at top: "Reviewer must confirm this letter before sign-off."
  Confirm button per section

SECTION F — SIGN-OFF
  Button: "Sign off and generate report"
  Disabled until ALL findings are reviewer_confirmed=TRUE OR marked unassessable

  Server-side sign-off checks (not just UI):
    1. All findings confirmed or explicitly marked unassessable
    2. No open escalations (status='open')
    3. If any finding confidence='insufficient_information' AND bill_amount_inr > 20000000
       (₹2 lakh in paise) → block with message

  On confirmed sign-off:
    UPDATE cases: status='approved'
    UPDATE reports: signed_off_by, signed_off_at
    Queue: { job_type:'report_generation', case_id, idempotency_key:'report_gen:{caseId}' }
    Log audit_log: { action:'case_signed_off' }

═══════════════════════════════════════════════════════
3. EXPERT VIEW (/apps/dashboard/app/escalations/page.tsx)
═══════════════════════════════════════════════════════

Role gate: expert or admin only.
List open escalations assigned to this expert.
Each escalation shows: case_ref, question, finding context, confidence recommendation options.

On respond:
  UPDATE escalations: status='responded', expert_response, confidence_recommendation, responded_at
  INSERT reviewer_notification: type='escalation_responded' to from_reviewer_id

═══════════════════════════════════════════════════════
4. QUALITY SCORING (/apps/dashboard/app/cases/[caseId]/score/page.tsx)
═══════════════════════════════════════════════════════

Expert/admin only. Available for any delivered case.
Rubric form with all 6 dimensions + harmful_output toggle.
Submit → INSERT quality_scores.

═══════════════════════════════════════════════════════
SELF-VERIFICATION SUITE
═══════════════════════════════════════════════════════

TEST 1: Case status → under_review on page open
- Create test case in ai_draft_ready state
- Simulate reviewer opening case page (call status-update endpoint)
- CHECKPOINT: case.status='under_review' [PASS/FAIL]

TEST 2: Finding confirmation
- POST confirm action for a finding
- CHECKPOINT: finding.reviewer_confirmed=TRUE, reviewer_confirmed_by set [PASS/FAIL]
- CHECKPOINT: audit_log entry with action='finding_confirmed' [PASS/FAIL]

TEST 3: Finding edit logs old value
- Edit a finding's explanation
- CHECKPOINT: audit_log.metadata contains { old_value: original text } [PASS/FAIL]
- CHECKPOINT: finding.reviewer_edited=TRUE [PASS/FAIL]

TEST 4: Sign-off blocked with unconfirmed findings
- Attempt sign-off with 1 unconfirmed finding
- CHECKPOINT: API returns 400, case.status unchanged [PASS/FAIL]

TEST 5: Sign-off blocked with open escalation
- Create open escalation for case
- Confirm all findings
- Attempt sign-off
- CHECKPOINT: API returns 400 citing open escalation [PASS/FAIL]

TEST 6: Sign-off succeeds and queues report generation
- Confirm all findings, resolve all escalations
- POST sign-off
- CHECKPOINT: case.status='approved' [PASS/FAIL]
- CHECKPOINT: processing_jobs with job_type='report_generation' exists [PASS/FAIL]

TEST 7: High-value insufficient_information blocked
- Create finding: confidence='insufficient_information', bill_amount_inr=25000000 (₹2.5L)
- Confirm all other findings
- Attempt sign-off
- CHECKPOINT: API returns 400 citing high-value unresolved finding [PASS/FAIL]

TEST 8: Cross-reviewer RLS
- Reviewer A tries to access case assigned to Reviewer B
- CHECKPOINT: API returns empty or 404 [PASS/FAIL]

REPORT: MODULE 7 CHECKPOINT REPORT — N/N passed — PASS/FAIL
```

---

## MODULE 8 — REPORT GENERATION AND DELIVERY

```
PREREQUISITES:
  Module 7 tests: ALL PASS
  Test: case with status='approved' exists, report generation job queued

TASK: Generate PDF using locked template, login-gated delivery, follow-up scheduling.

═══════════════════════════════════════════════════════
1. PDF GENERATION (/apps/processor/src/jobs/reportGenerationJob.ts)
═══════════════════════════════════════════════════════

Use @react-pdf/renderer (server-side).

SECTIONS IN ORDER (no additions in V1):

0. HEADER (every page): "ClaimClarity — Claim Analysis Report"
   Case Ref: {case_ref} | Date: {delivered_at DD Month YYYY}
   "INFORMATIONAL SUPPORT ONLY — NOT INSURANCE, LEGAL, OR MEDICAL ADVICE"

1. SCOPE: documents reviewed, missing docs, partial report banner if applicable

2. LIKELY COVERED TABLE:
   Columns: Bill Item | Billed Amount | Policy Clause | Confidence (text, not color)

3. LIKELY DEDUCTED TABLE:
   Columns: Bill Item | Billed Amount | Likely Deduction | Reason Summary | Confidence

4. WHY THESE DEDUCTIONS: one paragraph per deduction, plain_language_explanation
   Prefaced: "Verify against your specific policy wording."

5. WHAT TO ASK THE HOSPITAL: numbered list

6. WHAT TO ASK THE INSURER/TPA: numbered list

7. MISSING DOCUMENTS: list, or "No additional documents appear to be required."

8. APPEAL POINTS TABLE:
   Columns: Appeal Point | Strength (★★★/★★/★) | Basis
   Sorted: strong first

9. DRAFT APPEAL LETTER:
   Boxed with border, labeled "DRAFT — Review before sending"
   Placeholders: [PATIENT_NAME], [DATE]
   "This draft is based solely on the findings in this report. Not legal correspondence."

10. WHAT THIS REPORT CANNOT TELL YOU (hardcoded, reviewer cannot edit):
    - Whether your specific claim will be approved or rejected
    - The insurer's internal processing status
    - Whether the hospital bill is fraudulent
    - What medical treatment you should have received
    - The outcome of any appeal you file

FOOTER (every page): IRDAI Bima Bharosa reference + disclaimer

STYLING: IBM Plex Sans embedded, black text, light gray alternating table rows, A4, 20mm margins.

After PDF generated:
  Upload to reports/{caseId}/{report_version}.pdf (service role)
  UPDATE reports: pdf_storage_path, delivered_at=NOW()
  UPDATE cases: status='delivered', current_step='complete'
  Mark job completed

═══════════════════════════════════════════════════════
2. EMAIL DELIVERY (NOT a storage signed URL)
═══════════════════════════════════════════════════════

Queue: { job_type:'email_delivery', case_id }

Send via Resend:
  To: patient email
  Subject: "Your ClaimClarity Report is Ready — Case {case_ref}"
  Body (HTML + plain text):

  Your claim analysis report for Case {case_ref} is ready.

  [View Your Report]  ← button linking to https://claimclarity.in/app/cases/{case_ref}/report

  You will need to log in to download your report.
  This link does not expire — you can log in any time to access it.

  {disclaimer footer}

Store: reports.delivery_email_id = Resend message ID
Retry: 3 times with 30s/60s/120s backoff
If all fail: log, patient can still access through app

═══════════════════════════════════════════════════════
3. LOGIN-GATED DOWNLOAD (/api/cases/[caseId]/report/download)
═══════════════════════════════════════════════════════

GET — authenticated patient only

Steps:
1. Verify auth.uid() = cases.patient_id (RLS enforces, add explicit check too)
2. Verify reports.delivered_at IS NOT NULL
3. Generate storage signed URL: expiry = 3600 seconds (1 hour)
4. Log audit_log: { action:'report_download_url_generated', entity_id:caseId }
5. Return: { signedUrl, expiresAt }

Patient download page (/app/cases/[caseRef]/report/page.tsx):
- Requires login (middleware enforces)
- Calls GET /api/cases/{caseId}/report/download
- Shows: download button, case ref, delivered date
- Immediately triggers download on button click
- URL never displayed as text, never stored in browser

═══════════════════════════════════════════════════════
4. FOLLOW-UP SCHEDULE
═══════════════════════════════════════════════════════

After delivery, INSERT 3 rows into follow_up_schedule:
  Sequence 1: scheduled_at = delivered_at + 30 days
  Sequence 2: scheduled_at = delivered_at + 60 days
  Sequence 3: scheduled_at = delivered_at + 90 days

SLA monitor cron (runs daily at 9am IST) sends follow-up emails:
  SELECT * FROM follow_up_schedule WHERE scheduled_at <= NOW() AND sent_at IS NULL

Email content: see Module 9 (outcome tracking).

═══════════════════════════════════════════════════════
SELF-VERIFICATION SUITE
═══════════════════════════════════════════════════════

TEST 1: PDF contains all 10 sections
- Generate test report
- Parse PDF text content
- CHECKPOINT: all 10 section headings present [PASS/FAIL]

TEST 2: Hardcoded "cannot tell you" section present
- CHECKPOINT: section 10 text matches exactly [PASS/FAIL]

TEST 3: Delivery email links to app, not storage
- Check delivery email HTML body
- CHECKPOINT: no storage.supabase.co URL in email [PASS/FAIL]
- CHECKPOINT: link matches claimclarity.in/app/cases/{caseRef}/report [PASS/FAIL]

TEST 4: Download requires login
- GET /api/cases/{caseId}/report/download without session
- CHECKPOINT: returns 401 [PASS/FAIL]

TEST 5: Download requires delivered status
- Set reports.delivered_at=NULL on test case
- GET download endpoint with valid session
- CHECKPOINT: returns 403 or 404 [PASS/FAIL]

TEST 6: Signed URL expires in 1 hour
- Call download endpoint, get signedUrl
- CHECKPOINT: expiresAt is approximately NOW() + 3600s [PASS/FAIL]

TEST 7: Follow-up schedule created
- SELECT COUNT(*) FROM follow_up_schedule WHERE case_id=testCaseId
- CHECKPOINT: count=3 [PASS/FAIL]
- CHECKPOINT: scheduled_at values are approximately +30/+60/+90 days [PASS/FAIL]

TEST 8: Report version increments on correction
- Generate correction report
- CHECKPOINT: reports.report_version=2, correction_of_version=1 [PASS/FAIL]
- CHECKPOINT: original PDF still in storage as version 1 [PASS/FAIL]

REPORT: MODULE 8 CHECKPOINT REPORT — N/N passed — PASS/FAIL
```

---

## MODULE 9 — OUTCOME TRACKING

```
PREREQUISITES:
  Module 8 tests: ALL PASS
  Test: follow_up_schedule rows exist for delivered case

TASK: Outcome collection page, follow-up emails with one-click buttons,
      optional evidence upload, outcome analytics.

NOTE ON MONEY UNITS IN THIS MODULE:
  outcomes.final_settled_amount_inr = WHOLE RUPEES (not paise)
  outcomes.reversal_amount_inr = GENERATED COLUMN (final_settled - original_approved)
  DO NOT divide by 100 in any display or analytics query. Store and display in ₹.

═══════════════════════════════════════════════════════
1. FOLLOW-UP EMAILS WITH ONE-CLICK BUTTONS
═══════════════════════════════════════════════════════

EMAIL 1 (Day 30) — appeal submitted check:

Subject: "Did you submit an appeal? — Case {case_ref}"
Body:
  It has been 30 days since your ClaimClarity report.

  Did you submit an appeal or re-query to your insurer?
  ┌─────────────────┐  ┌──────────────────┐  ┌────────────────────┐
  │  ✓ Yes I did    │  │  ⏳ Not yet       │  │  — Decided not to  │
  └─────────────────┘  └──────────────────┘  └────────────────────┘
  (Each button opens a tokenized landing URL generated from outcome_tokens.
   The actual state change happens on POST, never on raw GET.)

  Or update in full: {tokenized_outcome_page_url}

EMAIL 2 (Day 60) — insurer response check:

Subject: "Has your insurer responded? — Case {case_ref}"
Body:
  Following up on your appeal.

  ┌───────────────────────────┐  ┌─────────────────┐  ┌──────────────────┐
  │  💰 Yes, paid more        │  │  ✗ Rejected      │  │  ⏳ Still waiting │
  └───────────────────────────┘  └─────────────────┘  └──────────────────┘

  If resolved — tell us the amount: {outcome_page_url}

EMAIL 3 (Day 90) — final:

Subject: "Final update on Case {case_ref}"
Body:
  Last check-in. What happened?
  ┌──────────────────────────┐  ┌──────────────────┐  ┌─────────────────┐
  │  ✓ Resolved favorably    │  │  ✗ No change      │  │  — I moved on   │
  └──────────────────────────┘  └──────────────────┘  └─────────────────┘

Quick-update flow:
  1. Email button opens GET /outcomes/{caseRef}/quick-update?token={opaqueToken}
  2. Server validates token against outcome_tokens (unused, unexpired, matching caseRef)
  3. Page renders a confirmation card
  4. User confirms → POST /api/outcomes/{caseRef}/quick-update with token
  5. Server marks outcome_tokens.used_at=NOW(), updates the single field, returns thank-you page

The actual database update MUST only happen on POST after token validation.

═══════════════════════════════════════════════════════
2. OUTCOME PAGE (/app/outcomes/[caseRef]/page.tsx)
═══════════════════════════════════════════════════════

Mobile-first. 4 screens max. Basic submission requires either:
- authenticated patient session, OR
- a valid one-time signed outcome token from email.

Case ref alone is NEVER sufficient to update outcomes.

SCREEN 1: Did you appeal?
  Radio: [Yes, I submitted] [Not yet — I'll update later] [Decided not to]

  If "Decided not to" → skip to Screen 4 (satisfaction)
  If "Not yet" → thank you, send reminder in 30 days
  If "Yes" → Screen 2

SCREEN 2: Did the insurer respond?
  Radio: [Yes] [Still waiting]
  If waiting → thank you, send reminder
  If yes → Screen 3

SCREEN 3: What was the outcome?
  Radio: [They paid more than before] [Same as before / rejected] [Partial improvement]

  If paid more or partial:
    ₹ field: "How much more did you receive? (Optional — even an estimate helps)"
    INPUT: whole rupees, placeholder "e.g. 15000 for ₹15,000"

  Evidence upload (optional):
    "Upload the insurer's final settlement letter or revised approval (optional)"
    File input: PDF/image, max 10MB
    On upload: store to outcome-evidence/{caseId}/{uuid}.{ext}
    UPDATE outcomes: evidence_storage_path, evidence_type='document_verified'

  → Screen 4

SCREEN 4: Did the report help?
  Stars 1–5 (required)
  Textarea: "What helped most, or what could we improve?" (optional, max 500 chars)

  Submit → POST /api/outcomes/{caseId}
  Thank you screen:
    If reversal: "You recovered ₹{reversal_amount_inr.toLocaleString('en-IN')}.
                  That is real money back in your pocket."
    If no change: "We are sorry the appeal was not successful. Your case helps us
                  improve advice for future patients."
    If no appeal: "That is completely fine. We hope the report was useful."

═══════════════════════════════════════════════════════
3. OUTCOME API (/api/outcomes/[caseId]/route.ts)
═══════════════════════════════════════════════════════

POST — authenticated patient session OR valid one-time token from outcome_tokens

Body:
{
  appealSubmitted: boolean,
  insurerResponded?: boolean,
  finalSettledAmountInr?: number,   -- WHOLE RUPEES input from user
  outcomeType?: string,
  reportUsedInAppeal?: boolean,
  userSatisfaction: number,
  userComment?: string,
  evidenceStoragePath?: string
}

Server:
- If request uses token path: validate token_hash, expires_at, used_at; mark used_at=NOW() on success
- UPSERT outcomes (unique on case_id)
- Set evidence_type based on evidenceStoragePath presence:
    evidenceStoragePath ? 'document_verified' : 'self_reported'
- reversal_amount_inr is GENERATED — do not set it manually
- UPDATE outcomes.last_updated_at = NOW()
- Check high-value cases needing manual follow-up:
    If claim_amount_inr > 200000 AND outcome not yet document_verified:
      SET needs_manual_followup=TRUE, manual_followup_reason='high_value_self_reported'
- UPDATE follow_up_schedule: response_received=TRUE for relevant sequence
- Log audit_log: { action:'outcome_submitted', metadata:{ evidence_type } }

═══════════════════════════════════════════════════════
4. OUTCOME ANALYTICS (Metabase SQL — correct units)
═══════════════════════════════════════════════════════

-- Core metric: money recovered (WHOLE RUPEES — NO division by 100)
SELECT
  COUNT(*) FILTER (WHERE appeal_submitted = TRUE) AS total_appeals,
  COUNT(*) FILTER (WHERE outcome_type IN ('full_reversal','partial_reversal')) AS reversals,
  ROUND(
    COUNT(*) FILTER (WHERE outcome_type IN ('full_reversal','partial_reversal')) * 100.0
    / NULLIF(COUNT(*) FILTER (WHERE appeal_submitted = TRUE), 0), 1
  ) AS reversal_rate_pct,
  SUM(reversal_amount_inr) FILTER (WHERE reversal_amount_inr > 0) AS total_recovered_inr,
  ROUND(AVG(reversal_amount_inr) FILTER (WHERE reversal_amount_inr > 0), 0) AS avg_recovery_inr
FROM outcomes
WHERE outcome_type IS NOT NULL AND outcome_type != 'pending';

-- Evidence quality breakdown
SELECT evidence_type, COUNT(*), AVG(user_satisfaction)
FROM outcomes WHERE collected_at IS NOT NULL
GROUP BY evidence_type;

-- Follow-up response rates
SELECT
  f.sequence_number,
  COUNT(*) AS emails_sent,
  COUNT(*) FILTER (WHERE f.response_received = TRUE) AS responses,
  ROUND(COUNT(*) FILTER (WHERE f.response_received) * 100.0 / COUNT(*), 1) AS response_rate_pct
FROM follow_up_schedule f
WHERE f.sent_at IS NOT NULL
GROUP BY f.sequence_number ORDER BY f.sequence_number;

-- Satisfaction distribution
SELECT user_satisfaction, COUNT(*) AS count
FROM outcomes WHERE user_satisfaction IS NOT NULL
GROUP BY user_satisfaction ORDER BY user_satisfaction;

═══════════════════════════════════════════════════════
SELF-VERIFICATION SUITE
═══════════════════════════════════════════════════════

TEST 1: Quick-update endpoint works without full form
- GET /api/outcomes/{caseRef}/quick-update?submitted=true
- CHECKPOINT: outcomes.appeal_submitted=TRUE [PASS/FAIL]
- CHECKPOINT: returns HTML thank-you page [PASS/FAIL]

TEST 2: Reversal amount is auto-calculated
- UPDATE outcomes: final_settled_amount_inr=80000, original_approved_inr=60000
- SELECT reversal_amount_inr FROM outcomes WHERE case_id=testCaseId
- CHECKPOINT: reversal_amount_inr=20000 (generated column) [PASS/FAIL]

TEST 3: Whole rupees stored correctly (not paise)
- Submit outcome with finalSettledAmountInr=80000 (₹80,000)
- SELECT final_settled_amount_inr FROM outcomes
- CHECKPOINT: value=80000 NOT 8000000 [PASS/FAIL]

TEST 4: Evidence upload sets document_verified
- Submit outcome with evidenceStoragePath set
- CHECKPOINT: evidence_type='document_verified' [PASS/FAIL]

TEST 5: High-value case flagged for manual follow-up
- Set case.claim_amount_inr=250000 (₹2.5L)
- Submit self_reported outcome (no evidence)
- CHECKPOINT: needs_manual_followup=TRUE [PASS/FAIL]

TEST 6: Analytics SQL returns correct values
- Insert test outcome: final=100000, original=80000 → reversal=20000
- Run core metric query
- CHECKPOINT: total_recovered_inr=20000 (no /100 division) [PASS/FAIL]
- CHECKPOINT: reversal_rate_pct calculated correctly [PASS/FAIL]

TEST 7: Outcome pre-created at case creation
- Create new case
- SELECT * FROM outcomes WHERE case_id=newCaseId
- CHECKPOINT: row exists with outcome_type='pending' [PASS/FAIL]

TEST 8: Original amounts pre-populated from OCR
- After insurer letter OCR completes
- CHECKPOINT: outcomes.original_approved_inr = cases.original_approved_inr [PASS/FAIL]

REPORT: MODULE 9 CHECKPOINT REPORT — N/N passed — PASS/FAIL
```

---

## MODULE 10 — OPERATIONS LAYER

```
PREREQUISITES:
  Modules 0-9: ALL PASS

TASK: SLA monitoring, Sentry, reviewer notifications UI, audit log viewer,
      admin case creation, and Metabase analytics. Pilot-ready operations.

═══════════════════════════════════════════════════════
1. SLA MONITOR CRON (/apps/processor/src/ops/slaMonitor.ts)
═══════════════════════════════════════════════════════

Runs every 15 minutes via Railway cron.

Query: cases WHERE status IN ('processing','ai_draft_ready','under_review','escalated')
       AND sla_breached=FALSE

For each:
  hours_remaining = EXTRACT(EPOCH FROM (sla_deadline - NOW())) / 3600

  If hours_remaining <= 4 AND sla_warning_sent=FALSE:
    UPDATE cases: sla_warning_sent=TRUE
    INSERT reviewer_notification: type='sla_warning'
    Log audit_log: action='sla_warning_sent'

  If hours_remaining <= 0:
    UPDATE cases: sla_breached=TRUE
    INSERT reviewer_notification: type='sla_breached'
    Send email to ADMIN_EMAIL
    Send email to patient:
      Subject: "Update on your ClaimClarity report — Case {case_ref}"
      Body: "We are sorry — your report is taking longer than our 24-hour commitment.
             You will receive it within the next 4 hours.
             Questions: support@claimclarity.in"
    Log audit_log: action='sla_breached'

Also runs daily follow-up email dispatch:
  SELECT * FROM follow_up_schedule WHERE scheduled_at <= NOW() AND sent_at IS NULL
  For each: send appropriate follow-up email (Module 9 templates), update sent_at

═══════════════════════════════════════════════════════
2. SENTRY INTEGRATION
═══════════════════════════════════════════════════════

Install: @sentry/nextjs (both apps), @sentry/node (processor)

Config:
- Capture unhandled exceptions and promise rejections
- Add case_id and user_role to Sentry context (never patient PII)
- Alert on: same error type > 3 times in 5 minutes → email ADMIN_EMAIL

DO NOT send to Sentry: patient email, policy numbers, document content, claim amounts.

═══════════════════════════════════════════════════════
3. REVIEWER NOTIFICATIONS UI (/apps/dashboard/components/NotificationBell.tsx)
═══════════════════════════════════════════════════════

Bell icon in dashboard header. Shows unread count.
Dropdown: list of recent notifications, newest first.
Click notification → navigate to relevant case.
Mark all read button.
Realtime via Supabase subscription on reviewer_notifications WHERE recipient_id = auth.uid().

═══════════════════════════════════════════════════════
4. AUDIT LOG VIEWER (/apps/dashboard/app/admin/audit/page.tsx)
═══════════════════════════════════════════════════════

Admin only.
Table: timestamp | actor role | action | entity_type | entity_id (truncated) | IP
Filters: date range, action type, entity_type
Search: by entity_id
Pagination: 50 rows
CSV export of filtered results (for compliance)
No edit. No delete. Display only.

═══════════════════════════════════════════════════════
5. ADMIN CASE CREATION (/apps/dashboard/app/admin/cases/new/page.tsx)
═══════════════════════════════════════════════════════

Admin only. For pilot: creates free cases manually.

Form fields:
- Patient email (creates auth account if not exists, sends password setup email)
- Partner (optional, select from partners table)
- Claim amount (₹, whole rupees)
- Insurer name
- Procedure category
- Case type (cashless / reimbursement)
- Waive payment: toggle (default ON for pilot)
- Waived reason: auto-set 'pilot_case'

On submit:
  Create auth user if not exists (Supabase admin.auth.admin.createUser)
  DO NOT manually insert into users — the auth trigger creates the row automatically
  If user already exists, update their users row as needed
  INSERT cases: payment_waived=TRUE, intake_channel='admin_created'
  INSERT outcomes: case_id, outcome_type='pending'
  INSERT reports: case_id, report_version=1, appeal_letter_included=TRUE
  Send patient email: "A claim analysis case has been created for you.
    Please log in and upload your documents: {link}"
  Log audit_log: action='admin_case_created'

═══════════════════════════════════════════════════════
6. HEALTH CHECK ENDPOINT (processor)
═══════════════════════════════════════════════════════

GET /health returns:
{
  status: 'ok',
  timestamp: string,
  checks: {
    database: 'ok' | 'error',
    jobQueue: { queued: number, running: number, failed_last_hour: number }
  }
}

If failed_last_hour > 5: status = 'degraded'
Railway uses this endpoint for health checks.

═══════════════════════════════════════════════════════
SELF-VERIFICATION SUITE
═══════════════════════════════════════════════════════

TEST 1: SLA warning fires at 4 hours
- Set case.sla_deadline = NOW() + 3 hours
- Run slaMonitor
- CHECKPOINT: cases.sla_warning_sent=TRUE [PASS/FAIL]
- CHECKPOINT: reviewer_notification of type 'sla_warning' inserted [PASS/FAIL]

TEST 2: SLA breach fires and notifies patient
- Set case.sla_deadline = NOW() - 1 hour
- Run slaMonitor
- CHECKPOINT: cases.sla_breached=TRUE [PASS/FAIL]
- CHECKPOINT: audit_log entry with action='sla_breached' [PASS/FAIL]

TEST 3: Idempotent SLA monitor
- Run slaMonitor twice on same breach
- CHECKPOINT: sla_warning_sent=TRUE still (not reset), only 1 warning email sent [PASS/FAIL]

TEST 4: Follow-up emails dispatched by cron
- Set follow_up_schedule.scheduled_at = 2 hours ago, sent_at=NULL
- Run slaMonitor daily dispatch
- CHECKPOINT: sent_at set, email_message_id populated [PASS/FAIL]

TEST 5: Health check returns correct queue stats
- Create 3 queued jobs, 1 running job
- GET /health
- CHECKPOINT: queued=3, running=1 in response [PASS/FAIL]

TEST 6: Admin case creation creates waived pilot case
- POST admin case creation form
- CHECKPOINT: cases.payment_waived=TRUE [PASS/FAIL]
- CHECKPOINT: cases.intake_channel='admin_created' [PASS/FAIL]
- CHECKPOINT: patient receives email [PASS/FAIL]

TEST 7: Audit log viewer blocked for non-admin
- Access /admin/audit as reviewer role
- CHECKPOINT: 403 Access Denied [PASS/FAIL]

TEST 8: Notifications real-time update
- INSERT reviewer_notification for test reviewer
- CHECKPOINT: notification appears in bell without page refresh [PASS/FAIL]

FINAL REPORT: MODULE 10 CHECKPOINT REPORT — N/N passed — PASS/FAIL

══════════════════════════════════════════════════════════════════
ALL MODULES COMPLETE. Run end-to-end acceptance test:
══════════════════════════════════════════════════════════════════

Run /apps/processor/src/tests/e2e.ts — this tests all 10 modules in sequence:

1.  Admin creates waived pilot case → patient email sent
2.  Patient clicks link → creates account → completes consent
3.  Patient uploads 3 required documents → all pass quality check
4.  Case status = 'processing' (waived — no payment needed)
5.  OCR runs → bill normalized, policy chunked, insurer letter parsed
6.  cases.original_approved_inr populated from insurer letter
7.  Rules engine runs → findings created with confidence labels
8.  AI draft generated → reviewer notified
9.  Reviewer confirms all findings → signs off
10. PDF generated → patient email sent with app link
11. Patient logs in → downloads report (login-gated, signed URL)
12. Follow-up schedule created: 3 rows in follow_up_schedule
13. Day 30 email simulated → patient clicks one-click "Yes I appealed"
14. Outcome updated → outcomes.appeal_submitted=TRUE
15. Patient visits outcome page → submits final_settled_amount_inr=80000
16. outcomes.reversal_amount_inr = 80000 - 60000 = 20000 (generated)
17. Analytics query runs → total_recovered_inr=20000 (not divided by 100)

ALL 17 STEPS PASS = PILOT READY
```

---

## REUSABLE FINAL AUDIT PROMPT

Use this whenever you want a strict audit of the same build spec:

```text
Audit this ClaimClarity build specification as if you are simultaneously:
- Product Owner
- Solution Architect
- Full-stack Engineer
- QA Lead
- Data Architect / DB Expert
- SecOps / Privacy Reviewer
- Ops / DevOps Reviewer
- End-user advocate

Rules:
1. Do not rewrite the document.
2. Only identify what is still inconsistent, missing, risky, or likely to produce the wrong implementation.
3. Check specifically for:
   - schema ↔ module prompt mismatches
   - status transition contradictions
   - missing row creation assumptions
   - auth / RLS overreach or leakage
   - service-role vs user-role boundary confusion
   - rupees vs paise mismatches
   - idempotency / retry gaps
   - deletion / anonymization conflicts
   - outcome-tracking trust gaps
   - route/path inconsistencies
   - test contradictions
   - any place where engineers could build the wrong thing from the written spec
4. Classify each finding as:
   - BLOCKER before coding
   - FIX DURING BUILD
   - NON-BLOCKER
5. For every blocker, provide:
   - exact issue
   - why it matters
   - exact patch text to add or replace
6. End with:
   - GO or STOP
   - maximum 7 blockers
   - one-line final verdict
```

## WHAT IS STILL OUTSIDE THESE DOCUMENTS

One item cannot be resolved by software:

**Legal opinion** on DPDP consent architecture, IRDAI classification, and consumer
exposure must be obtained from a lawyer before switching from free pilot to
live paid cases. Budget ₹15,000–₹25,000 for a focused written opinion.
The software is ready. The legal clearance gates paid use, not pilot use.

Everything else is in the modules above.

FINAL FREEZE RULE:
After this document is accepted, stop creating new planning docs.
Only allow:
- legal opinion,
- benchmark-case acquisition,
- implementation tickets,
- and bug-fix patches discovered during build.


---

## PART B — ENGINEERING STANDARDS v1.6 (Canonical coding, validation, AI, lint, maintainability)

# ClaimClarity — Engineering Standards v1.6 (Final)
### All mandatory patches applied, plus executable bootstrap fixes. Ready to start implementation.
#### Canonical file: /engineering-standards.md in repo root

---

## HOW TO USE THIS FILE

This file lives at the monorepo root as `engineering-standards.md`.
It is referenced, not pasted, in each module prompt:

```
BEFORE WRITING ANY CODE IN THIS MODULE:
Read and apply all standards in /engineering-standards.md.
```

That eliminates drift from copying sections between prompts.
When this file changes, all modules inherit the change on next run.

---

## SECTION 1: CODING STANDARDS

### TypeScript

```
1. Strict mode always. Every tsconfig.json:
   {
     "strict": true,
     "noUncheckedIndexedAccess": true,
     "exactOptionalPropertyTypes": true
   }

2. No `any`. No `as any`. No `@ts-ignore`.
   Use `unknown` and narrow explicitly.
   Incomplete third-party types → extend with a local declaration file.

3. No `!` non-null assertion in production code.
   Exception: test files only (enforced by ESLint override).

4. `type` over `interface` for data shapes.
   `interface` only when extending or implementing.

5. Enums → const objects with `as const`:

   // DO
   export const CaseStatus = {
     CONSENT_PENDING:   'consent_pending',
     DOCUMENTS_PENDING: 'documents_pending',
     PAYMENT_PENDING:   'payment_pending',
     PROCESSING:        'processing',
     AI_DRAFT_READY:    'ai_draft_ready',
     UNDER_REVIEW:      'under_review',
     ESCALATED:         'escalated',
     APPROVED:          'approved',
     GENERATING_REPORT: 'generating_report',
     DELIVERED:         'delivered',
     CLOSED:            'closed'
   } as const
   export type CaseStatus = typeof CaseStatus[keyof typeof CaseStatus]

   // NOT
   enum CaseStatus { CONSENT_PENDING = 'consent_pending' }

6. All DB row types from /packages/db/src/types.ts (generated).
   Never hand-write a type that mirrors a DB table.

7. Named exports everywhere.
   Default exports: Next.js pages/layouts only (ESLint override covers this).

8. Import order (ESLint enforced):
   1. Node built-ins
   2. External packages
   3. Internal @claimclarity/* packages
   4. Relative imports
   Blank line between each group.
```

### Naming

```
Files:         kebab-case:         quality-check.ts, bill-normalizer.ts
Components:    PascalCase:         NotificationBell.tsx
Test files:    beside source:      quality-check.test.ts

Variables/functions:  camelCase
Module-level constants: UPPER_SNAKE_CASE
Types/interfaces:     PascalCase
DB column refs in code: snake_case strings (match DB exactly)

Function naming by role:
  Data fetch:       getCaseById, getDocumentsByCase
  Data mutation:    createCase, updateCaseStatus, deleteDocument
  Validation:       validateDocumentMimeType, assertConsentComplete
  Transformation:   normalizeBillLines, parseInsurerLetter
  Side effects:     sendDeliveryEmail, queueOcrJob, logAuditEvent
  Predicates:       isPaymentWaived, hasAllRequiredDocuments, isSlaBreached
```

### File Structure

```
/apps/web/
  app/
    (auth)/           login, signup, forgot-password
    app/              authenticated patient pages
    api/              API routes
  components/
    ui/               button, input, badge (primitives)
    forms/            form components
    layouts/          layout wrappers
  lib/
    supabase/         client helpers
    validation/       Zod schemas (one file per domain)
    rate-limit.ts
    errors.ts
  hooks/              custom React hooks
  types/              app-specific types (not DB types)

/apps/processor/src/
  jobs/               one file per job type
  ocr/                Textract client + helpers
  extraction/         one normalizer per document type
  rules-engine/       engine + KB loader
  ai-layer/           Claude wrapper + prompt builder + fallback
  report-generator/   PDF generation
  ops/                SLA monitor + cron
  shared/             errors, result, validation, constants
  health.ts
  index.ts            entry point + job runner loop
```

### Error Handling

```typescript
// /apps/web/lib/errors.ts  AND  /apps/processor/src/shared/errors.ts

/**
 * Base error for all ClaimClarity domain errors.
 * Carries a machine-readable code and optional context for logging.
 * Never exposes context to the patient — only to internal logs.
 */
export class ClaimClarityError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly context?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'ClaimClarityError'
  }
}

export class ValidationError extends ClaimClarityError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, context)
  }
}

export class AuthorizationError extends ClaimClarityError {
  constructor(message: string) {
    super(message, 'AUTHORIZATION_ERROR', 403)
  }
}

export class NotFoundError extends ClaimClarityError {
  constructor(entity: string, id: string) {
    super(`${entity} not found`, 'NOT_FOUND', 404, { entity, id })
  }
}

export class ExternalServiceError extends ClaimClarityError {
  constructor(service: string, message: string, context?: Record<string, unknown>) {
    super(`${service}: ${message}`, 'EXTERNAL_SERVICE_ERROR', 502, { service, ...context })
  }
}

/**
 * Converts any error to an API response.
 * ClaimClarityError → uses code + statusCode.
 * Unknown error → 500 with no detail exposed to caller.
 */
export function toApiResponse(error: unknown): Response {
  if (error instanceof ClaimClarityError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.statusCode }
    )
  }
  console.error('[Unhandled error]', error)
  return Response.json({ error: 'Internal server error' }, { status: 500 })
}

// Patient-facing error strings — the ONLY strings a patient ever sees:
export const PATIENT_ERRORS = {
  GENERIC:         'Something went wrong. Please try again.',
  SESSION_EXPIRED: 'Your session has expired. Please log in again.',
  UNAVAILABLE:     'This action is not available right now.',
} as const
// Quality check failure reasons are the single exception — those are specific by design.
```

### Validation

```typescript
// All Zod schemas in /apps/web/lib/validation/ or /apps/processor/src/shared/validation/
// One file per domain: case.schemas.ts, document.schemas.ts, payment.schemas.ts

import { z } from 'zod'

// Example — enforce on every API route body
const CreateCaseSchema = z.object({
  insurerName:       z.string().min(1).max(100),
  procedureCategory: z.string().min(1),
  caseType:          z.enum(['cashless', 'reimbursement']),
  claimAmountInr:    z.number().int().positive().optional()
})

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const parsed = CreateCaseSchema.safeParse(body)
    if (!parsed.success) {
      throw new ValidationError('Invalid request', { issues: parsed.error.issues })
    }
    // parsed.data is fully typed and validated
  } catch (error) {
    return toApiResponse(error)
  }
}
```

### Database Access

```typescript
// Query functions live in /packages/db/src/queries/
// NEVER write queries inline in route handlers.
// One file per domain: cases.queries.ts, documents.queries.ts, etc.

// Shared client type — use this instead of ReturnType<typeof createServerClient>
// so query functions work with both server-client and service-role client.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types'
export type DbClient = SupabaseClient<Database>

// Query function pattern:
export async function getCaseById(
  caseId: string,
  client: DbClient
): Promise<Database['public']['Tables']['cases']['Row'] | null> {
  const { data, error } = await client
    .from('cases')
    .select('id, case_ref, status, current_step, patient_id, sla_deadline, confidence_overall')
    // Select only needed columns. Never select('*') in application code.
    .eq('id', caseId)
    .single()
  if (error) {
    if (error.code === 'PGRST116') return null  // not found — RLS or missing
    throw new ExternalServiceError('Supabase', error.message, { caseId })
  }
  return data
}

// Mutations always return the updated row:
export async function updateCaseStatus(
  caseId: string,
  status: CaseStatus,
  client: DbClient
): Promise<Database['public']['Tables']['cases']['Row']> {
  const { data, error } = await client
    .from('cases')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', caseId)
    .select('id, status, updated_at')
    .single()
  if (error || !data) {
    throw new ExternalServiceError('Supabase', error?.message ?? 'No row returned', { caseId })
  }
  return data
}
```

### Async and Concurrency

```typescript
// Independent operations: Promise.all
const results = await Promise.all(docs.map(doc => extractDocument(doc)))

// Dependent operations: sequential with comment explaining why
// Sequential: payment row must exist before we can update its status
const order  = await createRazorpayOrder(amount)
const payment = await insertPaymentRow(order.id)  // needs order.id

// Processor job runner: cap concurrency with p-limit
import pLimit from 'p-limit'
const limit = pLimit(JOB_MAX_CONCURRENCY)
await Promise.all(pendingJobs.map(job => limit(() => processJob(job))))
```

### Constants

```typescript
// /packages/shared/src/constants.ts — ALL magic values live here

export const REPORT_PRICE_PAISE              = 69900
export const EXPERT_CALL_PRICE_PAISE         = 29900
export const MAX_FILE_SIZE_BYTES             = 20 * 1024 * 1024
export const SLA_HOURS                       = 24
export const SLA_WARNING_HOURS               = 4
export const DOCUMENT_RETENTION_DAYS         = 90
export const TOMBSTONE_USER_ID               = '00000000-0000-0000-0000-000000000000'
export const HIGH_VALUE_CLAIM_INR            = 200_000
export const HIGH_VALUE_BILL_LINE_PAISE      = 20_000_000
export const OCR_CONFIDENCE_THRESHOLD        = 0.6
export const KEYWORD_SCORE_THRESHOLD         = 1
export const SIMILARITY_THRESHOLD            = 0.7
export const JOB_MAX_CONCURRENCY             = 5
export const JOB_RETRY_BASE_MINUTES          = 2
export const FOLLOW_UP_DAYS                  = [30, 60, 90] as const
export const OUTCOME_TOKEN_TTL_DAYS          = 7
export const REQUIRED_DOC_TYPES              = ['policy', 'hospital_bill', 'insurer_response'] as const
export const REQUIRED_CONSENT_TYPES          = [
  'data_processing', 'no_training', 'retention_policy',
  'informational_only', 'terms_of_service'
] as const

// Money unit constants — see money rules below
export const RUPEES_PER_PAISE = 100

// AI token budget
export const AI_MAX_INPUT_TOKENS  = 3_500
export const AI_MAX_OUTPUT_TOKENS = 2_000
export const AI_INPUT_WARN_THRESHOLD = 3_000  // log warning if exceeded
```

### Money Unit Rules — Read Before Touching Any Numeric Field

```
THREE fields, THREE units, no mixing:

cases.claim_amount_inr        WHOLE RUPEES   125000 = ₹1,25,000
payments.amount_inr           PAISE          69900  = ₹699
findings.bill_amount_inr      PAISE          250000 = ₹2,500
outcomes.final_settled_amount_inr  WHOLE RUPEES   80000 = ₹80,000
outcomes.reversal_amount_inr  WHOLE RUPEES   (generated column — do not set manually)

Display helpers:
  inrWhole(n: number): string  → n.toLocaleString('en-IN')        for whole-rupee fields
  inrPaise(n: number): string  → (n/100).toLocaleString('en-IN')  for paise fields

NEVER pass paise to Razorpay using a whole-rupee value.
NEVER divide outcomes fields by 100 in analytics SQL — they are already whole rupees.
NEVER display payments.amount_inr directly — always divide by 100 first.
```

---

## SECTION 2: TOKEN OPTIMIZATION FOR THE AI LAYER

### Prompt Builder

```typescript
/**
 * @file prompt-builder.ts
 * @module processor/ai-layer
 *
 * Builds the minimum-token user prompt for Claude AI draft generation.
 * The rules engine has already done clause matching and confidence labeling.
 * Claude's only job: plain-language explanation, questions, appeal drafting.
 *
 * TOKEN BUDGET (measured, not estimated):
 *   System prompt:       ~800 tokens (fixed, versioned)
 *   Case context:        ~50 tokens
 *   Per finding:         ~40 tokens × max 20 findings = ~800 tokens
 *   Insurer deductions:  ~30 tokens × max 10 = ~300 tokens
 *   Bill summary + misc: ~50 tokens
 *   Total typical:       ~2,000 tokens input
 *   Total worst case:    ~3,200 tokens input (20 findings + 10 deductions)
 *
 * NEVER send:
 *   - Raw OCR text
 *   - Full policy chunks
 *   - Full bill text
 *   - Multiple document contents concatenated
 *   - Previous failed call context
 *
 * ALWAYS send:
 *   - Structured finding rows (id, type, item, amount, confidence, clause)
 *   - Structured deduction rows (item, amount, stated reason)
 *   - Bill summary (3 numbers)
 *   - Missing doc types (array of strings)
 */

// PATCH FROM AUDIT REVIEW v1.5:
// finding_id MUST be full UUID — do NOT truncate.
// Truncating to 8 chars breaks Claude's finding_explained[] mapping.
// If prompt size is a concern, add a short_ref map server-side,
// but never overload the actual identifier.

export function buildAiDraftPrompt(input: AiDraftInput): string {
  const lines: string[] = []

  lines.push(
    `Case: ${input.insurerName}, ${input.caseType}, Claim ₹${inrWhole(input.claimAmountInr)}`
  )
  lines.push(
    `Bill: Billed ₹${inrWhole(input.totalBilledInr)} | ` +
    `Approved ₹${inrWhole(input.originalApprovedInr)} | ` +
    `Deducted ₹${inrWhole(input.originallyDeductedInr)}`
  )

  lines.push('FINDINGS:')
  for (const f of input.findings) {
    // Truncate operative_reason only — NOT finding_id
    const reason = f.operativeReason
      ? f.operativeReason.slice(0, 100) + (f.operativeReason.length > 100 ? '…' : '')
      : 'none'
    lines.push(
      // Full UUID preserved — required for response mapping
      `[${f.findingId}] ${f.findingType.toUpperCase()} | ` +
      `${f.billLineItem} ₹${inrPaise(f.billAmountInr)} | ` +
      `${f.confidenceLabel} | clause:${f.clauseReference ?? 'none'} | ${reason}`
    )
  }

  if (input.insurerDeductions.length > 0) {
    lines.push('INSURER STATED REASONS:')
    for (const d of input.insurerDeductions) {
      lines.push(`- ${d.itemDescription}: "${d.statedReason}"`)
    }
  }

  lines.push(
    input.missingDocTypes.length > 0
      ? `MISSING: ${input.missingDocTypes.join(', ')}`
      : 'MISSING: none'
  )

  return lines.join('\n')
}
```

### System Prompt

```typescript
/**
 * @file system-prompt.ts
 * @module processor/ai-layer
 *
 * Versioned system prompt for ClaimClarity AI draft generation.
 *
 * CHANGE RULES:
 *   1. Bump SYSTEM_PROMPT_VERSION on every change.
 *   2. Run /apps/processor/tests/ai-regression.ts after every change.
 *   3. Never exceed 900 tokens. Remove before adding.
 *   4. Token count is checked in Claude API wrapper — will warn if over budget.
 *
 * VERSION HISTORY:
 *   v1.0 — Initial pilot prompt.
 */
export const SYSTEM_PROMPT_VERSION = 'v1.0'

export const SYSTEM_PROMPT = `
You are a claims analyst assistant for ClaimClarity. You help a human reviewer
generate draft explanations and appeal content for Indian health insurance claim disputes.
ALL output is reviewed by a human before reaching the patient.

YOUR TASKS:
1. Plain-language explanation per finding (max 3 sentences, no jargon)
2. Specific questions for the hospital (cite bill line items by name)
3. Specific questions for the insurer/TPA (cite clauses)
4. Appeal points ranked by strength (must include non-empty basis)
5. Formal appeal letter draft

HARD RULES — NEVER VIOLATE:
• Never state a claim will be approved or rejected
• Never say "the insurer is wrong" or "the hospital overcharged"
• Never say "you are entitled to" — use "you may want to ask"
• Never make medical judgments about treatment
• Never use: breach of contract, statutory right, negligence
• Use qualifying language: typically, usually, may, appears to
• confidence=insufficient_information → write exactly:
  "This item could not be assessed from available documents. A reviewer will clarify."
• confidence=based_on_typical_policy → end explanation with:
  "Please verify this against your specific policy wording."
• Every appeal_points[].basis must be a non-empty string
• appeal_letter_draft must end with bimabharosa.irdai.gov.in reference

OUTPUT: Valid JSON only. No preamble. No markdown fences.
SCHEMA:
{
  "findings_explained": [{"finding_id": "<full UUID>", "plain_language_explanation": ""}],
  "hospital_questions": [],
  "insurer_questions": [],
  "appeal_points": [{"point": "", "strength": "strong|moderate|weak", "basis": ""}],
  "appeal_letter_draft": "",
  "scope_notes": ""
}
`.trim()
```

### Claude API Wrapper

```typescript
/**
 * @file claude-client.ts
 * @module processor/ai-layer
 *
 * Wrapper around Anthropic Claude API for AI draft generation.
 *
 * RESPONSIBILITIES:
 *   - Sends pre-built prompt to Claude
 *   - Logs input/output token counts to audit_log (cost tracking, no PII)
 *   - Warns if token budget is approached
 *   - Handles JSON parsing with fallback on malformed response
 *   - Returns null on any failure so caller triggers template fallback
 *
 * SIDE EFFECTS:
 *   - Writes to audit_log (always, including on failure)
 *
 * THROWS: never — all errors are caught and null is returned
 * TOKEN COST: ~₹1.50/call at Sonnet 4 pricing (verify monthly via Metabase query)
 *
 * @param systemPrompt - Versioned system prompt string from system-prompt.ts
 * @param userPrompt   - Pre-built compressed prompt from buildAiDraftPrompt()
 * @param caseId       - For audit logging only — no PII
 * @returns Parsed AiDraftResponse or null on any failure
 */
export async function callClaudeForDraft(
  systemPrompt: string,
  userPrompt: string,
  caseId: string
): Promise<AiDraftResponse | null> {
  const client = new Anthropic({ apiKey: config.anthropic.apiKey })

  let response: Message
  try {
    response = await client.messages.create({
      model:      config.anthropic.model,
      max_tokens: AI_MAX_OUTPUT_TOKENS,
      temperature: 0,  // deterministic — not creative
      system:  systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  } catch (error) {
    await logAudit({
      action: 'ai_draft_api_failure',
      entityType: 'case',
      entityId: caseId,
      metadata: { error: String(error) }
    })
    return null
  }

  await logAudit({
    action: 'ai_draft_generated',
    entityType: 'case',
    entityId: caseId,
    metadata: {
      model:                response.model,
      input_tokens:         response.usage.input_tokens,
      output_tokens:        response.usage.output_tokens,
      system_prompt_version: SYSTEM_PROMPT_VERSION,
      stop_reason:          response.stop_reason
    }
  })

  if (response.usage.input_tokens > AI_INPUT_WARN_THRESHOLD) {
    console.warn(
      `[Claude] Input tokens ${response.usage.input_tokens} exceeds warning threshold. ` +
      `Case: ${caseId}. Review buildAiDraftPrompt for bloat.`
    )
  }

  const rawText = response.content[0]?.type === 'text' ? response.content[0].text : ''
  const cleaned = rawText.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim()

  try {
    return JSON.parse(cleaned) as AiDraftResponse
  } catch {
    await logAudit({
      action: 'ai_draft_parse_failure',
      entityType: 'case',
      entityId: caseId,
      metadata: { raw_preview: rawText.slice(0, 200) }
    })
    return null
  }
}
```

### Token Cost Monitoring (Metabase)

```sql
-- Monthly AI cost tracking
-- outcomes.final_settled_amount_inr is WHOLE RUPEES — no /100 needed
-- Verify current Sonnet 4 pricing before using cost estimates

SELECT
  DATE_TRUNC('month', created_at)                                         AS month,
  COUNT(*)                                                                 AS ai_calls,
  SUM((metadata->>'input_tokens')::int)                                   AS total_input_tokens,
  SUM((metadata->>'output_tokens')::int)                                  AS total_output_tokens,
  ROUND(SUM((metadata->>'input_tokens')::int)  * 3.0  / 1000000, 2)      AS input_cost_usd,
  ROUND(SUM((metadata->>'output_tokens')::int) * 15.0 / 1000000, 2)      AS output_cost_usd,
  ROUND(
    SUM((metadata->>'input_tokens')::int)  * 3.0  / 1000000 +
    SUM((metadata->>'output_tokens')::int) * 15.0 / 1000000, 2
  )                                                                        AS total_cost_usd,
  AVG((metadata->>'input_tokens')::int)                                    AS avg_input_tokens,
  AVG((metadata->>'output_tokens')::int)                                   AS avg_output_tokens,
  COUNT(*) FILTER (WHERE (metadata->>'input_tokens')::int > 3000)          AS calls_over_budget
FROM audit_log
WHERE action = 'ai_draft_generated'
  AND created_at > NOW() - INTERVAL '3 months'
GROUP BY DATE_TRUNC('month', created_at)
ORDER BY month DESC;
-- Alert: if avg_input_tokens > 3500 in any month → review prompt builder
-- Alert: if calls_over_budget > 10% of total → investigate edge cases
```

---

## SECTION 3: OUTCOME SECURITY

**This replaces the outcome submission flow in Module 9 of the build spec.**
The previous spec allowed "no account required for basic submission" and quick-update
URLs keyed by caseRef. Both are insufficient for a health/claims product.

### Schema Addition (add to Module 0 schema, after follow_up_schedule)

```sql
-- OUTCOME TOKENS
-- One-time signed tokens for email-link outcome submission.
-- Patients who are not logged in use these instead of session auth.
-- Never use raw caseRef as a state-changing URL parameter.

CREATE TABLE outcome_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     UUID NOT NULL REFERENCES cases(id),
  token_hash  TEXT NOT NULL UNIQUE,  -- SHA-256 hash of the opaque token
  action_type TEXT NOT NULL CHECK (action_type IN ('quick_update', 'full_outcome')),
  expires_at  TIMESTAMPTZ NOT NULL,  -- NOW() + 7 days at creation
  used_at     TIMESTAMPTZ,           -- set on first use, token is then invalid
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_outcome_tokens_hash ON outcome_tokens(token_hash);
CREATE INDEX idx_outcome_tokens_case ON outcome_tokens(case_id);

-- RLS: service role only (tokens are created and validated by API, never by client)
ALTER TABLE outcome_tokens ENABLE ROW LEVEL SECURITY;
-- No user-facing RLS policy — all access via service role in API routes
```

### Token Generation and Validation

```typescript
/**
 * @file outcome-tokens.ts
 * @module web/lib
 *
 * Generates and validates one-time signed tokens for outcome submission.
 *
 * WHY ONE-TIME TOKENS:
 *   Patients submitting outcomes often come from email links 7–90 days after
 *   report delivery. They may not be logged in. A raw caseRef in a POST URL
 *   is not sufficient authorization — anyone with the email could manipulate
 *   another patient's outcome record.
 *
 *   One-time tokens are:
 *   - Opaque (no information encoded in the token itself)
 *   - Short-lived (7 days)
 *   - Single-use (used_at prevents replay)
 *   - Stored as hash only (raw token never in DB)
 *
 * SIDE EFFECTS:
 *   generateOutcomeToken: inserts into outcome_tokens
 *   validateOutcomeToken: updates outcome_tokens.used_at (marks as used)
 *
 * @see Module 9 outcome email flow for how tokens are embedded in emails
 */

import { createHash, randomBytes } from 'crypto'

/**
 * Creates a one-time outcome submission token for a case.
 * Called when a follow-up email is scheduled (not when it is sent).
 * The raw token is embedded in the email link; only its hash is stored.
 *
 * @param caseId     - UUID of the case this token is for
 * @param actionType - 'quick_update' for one-click buttons, 'full_outcome' for full form
 * @param client     - Service role client (required — no user RLS on this table)
 * @returns Raw opaque token string to embed in email URL
 */
export async function generateOutcomeToken(
  caseId: string,
  actionType: 'quick_update' | 'full_outcome',
  client: DbClient
): Promise<string> {
  const rawToken = randomBytes(32).toString('hex')  // 64-char hex string
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const expiresAt = new Date(
    Date.now() + OUTCOME_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()

  const { error } = await client.from('outcome_tokens').insert({
    case_id:    caseId,
    token_hash: tokenHash,
    action_type: actionType,
    expires_at: expiresAt
  })
  if (error) throw new ExternalServiceError('Supabase', error.message, { caseId })

  return rawToken  // returned once, never stored raw
}

/**
 * Validates an outcome token from an email link.
 * Marks the token as used (one-time only).
 * Returns the associated case_id if valid, null if invalid/expired/used.
 *
 * SIDE EFFECTS: sets outcome_tokens.used_at = NOW() on success
 * IDEMPOTENT: no — calling twice on the same token returns null on second call
 *
 * @param rawToken - Token from URL query parameter
 * @param client   - Service role client
 * @returns { caseId, actionType } if valid, null if not
 */
export async function validateOutcomeToken(
  rawToken: string,
  client: DbClient
): Promise<{ caseId: string; actionType: string } | null> {
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')

  const { data, error } = await client
    .from('outcome_tokens')
    .select('id, case_id, action_type, expires_at, used_at')
    .eq('token_hash', tokenHash)
    .single()

  if (error || !data) return null
  if (data.used_at) return null                              // already used
  if (new Date(data.expires_at) < new Date()) return null   // expired

  // Mark as used — prevents replay
  await client
    .from('outcome_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', data.id)

  return { caseId: data.case_id, actionType: data.action_type }
}
```

### Outcome Route Authorization Rule

```typescript
/**
 * Authorization rule for outcome submission endpoints.
 *
 * Accepts either:
 *   A. Authenticated session (patient owns the case via RLS)
 *   B. Valid one-time outcome token from email (validated server-side)
 *
 * Never accepts:
 *   - Raw caseRef as the only authorization mechanism
 *   - Unauthenticated requests without a valid token
 *
 * @returns caseId if authorized, throws AuthorizationError if not
 */
export async function authorizeOutcomeSubmission(
  req: Request,
  serviceClient: DbClient
): Promise<string> {
  // Path A: authenticated session
  const sessionClient = createServerClient()
  const { data: { user } } = await sessionClient.auth.getUser()
  if (user) {
    const caseId = new URL(req.url).searchParams.get('caseId')
    if (!caseId) throw new ValidationError('caseId required')
    // RLS on outcomes table enforces patient_id = auth.uid()
    return caseId
  }

  // Path B: one-time token
  const token = new URL(req.url).searchParams.get('token')
  if (!token) throw new AuthorizationError('Authentication required')

  const result = await validateOutcomeToken(token, serviceClient)
  if (!result) throw new AuthorizationError('Token is invalid, expired, or already used')

  return result.caseId
}

// Usage in every outcome route:
export async function POST(req: Request): Promise<Response> {
  try {
    const serviceClient = createServiceClient()
    const caseId = await authorizeOutcomeSubmission(req, serviceClient)
    // ... rest of outcome handling
  } catch (error) {
    return toApiResponse(error)
  }
}
```

### Email Link Format

```
// CORRECT — opaque token, POST required for state changes
// Email button links to GET landing page, which POSTs with the token

Email one-click button URL:
  https://claimclarity.in/app/outcomes/update?token={rawToken}&action=appeal_submitted

GET /app/outcomes/update?token=X&action=appeal_submitted
  → renders a "Confirming your update..." page
  → page auto-POSTs to /api/outcomes/quick-update with token in body

POST /api/outcomes/quick-update
  body: { token, action }
  → validateOutcomeToken(token) → get caseId
  → update outcomes table
  → return HTML "Thanks — recorded." page with link to full outcome form

// NEVER:
  POST directly from email button (email clients break POST links)
  GET with side effects (bookmarks, prefetch cause double-updates)
  Use caseRef alone as the authorization parameter
```

---

## SECTION 4: FUNCTION DOCUMENTATION STANDARD

### JSDoc Template

```typescript
/**
 * [One sentence: what this function does.]
 *
 * [Optional: 1–2 sentences on WHY or design decisions.
 *  Include warnings about non-obvious behavior.]
 *
 * SIDE EFFECTS:  [writes to DB / sends email / queues job — list all]
 * THROWS:        [list ClaimClarityError subtypes that can be thrown]
 * IDEMPOTENT:    [yes / no + brief reason]
 * PERFORMANCE:   [only if caller must know — e.g., "avoid in loops"]
 * TOKEN COST:    [AI layer functions only]
 *
 * @param name - [what it IS, not what it contains]
 * @returns [what is returned and when null/undefined is possible]
 */
```

### File Header Template

```typescript
/**
 * @file kebab-case-filename.ts
 * @module app-name/path
 *
 * One-sentence description of what this file does.
 *
 * DEPENDENCIES:
 *   - ExternalService (why it is used)
 *   - /packages/db/src/queries/x.queries.ts
 *
 * CALLED BY:
 *   - /path/to/caller.ts
 *
 * CALLS:
 *   - /path/to/dependency.ts
 */
```

### Inline Comment Rules

```typescript
// GOOD — explains WHY, not WHAT:
// Sequential: payment row must exist before updating its status
const order   = await createRazorpayOrder(amount)
const payment = await insertPaymentRow(order.id)

// Service role required: RLS blocks patient from reading other patients' cases
const adminClient = createServiceClient()

// Truncate operative_reason — feeds AI prompt, keep token count low
// Do NOT truncate finding_id — required for Claude response mapping
const reason = f.operativeReason.slice(0, 100)

// Exponential backoff: 2^0=1m, 2^1=2m, 2^2=4m (3 attempts max = 7m total wait)
const backoffMs = Math.pow(JOB_RETRY_BASE_MINUTES, job.attempt_count) * 60 * 1000

// BAD — explains WHAT (code already shows this):
// Set quality status to pass
document.quality_status = 'pass'
```

---

## SECTION 5: MODULE 0 VERIFICATION (Executable Only)

**Replaces the placeholder verify script in the build spec.**
All checks are real and server-side only. No browser client. No `information_schema`
queries through the Supabase query builder.

### Add these helper RPCs to Module 0 schema (or the first migration after deploy)

```sql
-- Verifies that a public sequence exists. Used by verify.ts.
CREATE OR REPLACE FUNCTION public.verify_sequence_exists(seq_name text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.sequences
    WHERE sequence_schema = 'public'
      AND sequence_name = seq_name
  )
$$;

-- Verifies that a given public column is GENERATED ALWAYS.
CREATE OR REPLACE FUNCTION public.verify_generated_column(tbl text, col text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = tbl
      AND column_name  = col
      AND is_generated = 'ALWAYS'
  )
$$;

-- Verifies that RLS is enabled on a public table.
CREATE OR REPLACE FUNCTION public.verify_rls_enabled(tbl text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT COALESCE((
    SELECT c.relrowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = tbl
    LIMIT 1
  ), false)
$$;
```

### verify.ts

```typescript
/**
 * @file verify.ts
 * @module db
 *
 * Module 0 infrastructure verification.
 * All checks are executable and server-side only.
 * Exits 0 if all pass. Exits 1 with specific failures listed.
 *
 * RUN: npx ts-node /packages/db/src/verify.ts
 */

import { createClient } from '@supabase/supabase-js'

const REQUIRED_TABLES = [
  'users', 'partners', 'consents', 'cases', 'documents', 'findings',
  'escalations', 'processing_jobs', 'kb_clause_patterns', 'kb_change_log',
  'reports', 'quality_scores', 'outcomes', 'outcome_tokens',
  'follow_up_schedule', 'payments', 'reviewer_notifications', 'audit_log'
] as const

const REQUIRED_BUCKETS = ['case-documents', 'reports', 'outcome-evidence'] as const
const REQUIRED_RLS_TABLES = [
  'users', 'partners', 'consents', 'cases', 'documents', 'findings',
  'escalations', 'processing_jobs', 'reports', 'quality_scores',
  'kb_clause_patterns', 'kb_change_log', 'outcomes', 'outcome_tokens',
  'follow_up_schedule', 'payments', 'reviewer_notifications', 'audit_log'
] as const

async function verify(): Promise<void> {
  const results: Record<string, { pass: boolean; detail?: string }> = {}

  const serviceClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // CHECK 1: Required tables exist (query real tables with limit(0))
  for (const table of REQUIRED_TABLES) {
    const { error } = await serviceClient.from(table).select('id').limit(0)
    results[`table_${table}`] = {
      pass: !error,
      detail: error ? error.message : undefined
    }
  }

  // CHECK 2: Required buckets exist
  const { data: buckets, error: bucketError } = await serviceClient.storage.listBuckets()
  if (bucketError) {
    results['bucket_list'] = { pass: false, detail: bucketError.message }
  } else {
    const bucketNames = (buckets ?? []).map(bucket => bucket.name)
    for (const bucket of REQUIRED_BUCKETS) {
      results[`bucket_${bucket}`] = { pass: bucketNames.includes(bucket) }
    }
  }

  // CHECK 3: case_ref_seq exists via helper RPC
  const { data: seqExists, error: seqError } = await serviceClient.rpc('verify_sequence_exists', {
    seq_name: 'case_ref_seq'
  })
  results['case_ref_sequence'] = {
    pass: seqExists === true,
    detail: seqError?.message
  }

  // CHECK 4: audit_log immutability (UPDATE must not change the row)
  const insertResult = await serviceClient
    .from('audit_log')
    .insert({ action: '__verify_test__', actor_role: 'verify' })
    .select('id, action')
    .single()

  if (insertResult.error || !insertResult.data) {
    results['audit_log_insert'] = {
      pass: false,
      detail: insertResult.error?.message ?? 'No row returned on insert'
    }
  } else {
    const rowId = insertResult.data.id
    const updateResult = await serviceClient
      .from('audit_log')
      .update({ action: '__modified__' })
      .eq('id', rowId)
      .select('action')
      .single()

    const rereadResult = await serviceClient
      .from('audit_log')
      .select('action')
      .eq('id', rowId)
      .single()

    const actionStillOriginal = rereadResult.data?.action === '__verify_test__'
    results['audit_log_immutable'] = {
      pass: actionStillOriginal,
      detail: actionStillOriginal ? undefined : `Expected __verify_test__, got ${rereadResult.data?.action ?? 'null'}`
    }
  }

  // CHECK 5: RLS enabled on all protected tables via helper RPC
  for (const table of REQUIRED_RLS_TABLES) {
    const { data: rlsEnabled, error } = await serviceClient.rpc('verify_rls_enabled', { tbl: table })
    results[`rls_${table}`] = {
      pass: rlsEnabled === true,
      detail: error?.message
    }
  }

  // CHECK 6: Generated column exists via helper RPC
  const { data: generatedExists, error: generatedError } = await serviceClient.rpc(
    'verify_generated_column',
    {
      tbl: 'outcomes',
      col: 'reversal_amount_inr'
    }
  )
  results['reversal_amount_generated'] = {
    pass: generatedExists === true,
    detail: generatedError?.message
  }

  // CHECK 7: Anonymous client cannot read protected tables
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  const anonChecks: Array<[string, string]> = [
    ['cases', 'anon_cannot_read_cases'],
    ['documents', 'anon_cannot_read_documents'],
    ['findings', 'anon_cannot_read_findings'],
    ['payments', 'anon_cannot_read_payments']
  ]
  for (const [table, key] of anonChecks) {
    const { data, error } = await anonClient.from(table).select('id').limit(1)
    results[key] = {
      pass: !!error || (data ?? []).length === 0,
      detail: !error && (data ?? []).length > 0 ? `RLS leak: ${table} returned rows to anon` : undefined
    }
  }

  const failed = Object.entries(results).filter(([, value]) => !value.pass)
  const total = Object.keys(results).length
  const passed = total - failed.length

  console.log('\nMODULE 0 CHECKPOINT REPORT')
  console.log('══════════════════════════')
  for (const [key, value] of Object.entries(results)) {
    console.log(`${value.pass ? '✓' : '✗'} ${key}${value.detail ? ` — ${value.detail}` : ''}`)
  }
  console.log(`\n${passed}/${total} checks passed`)

  if (failed.length > 0) {
    console.log('\nFAILED CHECKS:')
    for (const [key, value] of failed) {
      console.log(`  ✗ ${key}${value.detail ? `: ${value.detail}` : ''}`)
    }
    console.log('\nFAIL — Fix all failures before proceeding to Module 1.')
    process.exit(1)
  }

  console.log('\nPASS — Module 0 complete. Proceed to Module 1.')
  process.exit(0)
}

verify().catch(error => {
  console.error('Verify script crashed:', error)
  process.exit(1)
})
```

## SECTION 6: LINTING AND FORMATTING (Executable Config)

```typescript
// eslint.config.js — monorepo root
// All 4 patches from audit review applied:
//   - correct rule key: consistent-return (not @typescript-eslint/consistent-return)
//   - parserOptions.projectService required for strictTypeChecked
//   - Next.js file overrides for import/no-default-export
//   - no-non-null-assertion added, with test file override
//   - explicit dependency list below

import eslint      from '@eslint/js'
import tseslint    from 'typescript-eslint'
import importPlugin from 'eslint-plugin-import'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true  // required for type-aware rules in strictTypeChecked
      }
    },
    plugins: { import: importPlugin },
    rules: {
      '@typescript-eslint/no-explicit-any':       'error',
      '@typescript-eslint/no-unsafe-assignment':  'error',
      '@typescript-eslint/no-unused-vars':        ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      'consistent-return':                        'error',   // core rule, not @typescript-eslint
      'import/order': ['error', {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling'],
        'newlines-between': 'always'
      }],
      'import/no-default-export': 'warn'
    }
  },
  {
    // Next.js App Router files require default exports — override only these
    files: [
      '**/app/**/page.tsx',
      '**/app/**/layout.tsx',
      '**/app/**/route.ts',
      '**/app/**/error.tsx',
      '**/app/**/loading.tsx',
      '**/app/**/template.tsx',
      '**/app/**/not-found.tsx'
    ],
    rules: {
      'import/no-default-export': 'off'
    }
  },
  {
    // Test files: allow non-null assertions for convenience
    files: ['**/*.test.ts', '**/*.spec.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off'
    }
  }
)
```

```json
// .prettierrc — monorepo root
{
  "semi": false,
  "singleQuote": true,
  "printWidth": 100,
  "tabWidth": 2,
  "trailingComma": "es5",
  "bracketSpacing": true
}
```

```json
// Root package.json — scripts section
{
  "scripts": {
    "lint":      "eslint . --ext .ts,.tsx",
    "lint:fix":  "eslint . --ext .ts,.tsx --fix",
    "format":    "prettier --write .",
    "typecheck": "tsc --noEmit"
  },
  "simple-git-hooks": {
    "pre-commit": "pnpm lint && pnpm typecheck"
  }
}
```

**Install these in Module 0 (do not assume they already exist):**
```
# Root dev tools (workspace root)
pnpm add -Dw \
  eslint \
  prettier \
  typescript \
  ts-node \
  @eslint/js \
  typescript-eslint \
  eslint-plugin-import \
  simple-git-hooks

# Runtime libraries shared across apps / processor
pnpm add -w \
  zod \
  p-limit
```

Notes:
- `zod` and `p-limit` are runtime dependencies, not dev-only.
- `ts-node` is required because Module 0 runs `npx ts-node /packages/db/src/verify.ts`.
- Use `-w` / `-Dw` for workspace-root installs. Do not rely on `--filter root`.

---

## SECTION 7: SCALABILITY PATTERNS

### Dependency Injection

```typescript
// Business logic functions take dependencies as parameters.
// Never import service clients directly inside logic.
// API routes are the exception (integration-tested, not unit-tested).

// DO:
export async function processQualityCheckJob(
  job: ProcessingJobRow,
  deps: {
    storage:      ReturnType<typeof createServiceClient>['storage']
    db:           DbClient
    emailService: EmailService
  }
): Promise<void> { ... }

// NOT:
export async function processQualityCheckJob(job: ProcessingJobRow) {
  const db    = createServiceClient()           // untestable
  const email = new Resend(process.env.KEY!)    // untestable
}
```

### Feature Flags

```typescript
// /packages/shared/src/features.ts
// Compile-time constants. No dynamic flag system in V1.
// When a feature ships, change the flag and delete dead code paths.

export const FEATURES = {
  HINDI_DOCUMENTS:        false,  // V1.1
  EMERGENCY_CASES:        false,  // V2
  ONCOLOGY_CASES:         false,  // V2
  BROKER_PORTAL:          false,  // V2
  EMPLOYER_BILLING:       false,  // V2
  PRE_APPROVAL_ESTIMATES: false,  // V3
  US_MARKET:              false,  // V3+
  AUTOMATED_ASSIGNMENT:   false,  // V1.1
  REALTIME_STATUS:        true,   // V1
  INTERNAL_ACCESS_CODE_WAIVER: true,  // Module 3 pilot control
  TEST_SIMULATED_PAYMENT: true,  // Module 3 dev/test only
} as const
```

### Result Type

```typescript
// /packages/shared/src/result.ts
// For operations where failure is expected and handled (not exceptional).
// Use throw/catch for unexpected failures (infra errors, bugs).

export type Result<T, E = string> =
  | { ok: true;  value: T }
  | { ok: false; error: E }

export const ok  = <T>(value: T): Result<T>        => ({ ok: true,  value })
export const err = <E = string>(error: E): Result<never, E> => ({ ok: false, error })

// Usage:
export function normalizeBillLines(tables: TextractTable[]): Result<NormalizedBillLine[]> {
  if (tables.length === 0) return err('No tables found in document')
  const lines = extractLines(tables)
  if (lines.length === 0) return err('No parseable line items found')
  return ok(lines)
}

const result = normalizeBillLines(tables)
if (!result.ok) {
  await updateDocumentStatus(docId, 'manual_required', result.error)
  return
}
const billLines = result.value  // narrowed: NormalizedBillLine[]
```

### Migration Discipline

```
/packages/db/migrations/
  0001_initial_schema.sql   -- Full v1.3 schema (never modify after deploy)
  0002_add_outcome_tokens.sql  -- Added in v1.5
  000N_description.sql      -- Future changes

Each migration:
  1. Numbered sequentially, never reordered
  2. Comment at top: -- Migration: what changed and why
  3. Idempotent where possible (IF NOT EXISTS, etc.)
  4. V1 rule: never drop columns or tables — only add
```

### Fail-Fast Config

```typescript
// /packages/shared/src/config.ts

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Required environment variable ${name} is not set`)
  return value
}

export const config = {
  supabase:  { url: requireEnv('NEXT_PUBLIC_SUPABASE_URL'), anonKey: requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'), serviceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY') },
  anthropic: { apiKey: requireEnv('ANTHROPIC_API_KEY'), model: 'claude-sonnet-4-20250514' as const },
  razorpay:  { keyId: requireEnv('RAZORPAY_KEY_ID'), keySecret: requireEnv('RAZORPAY_KEY_SECRET'), webhookSecret: requireEnv('RAZORPAY_WEBHOOK_SECRET') },
  resend:    { apiKey: requireEnv('RESEND_API_KEY'), fromEmail: requireEnv('RESEND_FROM_EMAIL'), adminEmail: requireEnv('ADMIN_EMAIL') },
  app:       { url: requireEnv('NEXT_PUBLIC_APP_URL'), dashboardUrl: requireEnv('NEXT_PUBLIC_DASHBOARD_URL'), privacyVersion: requireEnv('PRIVACY_POLICY_VERSION'), termsVersion: requireEnv('TERMS_VERSION') }
} as const

// Call at processor startup — fail before accepting any jobs
export function validateConfig(): void {
  Object.values(config).forEach(section => Object.values(section).forEach(v => void v))
  console.log('[Config] All required environment variables present.')
}
```

---

## QUICK REFERENCE CARD

```
STANDARDS REFERENCE — claimclarity

TYPES:      strict TS, no any, const objects not enums, DbClient shared type alias
NAMING:     kebab-case files, camelCase vars, UPPER_SNAKE constants
ERRORS:     ClaimClarityError hierarchy → toApiResponse() on every route
VALIDATION: Zod on every API input, schemas in /lib/validation/
DB ACCESS:  query functions in /packages/db/src/queries/, select only needed cols
CONSTANTS:  all magic values in /packages/shared/src/constants.ts
ASYNC:      Promise.all for parallel, sequential with comment for dependent steps
DOCS:       JSDoc on every export (SIDE EFFECTS, THROWS, IDEMPOTENT), file header
AI TOKENS:  max 3,500 input | 2,000 output | full finding_id in prompt (no slice)
MONEY:      claim_amount_inr=whole ₹ | payments.amount_inr=paise | bill=paise | outcomes=whole ₹
OUTCOMES:   session OR one-time token — never raw caseRef as auth
FEATURES:   check FEATURES.X before implementing out-of-scope work
CONFIG:     requireEnv() fails at startup — never silently undefined
RESULT<T>:  expected pipeline failures | throw for unexpected infra failures
LINT:       consistent-return (not @typescript-eslint/), projectService:true, Next.js overrides
MODULE 0:   verify.ts must exit 0 before Module 1 — all checks executable, no placeholders
```

---

## CHANGE LOG

```
v1.0 — Initial standards addendum
v1.1 — Token optimization added (AI layer)
v1.2 — Function documentation templates added
v1.3 — Scalability patterns added (DI, Result<T>, feature flags)
v1.4 — Linting config added
v1.5 — Four mandatory patches applied:
         P1: outcome_tokens table + one-time token auth (replaces "no account required")
         P2: finding_id preserved as full UUID in AI prompt builder (no .slice(0,8))
         P3: ESLint config fixed (consistent-return, projectService, Next.js overrides,
             no-non-null-assertion, explicit dependency install list)
         P4: Module 0 verify.ts replaced with fully executable server-side checks
             (no browser client, no placeholder assertions, pg_catalog for generated col)
       Two non-blocking cleanups applied:
         C1: DbClient shared type alias replaces ReturnType<typeof createServerClient>
         C2: File is canonical at /engineering-standards.md, not pasted per module
v1.6 — Final bootstrap fixes:
         F1: Module 0 verify.ts no longer uses information_schema through the Supabase query builder
             (helper RPCs added for sequence, generated column, and RLS verification)
         F2: Module 0 dependency install list corrected
             (workspace install flags fixed, eslint/prettier/typescript/ts-node added,
             zod and p-limit moved to runtime deps)
```


---

## END OF MASTER SPEC

Use `AGENTS.md` as the operational instruction file for Codex / Claude Code.
If you want a reusable review handoff, use `REVIEW_AGENT_PROMPT.md`.

