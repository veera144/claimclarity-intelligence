# ClaimClarity Local Pilot Runbook

## Purpose

This runbook is for running and verifying the ClaimClarity flow in a local or staging pilot environment. It is not production readiness guidance and must not be used to claim production readiness.

Use this with:

- `MASTER_SPEC.md`
- `IMPLEMENTATION_CHECKLIST.md`
- `README.md`
- `docs/MODULE_FLOW_AND_ARCHITECTURE.md`

Local pilot status means the capability checkpoint suites passed in local/test mode. Live Textract and live OpenAI smoke tests remain pending unless a pilot operator explicitly runs and records those checks with approved credentials.

## How To Read This Repository

Product and architecture documents use capability names such as Document Intake and Quality Check, AI Explanation and Drafting, and Reviewer Approval Workflow.

`IMPLEMENTATION_CHECKLIST.md` remains the internal implementation tracker. It uses module numbers for build tracking, checkpoint history, and test-script mapping.

## Guardrails

- Do not use real patient data in local runs.
- Do not commit secrets or real documents.
- Do not describe this repository as ready for production use.
- Do not send raw OCR text to the AI layer.
- Do not use raw `caseRef` alone for state-changing outcome updates.
- Keep `finding_id` values full length through the AI layer.
- Keep money units strict:
  - `cases.claim_amount_inr`: whole rupees
  - `payments.amount_inr`: paise
  - `findings.bill_amount_inr`: paise
  - `outcomes.*_inr`: whole rupees
- Reviewer sign-off is mandatory before patient delivery.

## 1. Prerequisites

Install or prepare:

- Node.js 20 or newer.
- pnpm through Corepack or a trusted local installation.
- A Supabase local or staging project with Auth, PostgreSQL, Storage, and RLS enabled.
- Local env files copied from `.env.example`.
- Supabase storage buckets:
  - `case-documents`
  - `reports`
  - `outcome-evidence`
- A private S3 staging bucket for Textract async PDF/TIFF handoff when live OCR is used.
- AWS credentials with least-privilege access to Textract and the staging bucket.
- OpenAI API key for live draft generation, or a deliberate fallback test plan.
- Razorpay test keys, or one of the local pilot internal payment controls.
- Resend placeholder config or real test-safe sender config.
- Local/staging admin, reviewer, expert, and patient test users.

Razorpay and Resend may use test, placeholder, or internal-control paths for a local pilot. Live Razorpay and verified Resend sender/domain checks are separate production-pilot work.

## 2. Install Dependencies

From the repository root:

```powershell
corepack enable
pnpm install
```

If Corepack is already enabled, `pnpm install` is enough.

## 3. Create Env Files

Copy the env template:

```powershell
Copy-Item .env.example .env.local
Copy-Item .env.example apps/web/.env.local
Copy-Item .env.example apps/dashboard/.env.local
```

If a file already exists, update it manually instead of overwriting known-good local secrets.

The processor dev script loads the root `.env.local`. The two Next.js apps load their own
`apps/web/.env.local` and `apps/dashboard/.env.local` files.

Never put real secrets in this runbook or in committed files.

## 4. Required Env Checklist

Set these values in root `.env.local` and app env files as needed:

```text
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

OPENAI_API_KEY=
OPENAI_AI_DRAFT_MODEL=gpt-5.4
OPENAI_AI_DRAFT_FALLBACK_MODEL=gpt-5.4-mini
OPENAI_AI_DRAFT_FALLBACK_MODEL_VALIDATED=false

RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

RESEND_API_KEY=
RESEND_FROM_EMAIL=reports@claimclarity.in
RESEND_DOMAIN=claimclarity.in
ADMIN_EMAIL=admin@claimclarity.in

INTERNAL_WEBHOOK_SECRET=
KB_SEED_ADMIN_USER_ID=

NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_DASHBOARD_URL=http://localhost:3001
PRIVACY_POLICY_VERSION=v1.0-2024-04-01
TERMS_VERSION=v1.0-2024-04-01
RAILWAY_HEALTH_CHECK_PATH=/health

INTERNAL_ACCESS_CODE_SHA256_HASHES=
ALLOW_TEST_SIMULATED_PAYMENTS=false
```

Notes:

- `AWS_TEXTRACT_STAGING_BUCKET` is required by the live Textract adapter for async PDF/TIFF processing.
- `OPENAI_API_KEY` is required for the processor config and live draft attempts.
- `KB_SEED_ADMIN_USER_ID` must reference a real `users.id` row with `role='admin'`.
- For local simulated payment, set `ALLOW_TEST_SIMULATED_PAYMENTS=true` only outside production.
- For internal access-code payment control, store SHA-256 hashes only in `INTERNAL_ACCESS_CODE_SHA256_HASHES`.

## 5. Platform Foundation Database Migration Checklist

Apply database changes to the local/staging Supabase project in order:

```text
packages/db/migrations/0001_initial_schema.sql
packages/db/migrations/0002_repair_auth_user_trigger.sql
packages/db/migrations/0003_module2_case_ref_sequence_rpc.sql
packages/db/migrations/0004_module3_payment_modes.sql
packages/db/migrations/0005_module7_unassessable_findings.sql
packages/db/migrations/0006_module9_outcome_tracking.sql
```

Then verify:

- Required tables exist.
- RLS is enabled.
- `case-documents`, `reports`, and `outcome-evidence` storage buckets exist and are private.
- `case_ref_seq` and verification RPCs exist.
- Audit log immutability is active.
- Anonymous users cannot read protected tables.

Run Platform Foundation verification:

```powershell
node --loader ts-node/esm/transpile-only --experimental-specifier-resolution=node packages/db/src/verify.ts
```

## 6. Rules Engine and Knowledge Base Seed and Admin Prerequisites

Create test users in Supabase Auth:

- patient
- reviewer
- expert
- admin

The auth trigger should create matching `users` rows. Confirm and update roles in the database:

```sql
update users set role = 'admin' where email = 'admin@example.test';
update users set role = 'reviewer' where email = 'reviewer@example.test';
update users set role = 'expert' where email = 'expert@example.test';
```

Set `KB_SEED_ADMIN_USER_ID` to the admin user's UUID.

Seed the knowledge base:

```powershell
node --loader ts-node/esm/transpile-only --experimental-specifier-resolution=node apps/processor/src/knowledgeBase/seed.ts
```

Expected result:

```text
Module 5 KB seed complete. Active patterns: 16
```

## 7. Run Web, Dashboard, and Processor Locally

Use three terminals from the repository root.

Patient web app:

```powershell
pnpm --filter @claimclarity/web dev
```

Open:

```text
http://localhost:3000
```

Internal dashboard:

```powershell
pnpm --filter @claimclarity/dashboard dev:local
```

Open:

```text
http://localhost:3001
```

Processor health service:

```powershell
$env:PORT='3002'
pnpm --filter @claimclarity/processor dev
```

Open:

```text
http://localhost:3002/health
```

Current note: the processor entry point exposes health/readiness only. It does not expose HTTP job execution endpoints. Queue processors are implemented as exported job functions and are exercised by capability checkpoint tests. For local pilot operation, run the web/dashboard normally, keep processor health running, and use the one-shot operator commands below when queued jobs need to be advanced manually.

## 8. Validation Commands

Run these before and after a local pilot dry run:

```powershell
pnpm lint
pnpm typecheck
pnpm --filter @claimclarity/web build
pnpm --filter @claimclarity/dashboard build
```

Local E2E route map verification:

```powershell
Test-Path -LiteralPath 'apps/web/app/app/cases/[caseRef]/status/page.tsx'
Test-Path -LiteralPath 'apps/dashboard/app/admin/cases/[caseId]/assignment/page.tsx'
Test-Path -LiteralPath 'apps/dashboard/app/admin/cases/[caseId]/manual-ocr/page.tsx'
Test-Path -LiteralPath 'apps/processor/src/cli/run-job.ts'
```

Capability checkpoint commands available in this repository:

```powershell
pnpm test:module1
pnpm test:module2
pnpm test:module3
pnpm test:module4
pnpm test:module5
pnpm test:module6
pnpm test:ai-regression
pnpm test:module7
pnpm test:module8
pnpm test:module9
pnpm test:module10
```

Live Textract smoke command:

```powershell
pnpm smoke:textract
```

By default this prints pending unless `TEXTRACT_LIVE_SMOKE=1` is set. Treat live Textract as pending unless the smoke test has explicitly passed with approved AWS credentials.

Optional live OpenAI smoke command:

```powershell
pnpm smoke:openai
```

By default this prints pending. It only calls OpenAI when `OPENAI_LIVE_SMOKE=1` and `OPENAI_API_KEY` are set. The smoke uses synthetic non-case data and must not be run as part of default local validation.

One-shot processor job commands:

```powershell
$env:CASE_ID='<optional case uuid>'
pnpm job:quality
pnpm job:ocr
pnpm job:rules
pnpm job:ai
pnpm job:report
pnpm job:email
pnpm job:followups
pnpm job:sla
pnpm job:stale
pnpm job:all-once
```

`CASE_ID` scopes case-specific jobs where supported. The commands print concise counts only and must not print secrets, raw OCR text, AI prompts, or extracted document content.

One-shot quality job example:

```powershell
$env:CASE_ID='<case uuid>'
pnpm job:quality
```

## 9. Create a Test Patient

Option A, patient self-signup:

1. Open `http://localhost:3000/signup`.
2. Create a patient test account with a non-real email address controlled by the pilot operator.
3. Complete Supabase email confirmation if the local/staging project requires it.
4. Sign in at `http://localhost:3000/login`.

Option B, Supabase Auth admin:

1. Create the user in the Supabase Auth dashboard.
2. Confirm the auth trigger created a `users` row.
3. Keep the role as `patient`.

Option C, admin-created pilot case:

1. Sign in to `http://localhost:3001` as an admin.
2. Open `/admin/cases/new`.
3. Enter the patient email and case metadata.
4. Submit the form to create an `admin_waived` pilot case.

## 10. Authentication and Consent

As the patient:

1. Open `http://localhost:3000/app/consent`.
2. Accept all five required consent items:
   - `data_processing`
   - `no_training`
   - `retention_policy`
   - `informational_only`
   - `terms_of_service`
3. Submit the consent form.
4. Confirm the app redirects to `/app/upload`.

Expected database state:

- Five `consents` rows exist for the patient.
- `privacy_policy_version` and `terms_version` match env.
- `source_channel='patient_web'`.
- IP address is masked.

## 11. Authentication and Consent Case Creation

Patient-created case:

1. Open `http://localhost:3000/app/upload` after consent.
2. Choose `Start new case`. The page calls `POST /api/cases` only after this explicit action.
3. Record the returned case reference shown on the upload page.

Patient case resume:

1. Open `http://localhost:3000/app/dashboard`.
2. Review the authenticated patient's own case list.
3. Choose `Resume upload`, `Continue to payment`, `Open report`, or `Status` based on the displayed next action.
4. To resume document upload directly, open `http://localhost:3000/app/upload?caseId=<case uuid>`.
5. To check progress, open `http://localhost:3000/app/cases/<caseRef>/status`.

Expected database state:

- `cases.status='documents_pending'`
- `cases.intake_channel='patient_web'`
- `reports` row is pre-created.
- `outcomes` row is pre-created with pending state.

Admin-created waived case:

1. Open `http://localhost:3001/admin/cases/new` as an admin.
2. Enter patient email, claim amount in whole rupees, insurer, procedure category, and case type.
3. Submit.

Expected database state:

- `cases.payment_waived=true`
- `cases.payment_mode='admin_waived'`
- `cases.payment_reporting_category='waived'`
- No Razorpay payment row is created.

## 12. Document Intake and Quality Check

As the patient, open `http://localhost:3000/app/upload`.

The upload page does not create a case automatically. Choose an existing resumable case or choose `Start new case`.

Upload the three required document slots:

- Policy document or Certificate of Insurance:
  - `policy` or `cis`
- Hospital bill:
  - `hospital_bill`
- Insurer or TPA response letter:
  - `insurer_response`

Accepted file types:

- PDF
- JPEG
- PNG
- TIFF

Maximum size:

- 20 MB per document

Optional document types:

- `discharge_summary`
- `preauth_letter`
- `investigation_report`
- `prescription`
- `prior_policy`
- `payment_receipt`
- `prior_correspondence`
- `other`

Expected database/storage state:

- Objects are stored in private `case-documents`.
- Storage paths use UUID-style object names, not original filenames.
- `documents.quality_status='pending'` immediately after upload.
- A `quality_check` job is queued for each document.

## 13. Document Intake and Quality Check Review

Process queued quality-check jobs for one case:

```powershell
$env:CASE_ID='<case uuid>'
pnpm job:quality
```

Pass path:

- Upload readable, supported files.
- Run the quality job command.
- Confirm required documents reach `quality_status='pass'`.
- For real-payment cases, confirm case status moves to `payment_pending`.
- For waived/simulated cases, confirm case status moves to `processing` and OCR jobs are queued.

Fail path:

- Upload an unsupported MIME type, oversized file, unreadable file, low-resolution JPEG, or unsupported-language document.
- Confirm the API rejects invalid MIME/size before storage where applicable.
- Confirm `documents.quality_status='fail'` or `manual_required` for processing failures.
- Confirm a patient email job or reviewer notification is queued as appropriate.

## 14. Payment and Access Controls

### Razorpay Test Flow

Use this path for a paid local/staging case:

1. Set Razorpay test `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET`.
2. Upload all required documents and pass quality checks.
3. Open `/app/cases/<caseRef>/pay` as the patient.
4. Click the Razorpay payment button.
5. Complete checkout with Razorpay test-mode controls from the Razorpay test dashboard.
6. Confirm `payments.status='paid'`.
7. Confirm case moves from `payment_pending` to `processing`.
8. Confirm OCR jobs are queued.

Do not use live Razorpay credentials for a local pilot dry run.

### Admin Waiver

Use this path for an admin-approved local pilot waiver:

1. Sign in to the dashboard as an admin.
2. Create a waived pilot case at `/admin/cases/new`, or call `POST /api/payments/controls` as an admin for an existing `payment_pending` case.

Request body for an existing case:

```json
{
  "caseId": "<case uuid>",
  "mode": "admin_waived",
  "reason": "local pilot dry run"
}
```

Expected state:

- `payment_mode='admin_waived'`
- `payment_reporting_category='waived'`
- No Razorpay call.
- No `payments` row.

### Internal Access-Code Path

Use this path for allowlisted internal pilot activation:

1. Choose a local-only access code.
2. Store only its SHA-256 hex hash in `INTERNAL_ACCESS_CODE_SHA256_HASHES`.
3. Sign in as the patient who owns the case.
4. Call `POST /api/payments/controls`.

Request body:

```json
{
  "caseId": "<case uuid>",
  "mode": "internal_access_code",
  "accessCode": "<local-only code>"
}
```

Expected state:

- Server validates the hash.
- `payment_mode='internal_access_code'`
- `payment_reporting_category='waived'`
- No Razorpay call.
- No `payments` row.

### Test-Simulated Path

Use this path only in non-production local/staging runs:

1. Set `ALLOW_TEST_SIMULATED_PAYMENTS=true`.
2. Ensure `NODE_ENV` is not `production`.
3. Sign in as the patient who owns the case.
4. Call `POST /api/payments/controls`.

Request body:

```json
{
  "caseId": "<case uuid>",
  "mode": "test_simulated"
}
```

Expected state:

- `payment_mode='test_simulated'`
- `payment_reporting_category='test'`
- No Razorpay call.
- No `payments` row.
- Test cases are excluded from default product-proof analytics.

## 15. OCR and Extraction Pipeline

### Live Textract Path

Prerequisites:

- AWS credentials set.
- `AWS_REGION` set.
- `AWS_TEXTRACT_STAGING_BUCKET` set.
- S3 staging bucket is private and has lifecycle cleanup.
- Required documents have passed quality checks.
- OCR jobs are queued.

Process queued OCR jobs:

```powershell
$env:CASE_ID='<case uuid>'
pnpm job:ocr
```

Expected state:

- `documents.ocr_status='completed'`
- `documents.extracted_json` uses schema `module4.v1`
- `documents.extracted_text` remains null for AI safety
- `cases.original_approved_inr` and `cases.originally_deducted_inr` are populated when insurer letter extraction finds those values
- `rules_engine` job is queued only after required structured extraction is usable

Live Textract smoke is pending unless `pnpm smoke:textract` has passed with `TEXTRACT_LIVE_SMOKE=1`.

### Manual Fallback Path

Use this when OCR returns `manual_required`, live Textract is unavailable, or a document cannot be extracted safely.

Rules:

- Enter normalized structured extraction only.
- Do not persist raw OCR text for AI use.
- Keep bill line amounts in paise.
- Keep insurer approved/deducted amounts in whole rupees.

Complete manual extraction through the dashboard shell:

1. Sign in to `http://localhost:3001` as an admin or as the assigned reviewer.
2. Open `/admin/cases/<caseId>/manual-ocr`.
3. Complete the structured JSON form for each eligible failed or manual-required document.
4. Submit. The server validates the structured shape, calls the existing manual completion path, and audits document ID, schema type, actor, and completion.

For a useful end-to-end rules-engine run, provide document-specific normalized data:

- Hospital bill: `bill_lines`
- Policy or CIS: `policy_chunks`
- Insurer response: `insurer_letter`

## 16. Rules Engine and Knowledge Base

Prerequisites:

- KB seed completed.
- Required documents have usable `extracted_json`.
- `rules_engine` job is queued.

Process queued rules-engine jobs:

```powershell
$env:CASE_ID='<case uuid>'
pnpm job:rules
```

Expected state:

- `findings` rows are created.
- `cases.confidence_overall` is updated.
- `cases.current_step='ai_draft'`.
- `ai_draft_generation` job is queued.
- Case status remains `processing`; Rules Engine and Knowledge Base must not set `ai_draft_ready`.

If the benchmark gate fails, stop and fix KB/test data before continuing.

## 17. AI Explanation and Drafting

Prerequisites:

- Rules-engine findings exist.
- `assigned_reviewer_id` is set for the case.
- `ai_draft_generation` job is queued.
- `OPENAI_API_KEY` is set.

Process queued AI draft jobs:

```powershell
$env:CASE_ID='<case uuid>'
pnpm job:ai
```

Expected state:

- AI receives structured findings only.
- Full `finding_id` values are preserved.
- Raw OCR text is not sent.
- `cases.ai_draft` is populated.
- Case moves to `status='ai_draft_ready'`.
- `current_step='awaiting_review'`.
- Reviewer notification is created.

Live OpenAI smoke is pending unless `pnpm smoke:openai` has explicitly passed with `OPENAI_LIVE_SMOKE=1`. AI Explanation and Drafting supports deterministic fallback when token budget, provider, JSON, schema, or semantic validation fails. Fallback output is still internal and reviewer-gated.

For fallback-only confidence during local pilot, run:

```powershell
pnpm test:module6
pnpm test:ai-regression
```

## 18. Reviewer Approval Workflow

Prerequisites:

- Reviewer user exists.
- Case has `assigned_reviewer_id` set to that reviewer, or admin is reviewing.
- Case status is `ai_draft_ready`.

Assign reviewer and expert:

1. Sign in to `http://localhost:3001` as an admin.
2. Open `/admin/cases/<caseId>/assignment`.
3. Choose a reviewer from users with role `reviewer`.
4. Choose an expert from users with role `expert` when expert escalation may be needed.
5. Submit. The server audits old and new reviewer/expert IDs.

Steps:

1. Sign in to `http://localhost:3001` as reviewer or admin.
2. Open `/queue`.
3. Select the case.
4. Confirm each finding, edit explanations where needed, or mark a finding unassessable with a reason.
5. Review hospital questions, insurer questions, appeal points, and appeal letter.
6. Confirm the appeal letter.
7. Resolve or avoid open expert escalations.
8. Click `Sign off and generate report`.

Expected state:

- Case moves through `under_review` and then `approved`.
- `reports.signed_off_by` and `reports.signed_off_at` are set.
- `report_generation` job is queued.

Sign-off must fail if findings are not confirmed/unassessable or if open escalations exist.

## 19. Report Generation and Delivery

Prerequisites:

- Case status is `approved`.
- `report_generation` job is queued.
- `reports` row has reviewer sign-off metadata.
- `reports` storage bucket exists.

Process queued report-generation jobs:

```powershell
$env:CASE_ID='<case uuid>'
pnpm job:report
```

Expected state:

- Case moves `approved -> generating_report -> delivered`.
- PDF is stored privately in the `reports` bucket.
- Report contains only reviewer-approved content.
- Follow-up schedule rows are created for 30, 60, and 90 days.
- Email delivery job is queued.

If Resend is configured only as a placeholder, report generation can still verify PDF/storage/delivery state, but live email delivery is not verified.

Process queued report email jobs only when using real test-safe Resend config:

```powershell
$env:CASE_ID='<case uuid>'
pnpm job:email
```

## 20. Report Generation and Delivery Patient Access

As the patient:

1. Sign in to `http://localhost:3000`.
2. Open `/app/cases/<caseRef>/status` and confirm the report action is available.
3. Open `/app/cases/<caseRef>/report`.
4. Click the download button.

Expected state:

- Patient must be authenticated.
- Patient must own the case.
- Report must be delivered.
- API returns a short-lived signed URL through the app.
- Email must contain an app link only, not a Supabase storage URL.

## 21. Outcome Tracking and Value Measurement

Session path:

1. Sign in as the patient.
2. Open `/app/cases/<caseRef>/status` or `/app/outcomes/<caseRef>`.
3. Select the patient action.
4. If the insurer/TPA responded, enter final settled amount in whole rupees.
5. Optionally upload evidence as PDF/JPEG/PNG.
6. Submit.

Token path:

- Outcome reminders create one-time signed tokens immediately before reminder sends.
- Quick updates use `POST /api/outcomes/quick-update`.
- Full updates may include a token in the outcome form request.

Expected state:

- Outcome update requires patient session or valid one-time token.
- Token is one-use and expires.
- Raw `caseRef` alone is not authorization.
- `outcomes.final_settled_amount_inr` is whole rupees.
- `outcomes.reversal_amount_inr` is generated/stored as whole rupees.
- Evidence upload sets `outcome_confidence='document_verified'`; otherwise self-report remains possible.
- High-value self-reported wins are flagged for manual follow-up.

## 22. Operations, Monitoring, and Analytics

Sign in as an admin at `http://localhost:3001`.

Check:

- `/admin` for operations landing.
- `/queue` for reviewer queue state.
- `/admin/sla-breaches` for breached cases.
- `/admin/stuck-jobs` for stale processing jobs.
- `/admin/failed-reminders` for failed outcome reminders.
- `/admin/pending-outcomes` for pending delivered-case outcomes.
- `/admin/manual-followups` for cases requiring manual follow-up.
- `/admin/high-value-wins` for high-value reported wins.
- `/admin/payment-segmentation` for paid/waived/test separation.
- `/admin/audit` for audit visibility.
- `/admin/cases/<caseId>/assignment` for admin-only reviewer/expert assignment.
- `/admin/cases/<caseId>/manual-ocr` for eligible structured manual OCR completion.
- `http://localhost:3002/health` for processor database and queue health.

Run local operations jobs as needed:

```powershell
pnpm job:followups
pnpm job:sla
pnpm job:stale
```

Expected verification:

- Paid, waived, and test/simulated cases remain separated.
- Test cases are excluded from default product-proof analytics.
- Whole-rupee outcome analytics are not divided by 100.
- Reviewers see assigned cases only.
- Admin-only pages deny non-admin users.

## 23. Full Happy-Path Checklist

Use one local/staging test case:

- [ ] Supabase migrations applied in order.
- [ ] Storage buckets created and private.
- [ ] Env files populated with local/staging values only.
- [ ] Admin, reviewer, expert, and patient test users exist.
- [ ] `KB_SEED_ADMIN_USER_ID` points to admin user.
- [ ] KB seed command completed with 16 active patterns.
- [ ] Web app running on `http://localhost:3000`.
- [ ] Dashboard running on `http://localhost:3001`.
- [ ] Processor health running on `http://localhost:3002/health`.
- [ ] Patient signs up/signs in.
- [ ] Patient submits all five consents.
- [ ] Patient opens `/app/dashboard` and explicitly starts or resumes a case.
- [ ] Patient case created with reports/outcomes rows only after explicit start.
- [ ] Required documents uploaded.
- [ ] Quality checks pass.
- [ ] Payment completed through Razorpay test, admin waiver, internal code, or test simulation.
- [ ] OCR path produces structured `extracted_json` or approved manual fallback.
- [ ] Admin assigns reviewer/expert through `/admin/cases/<caseId>/assignment`.
- [ ] Rules engine creates findings and queues AI draft.
- [ ] OpenAI draft generation succeeds or deterministic fallback is recorded.
- [ ] Reviewer confirms/edits findings and signs off.
- [ ] Report generation job delivers private PDF.
- [ ] Patient checks `/app/cases/<caseRef>/status`.
- [ ] Patient downloads report after login.
- [ ] Patient submits outcome through session or valid token.
- [ ] Ops dashboard shows correct case, payment segment, outcome, and audit state.
- [ ] Validation commands pass.

## 24. Failure-Path Checklist

Exercise these before a pilot demo:

- [ ] Unauthenticated patient cannot access upload/report/outcome session pages.
- [ ] Missing consent blocks case creation.
- [ ] Invalid MIME type upload is rejected.
- [ ] Oversized upload is rejected.
- [ ] Low-quality document becomes `fail` or `manual_required`.
- [ ] Payment cannot start before required documents pass.
- [ ] Tampered Razorpay verification fails.
- [ ] Waived and simulated payment modes create no `payments` rows.
- [ ] Live Textract unavailable path goes to manual-required fallback.
- [ ] Rules engine blocks if benchmark gate fails.
- [ ] AI provider/schema/token/semantic failure uses deterministic fallback or marks the job failed with audit, and no patient delivery occurs.
- [ ] Reviewer sign-off is blocked until findings are confirmed or unassessable.
- [ ] Reviewer sign-off is blocked while expert escalations are open.
- [ ] Report generation fails closed if preflight requirements are not met.
- [ ] Wrong patient cannot download another patient's report.
- [ ] Outcome update fails with missing, expired, used, or wrong token.
- [ ] Raw `caseRef` alone cannot mutate outcome state.
- [ ] Resend failure creates retry/failure audit without exposing internals to patients.
- [ ] Ops dashboard shows stuck jobs, failed reminders, and payment segmentation.

## 25. Troubleshooting

### `pnpm install` fails

- Confirm Node is installed.
- Run `corepack enable`.
- Confirm you are in the repository root.

### Web or dashboard starts on the wrong port

- Web defaults to 3000.
- Start dashboard with `pnpm --filter @claimclarity/dashboard dev:local`.
- Windows-safe alternative: `pnpm --filter @claimclarity/dashboard exec next dev -p 3001`.
- If either app renders with unprocessed Tailwind classes or very limited styling, stop and restart that app's dev server after any Tailwind or PostCSS config changes so Next reloads the local CSS toolchain.
- Confirm env values:
  - `NEXT_PUBLIC_APP_URL=http://localhost:3000`
  - `NEXT_PUBLIC_DASHBOARD_URL=http://localhost:3001`

### Processor exits at startup

- The processor calls fail-fast config validation.
- Check root `.env.local` for required Supabase, OpenAI, Razorpay, Resend, app URL, privacy, and terms values.
- The processor package script loads root `.env.local`; run it from the repository root with `pnpm --filter @claimclarity/processor dev`.
- Placeholder values may start the service, but live provider calls will not be verified.

### Platform Foundation verification fails

- Reapply migrations in order.
- Confirm storage buckets exist.
- Confirm verification helper RPCs exist.
- Confirm RLS is enabled on protected tables.
- Confirm `SUPABASE_SERVICE_ROLE_KEY` belongs to the target local/staging project.

### Consent saves fail

- Confirm the patient is logged in.
- Confirm all five checkboxes are selected.
- Confirm Supabase Auth cookies work for `localhost`.

### Upload fails

- Confirm file type is PDF/JPEG/PNG/TIFF.
- Confirm file is under 20 MB.
- Confirm the `case-documents` bucket exists.
- Confirm service-role key is set.

### Quality checks stay pending

- Run the quality job operator command with the correct `CASE_ID`.
- Confirm queued `processing_jobs` rows have `job_type='quality_check'`.
- Check storage object access through the service role.

### Case does not move to payment

- Confirm all three required slots passed:
  - policy or CIS
  - hospital bill
  - insurer response
- Confirm the case is not already waived/simulated.
- Confirm `cases.status='documents_pending'` before quality advancement.

### Razorpay checkout does not load

- Confirm Razorpay test key env values.
- Confirm browser network access can load Razorpay checkout script.
- For local pilot, use admin waiver, internal access code, or test simulation if Razorpay test checkout is not the path being verified.

### Internal access code fails

- Confirm only SHA-256 hashes are stored in `INTERNAL_ACCESS_CODE_SHA256_HASHES`.
- Confirm the submitted code exactly matches the hashed local test code.
- Confirm the logged-in patient owns the case.
- Confirm the case is still `payment_pending`.

### Test simulation fails

- Confirm `ALLOW_TEST_SIMULATED_PAYMENTS=true`.
- Confirm `NODE_ENV` is not `production`.
- Confirm the logged-in patient owns the case.

### OCR jobs fail or stay manual-required

- Confirm `AWS_TEXTRACT_STAGING_BUCKET` is set when using live Textract.
- Confirm AWS credentials and region.
- Confirm S3 staging bucket blocks public access and permits put/get/delete for the local test principal.
- Use manual fallback for local pilot if live Textract is not explicitly verified.

### Rules Engine and Knowledge Base creates no findings

- Confirm KB seed has run.
- Confirm hospital bill extraction contains `bill_lines`.
- Confirm policy/CIS extraction contains `policy_chunks`.
- Confirm insurer response extraction contains `insurer_letter`.
- Confirm amounts are in the expected units.

### AI Explanation and Drafting job fails

- Confirm `assigned_reviewer_id` is set.
- Confirm rules-engine findings exist.
- Confirm `OPENAI_API_KEY` is set.
- If the goal is fallback verification, run `pnpm test:module6` and `pnpm test:ai-regression`.
- Treat live OpenAI as pending unless explicitly smoke-verified.

### Reviewer cannot see a case

- Confirm the dashboard user role is `reviewer`, `expert`, or `admin`.
- Confirm reviewer is assigned to the case.
- Admins can see all internal cases; reviewers should see assigned cases only.

### Sign-off button is blocked

- Confirm every finding is confirmed or marked unassessable with a reason.
- Confirm appeal letter is reviewed/confirmed.
- Resolve open expert escalations.

### Report download redirects away

- Confirm the patient is logged in.
- Confirm the patient owns the case.
- Confirm case status is `delivered`.
- Confirm `reports.delivered_at` is set.
- Confirm `reports.pdf_storage_path` points to the private `reports` bucket.

### Outcome update fails

- For session path, confirm patient is logged in and owns the delivered case.
- For token path, confirm token is valid, unexpired, unused, and for the correct action type.
- Do not attempt state-changing updates with raw `caseRef` alone.

### Ops dashboard numbers look wrong

- Confirm test/simulated cases are excluded from default product-proof analytics.
- Confirm payment modes are not inferred from missing `payments` rows.
- Confirm outcome amounts are whole rupees and are not divided by 100.
