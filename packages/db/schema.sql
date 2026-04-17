-- Migration: initial ClaimClarity Module 0 schema and RLS bootstrap

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
  reviewer_unassessable      BOOLEAN DEFAULT FALSE,
  reviewer_unassessable_reason TEXT,
  reviewer_unassessable_by   UUID REFERENCES users(id),
  reviewer_unassessable_at   TIMESTAMPTZ,
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
  patient_action_type         TEXT NOT NULL DEFAULT 'none'
                                CHECK (patient_action_type IN (
                                  'none','asked_hospital','asked_insurer_tpa',
                                  'submitted_appeal','waiting_response','closed_no_benefit'
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
COMMENT ON COLUMN outcomes.outcome_type IS
  'Result/financial state only: pending, not_applicable, no_change, partial_reversal, full_reversal.';
COMMENT ON COLUMN outcomes.patient_action_type IS
  'Patient-reported action state only. Do not force workflow/action states into outcome_type.';

-- OUTCOME TOKENS (one-time links for email-based outcome updates)
CREATE TABLE outcome_tokens (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id          UUID NOT NULL REFERENCES cases(id),
  token_hash       TEXT NOT NULL UNIQUE,
  token_type       TEXT NOT NULL CHECK (token_type IN ('quick_update','full_outcome')),
  expires_at       TIMESTAMPTZ NOT NULL,
  used_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN outcome_tokens.token_hash IS
  'SHA-256 hash of opaque token. Raw token is never stored.';
COMMENT ON COLUMN outcome_tokens.token_type IS
  'Authorization scope only: quick_update or full_outcome. Actual submitted action belongs in POST body.';

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
CREATE INDEX idx_findings_pending_review ON findings(case_id)
  WHERE reviewer_confirmed = FALSE AND reviewer_unassessable = FALSE;
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
CREATE INDEX idx_outcome_tokens_hash   ON outcome_tokens(token_hash);
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
CREATE POLICY escalations_reviewer_select ON escalations
  FOR SELECT USING ((from_reviewer_id = auth.uid() AND is_reviewer()) OR is_admin());
CREATE POLICY escalations_reviewer_insert ON escalations
  FOR INSERT WITH CHECK (from_reviewer_id = auth.uid() AND is_reviewer());
CREATE POLICY escalations_expert_select_open ON escalations
  FOR SELECT USING (to_expert_id = auth.uid() AND is_expert() AND status = 'open');
CREATE POLICY escalations_expert_update_open ON escalations
  FOR UPDATE USING (to_expert_id = auth.uid() AND is_expert() AND status = 'open')
  WITH CHECK (
    to_expert_id = auth.uid()
    AND is_expert()
    AND status IN ('accepted','responded','resolved','dismissed')
  );
CREATE POLICY escalations_admin_all ON escalations
  FOR ALL USING (is_admin()) WITH CHECK (is_admin());
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


-- Module 0 verification helper RPCs
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
