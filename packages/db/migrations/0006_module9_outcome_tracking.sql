-- Migration: Module 9 outcome tracking token/action split and evidence analytics support
-- Why: Module 9 requires token_type as authorization scope only and patient_action_type
-- as the submitted patient action state. Existing pilot schema still had action_type.

ALTER TABLE outcomes
  ADD COLUMN IF NOT EXISTS patient_action_type TEXT NOT NULL DEFAULT 'none';

ALTER TABLE outcomes
  DROP CONSTRAINT IF EXISTS outcomes_patient_action_type_check;

ALTER TABLE outcomes
  ADD CONSTRAINT outcomes_patient_action_type_check
  CHECK (patient_action_type IN (
    'none','asked_hospital','asked_insurer_tpa',
    'submitted_appeal','waiting_response','closed_no_benefit'
  ));

ALTER TABLE outcome_tokens
  ADD COLUMN IF NOT EXISTS token_type TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'outcome_tokens'
      AND column_name = 'action_type'
  ) THEN
    UPDATE outcome_tokens
    SET token_type = CASE
      WHEN action_type = 'full_outcome_form' THEN 'full_outcome'
      ELSE 'quick_update'
    END
    WHERE token_type IS NULL;
  END IF;
END $$;

UPDATE outcome_tokens
SET token_type = 'quick_update'
WHERE token_type IS NULL;

ALTER TABLE outcome_tokens
  ALTER COLUMN token_type SET NOT NULL;

ALTER TABLE outcome_tokens
  DROP CONSTRAINT IF EXISTS outcome_tokens_token_type_check;

ALTER TABLE outcome_tokens
  ADD CONSTRAINT outcome_tokens_token_type_check
  CHECK (token_type IN ('quick_update','full_outcome'));

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'outcome_tokens'
      AND column_name = 'action_type'
  ) THEN
    ALTER TABLE outcome_tokens DROP COLUMN action_type;
  END IF;
END $$;

COMMENT ON COLUMN outcome_tokens.token_type IS
  'Authorization scope only: quick_update or full_outcome. Actual submitted action belongs in POST body.';

COMMENT ON COLUMN outcomes.patient_action_type IS
  'Patient-reported action state only. Do not force workflow/action states into outcome_type.';

CREATE INDEX IF NOT EXISTS idx_outcome_tokens_hash ON outcome_tokens(token_hash);
