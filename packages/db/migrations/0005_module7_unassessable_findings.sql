-- Migration: add explicit Module 7 reviewer unassessable state.
-- Required because reviewer_confirmed=false cannot distinguish pending review
-- from a finding that was explicitly marked unassessable with a reason.

ALTER TABLE findings
  ADD COLUMN IF NOT EXISTS reviewer_unassessable BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reviewer_unassessable_reason TEXT,
  ADD COLUMN IF NOT EXISTS reviewer_unassessable_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewer_unassessable_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_findings_pending_review ON findings(case_id)
  WHERE reviewer_confirmed = FALSE AND reviewer_unassessable = FALSE;

DROP POLICY IF EXISTS escalations_rev ON escalations;
DROP POLICY IF EXISTS escalations_exp ON escalations;

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
