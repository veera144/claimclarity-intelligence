-- Migration: add explicit Module 3 payment modes and reporting categories.
-- Waived and simulated cases must remain separated from real Razorpay payments.

ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS payment_mode TEXT NOT NULL DEFAULT 'real_payment',
  ADD COLUMN IF NOT EXISTS payment_reporting_category TEXT NOT NULL DEFAULT 'paid';

ALTER TABLE cases
  DROP CONSTRAINT IF EXISTS cases_payment_mode_allowed,
  ADD CONSTRAINT cases_payment_mode_allowed CHECK (
    payment_mode IN (
      'real_payment',
      'admin_waived',
      'internal_access_code',
      'test_simulated'
    )
  );

ALTER TABLE cases
  DROP CONSTRAINT IF EXISTS cases_payment_reporting_category_allowed,
  ADD CONSTRAINT cases_payment_reporting_category_allowed CHECK (
    payment_reporting_category IN ('paid','waived','test')
  );

UPDATE cases
SET
  payment_mode = CASE
    WHEN payment_waived = TRUE THEN 'admin_waived'
    ELSE 'real_payment'
  END,
  payment_reporting_category = CASE
    WHEN payment_waived = TRUE THEN 'waived'
    ELSE 'paid'
  END
WHERE payment_mode = 'real_payment'
  AND payment_reporting_category = 'paid';

ALTER TABLE cases
  DROP CONSTRAINT IF EXISTS cases_payment_mode_consistency,
  ADD CONSTRAINT cases_payment_mode_consistency CHECK (
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
  );

COMMENT ON COLUMN cases.payment_mode IS
  'How Module 3 allowed the case to enter processing: real_payment, admin_waived, internal_access_code, or test_simulated.';

COMMENT ON COLUMN cases.payment_reporting_category IS
  'Reporting separation for downstream analytics: paid, waived, or test. Do not infer from payments rows alone.';
