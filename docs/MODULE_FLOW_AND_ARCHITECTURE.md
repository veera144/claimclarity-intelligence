# ClaimClarity Capability Flow and Architecture

## Purpose and Readiness

This document explains the ClaimClarity flow by product capability for product, architecture, engineering, QA, and operations readers. It is derived from `MASTER_SPEC.md`, `IMPLEMENTATION_CHECKLIST.md`, `README.md`, and the capability checkpoint suites.

ClaimClarity V1 is an India-only, local-pilot workflow for claim clarity and appeal drafting. It does not decide claims, predict approval, provide treatment advice, provide legal advice, or make fraud accusations. AI is used only to explain and draft from structured rules-engine findings. AI Explanation and Drafting does not decide claims. Reviewer Approval Workflow sign-off is mandatory in V1 before any patient-facing report is delivered.

Current readiness is local-pilot ready only. It is not production-pilot ready. Live Textract smoke is pending. Live OpenAI smoke is pending. Razorpay live checkout/webhook/refund validation, Resend sender/domain verification, Sentry configuration, production secrets verification, deployment configuration, and admin seed prerequisites are also pending.

## How To Read This Repository

Product and architecture documents use capability names to describe the patient, reviewer, processor, and operations flow.

`IMPLEMENTATION_CHECKLIST.md` remains the internal implementation tracker. It uses module numbers for build tracking, checkpoint history, and test-script mapping.

## End-to-End Flow

```text
Platform Foundation
  -> Supabase auth, database, RLS, storage, audit log, monorepo, env contracts

Authentication and Consent
  -> patient account/session
  -> required consent rows
  -> case intake allowed only after consent

Document Intake and Quality Check
  -> protected document objects
  -> document rows
  -> quality pass/fail/manual-required state
  -> case moves to payment_pending or processing for waived/simulated cases

Payment and Access Controls
  -> real Razorpay payment or explicit approved pilot bypass
  -> processing activated
  -> OCR jobs queued

OCR and Extraction Pipeline
  -> AWS Textract extraction or manual-required fallback
  -> normalized extracted_json
  -> original approved/deducted amounts copied for later outcome comparison
  -> rules_engine job queued only after usable structured extraction exists

Rules Engine and Knowledge Base
  -> KB-backed findings
  -> confidence labels and appeal metadata
  -> AI draft generation job queued only after benchmark gate passes

AI Explanation and Drafting
  -> OpenAI structured draft from rules-engine findings only
  -> deterministic fallback if unsafe, invalid, or over budget
  -> case becomes ai_draft_ready / awaiting_review
  -> reviewer notification created

Reviewer Approval Workflow
  -> assigned reviewer reviews findings and AI draft
  -> expert escalation when needed
  -> mandatory sign-off
  -> approved case queues report_generation

Report Generation and Delivery
  -> reviewer-approved report PDF
  -> secure report storage
  -> delivery email with app link only
  -> delivered case and follow-up schedule

Outcome Tracking and Value Measurement
  -> patient session or one-time signed token updates outcome
  -> optional evidence upload
  -> whole-rupee reversal analytics

Operations, Monitoring, and Analytics
  -> SLA monitoring
  -> reminder operations
  -> health checks
  -> audit/analytics/admin operations
  -> redaction and production-readiness support
```

## Data Flow From Upload to Outcome Tracking and Value Measurement

```text
Patient session
  -> consents
  -> cases
  -> documents + private storage paths
  -> processing_jobs: quality_check
  -> documents.quality_status
  -> payment mode activation
  -> processing_jobs: ocr
  -> documents.extracted_json
  -> cases.original_approved_inr / cases.originally_deducted_inr
  -> outcomes.original_approved_inr / outcomes.originally_deducted_inr
  -> processing_jobs: rules_engine
  -> findings
  -> processing_jobs: ai_draft_generation
  -> cases.ai_draft
  -> reviewer confirmations, edits, escalations, audit_log
  -> reports.signed_off_by / reports.signed_off_at
  -> processing_jobs: report_generation
  -> reports.pdf_storage_path and delivery metadata
  -> follow_up_schedule
  -> outcome_tokens created immediately before reminder sends
  -> outcomes updates through patient session or valid one-time token
  -> outcome analytics, SLA operations, and admin dashboards
```

Raw uploaded documents stay in protected storage. OCR and Extraction Pipeline stores normalized structured extraction, not raw Textract responses. Raw OCR text must not be sent to AI. AI Explanation and Drafting receives structured findings only, and full stable `finding_id` values must be preserved.

## External Dependency Map

| Dependency | Used by | Purpose | Current live-smoke status |
| --- | --- | --- | --- |
| Supabase Auth | Authentication and Consent; Document Intake and Quality Check; Payment and Access Controls; Report Generation and Delivery; Outcome Tracking and Value Measurement; Operations, Monitoring, and Analytics | Patient/internal auth, SSR sessions, auth trigger for `users` rows | Local/test validated by capability checkpoints |
| Supabase PostgreSQL + RLS | All capabilities | Canonical case state, workflow tables, RLS, audit log, analytics | Local/test validated by capability checkpoints |
| Supabase Storage | Platform Foundation; Document Intake and Quality Check; Report Generation and Delivery; Outcome Tracking and Value Measurement | Private case documents, reports, optional outcome evidence | Local/test validated by capability checkpoints |
| Supabase Realtime | Operations, Monitoring, and Analytics | Reviewer notification UI without refresh | Local/test checkpointed |
| Razorpay | Payment and Access Controls | Real-payment checkout, verification, webhooks, refunds | Live validation pending |
| AWS Textract | OCR and Extraction Pipeline | OCR, forms, and table extraction | Live Textract smoke pending |
| AWS S3 staging | OCR and Extraction Pipeline | Private temporary staging for Textract async PDF/TIFF extraction | Staging readiness checkpointed; live Textract smoke pending |
| OpenAI API | AI Explanation and Drafting | Structured plain-language draft generation from findings | Live OpenAI smoke pending |
| Resend | Document Intake and Quality Check; Payment and Access Controls; Report Generation and Delivery; Outcome Tracking and Value Measurement; Operations, Monitoring, and Analytics | Transactional emails and reminders | Sender/domain verification pending |
| Sentry | Operations, Monitoring, and Analytics | Redacted operational error monitoring | DSN/config pending |
| React PDF | Report Generation and Delivery | PDF generation from approved report content | Local/test validated |
| Zod | API validation | Input validation | Local/test validated |

## AI, Non-AI, and Human Approval Boundaries

AI is used only in AI Explanation and Drafting. It explains rules-engine findings and drafts questions, appeal points, and appeal language from structured findings. It does not read raw OCR text, create new findings, approve claims, predict payouts, provide treatment advice, provide legal advice, or accuse fraud. It must use strict structured outputs, token limits, semantic validation, audit metadata, and fallback behavior.

AI is not used for consent, upload validation, payments, OCR routing, rules-engine matching, reviewer approval, PDF delivery, outcome updates, or operations monitoring. OCR and Extraction Pipeline uses AWS Textract, not generative AI. Findings come from Rules Engine and Knowledge Base, not from AI Explanation and Drafting.

Human approval is mandatory in Reviewer Approval Workflow. No AI-assisted patient-facing content can be delivered before assigned reviewer sign-off. Expert review is mandatory when the workflow creates unresolved expert escalations or high-risk review gates require escalation.

## Capability Details

### Platform Foundation (internal reference: Module 0)

1. What it does: Establishes the pnpm monorepo, app/service/package layout, environment contract, Supabase schema, RLS policies, storage buckets, audit immutability, database helpers, shared constants, and verification script.
2. Why it exists: Every later capability depends on stable data contracts, role boundaries, money-unit columns, storage buckets, and executable verification.
3. Inputs: `MASTER_SPEC.md` schema, environment variables, Supabase project credentials, pnpm workspace configuration.
4. Outputs: `apps/web`, `apps/dashboard`, `apps/processor`, `packages/db`, `packages/shared`, schema tables, storage buckets, RLS policies, generated types, `reports` and `outcomes` base rows support, and Platform Foundation verification.
5. Status transitions it owns: Initial schema supports all case statuses: `consent_pending`, `documents_pending`, `payment_pending`, `processing`, `ai_draft_ready`, `under_review`, `escalated`, `approved`, `generating_report`, `delivered`, and `closed`. Platform Foundation defines these statuses but does not operate a product transition.
6. External dependency: Supabase Auth, PostgreSQL, RLS, Storage, and optional Realtime foundations.
7. Why chosen: Supabase gives one integrated platform for auth, Postgres state, storage, RLS, and local verification with TypeScript clients.
8. Alternatives: Separate Postgres, Auth0/Clerk, S3-only storage, Firebase, custom auth/storage.
9. Why alternatives were not chosen for the pilot: More vendors and custom glue would increase setup, RLS, audit, and testing complexity during a local pilot.
10. Can be bypassed/optional: Broker/partner portal logic, dynamic feature flag service, and production deployment automation are outside V1 or pending production work.
11. Must never be bypassed: RLS, audit immutability, schema migration discipline, money-unit definitions, service-role boundaries, required storage buckets, and executable verification.
12. Key privacy/security rules: Users map to `auth.users`; reviewers see only assigned cases; service role is server-side only; audit log is immutable; storage buckets are protected; patient-facing errors must not leak internals.
13. Tests/checkpoints: `packages/db/src/verify.ts` checks required tables, buckets, sequence, generated outcome column, RLS, audit immutability, and anonymous read protection. Checklist records 46/46 checkpoints passed.

### Authentication and Consent (internal reference: Module 1)

1. What it does: Implements patient authentication, Supabase SSR session middleware, consent capture, consent gate, privacy/terms versioning, rate limiting, RLS checks, and patient deletion guardrails.
2. Why it exists: Claim processing starts only after explicit patient consent and authenticated access.
3. Inputs: Patient auth session, required consent selections, privacy policy version, terms version, request IP/user-agent.
4. Outputs: `users` row from auth trigger, five consent rows, masked IP, gated access to upload, deletion anonymization when requested.
5. Status transitions it owns: Allows a consented patient to proceed from `consent_pending` toward `documents_pending`; it does not process claim content.
6. External dependency: Supabase Auth and SSR session cookies.
7. Why chosen: It integrates with Supabase RLS and keeps server-rendered Next.js routes session-aware.
8. Alternatives: Passwordless-only custom auth, Auth0, Clerk, Firebase Auth.
9. Why alternatives were not chosen for the pilot: They would require separate identity-to-database mapping and extra RLS integration work.
10. Can be bypassed/optional: None for patient web intake. Admin-created cases use the approved `admin_created` source path but still require audit and consent source tracking.
11. Must never be bypassed: Consent gate, session protection, patient RLS, rate limits, and deletion/anonymization guardrails.
12. Key privacy/security rules: IP addresses are masked; cross-patient reads are blocked; unauthenticated access is redirected; deletion keeps referential integrity through tombstoning.
13. Tests/checkpoints: `pnpm test:module1` verifies consent gate blocking/allowing, five consent rows, IP masking, cross-patient RLS block, rate limiting, and deletion anonymization. Checklist records 7/7 checkpoints passed.

### Document Intake and Quality Check (internal reference: Module 2)

1. What it does: Accepts required claim documents, validates file size and MIME type, stores files in protected paths, creates document rows, runs quality checks, and decides whether the case is ready for payment or processing.
2. Why it exists: OCR and downstream rules are only useful if required documents are present, readable, and safely stored.
3. Inputs: Authenticated patient session, case ID, document type, file upload, payment-waiver state.
4. Outputs: Protected storage object, `documents` row, quality status, failure reason when relevant, quality-check processing job, case readiness transition, OCR jobs for waived/simulated cases.
5. Status transitions it owns: `documents_pending -> payment_pending` for real-payment cases after required documents pass; `documents_pending -> processing` for approved waived/simulated cases; document quality moves `pending -> pass`, `fail`, or `manual_required`.
6. External dependency: Supabase Storage and PostgreSQL.
7. Why chosen: Storage and database state sit behind the same auth/RLS model and service-role controls.
8. Alternatives: Direct S3 uploads, local disk, third-party upload providers.
9. Why alternatives were not chosen for the pilot: They add cross-system authorization and cleanup complexity before the OCR stage is stable.
10. Can be bypassed/optional: Optional document types can be skipped. Payment can be bypassed later only through explicitly approved Payment and Access Controls modes; quality checks cannot be skipped for required docs.
11. Must never be bypassed: File validation, protected storage paths, UUID storage names, required document checks, quality failure handling, and idempotent job creation.
12. Key privacy/security rules: Original filenames are not leaked in storage paths; documents remain private; uploads require session authorization; patient cannot access other patients' cases.
13. Tests/checkpoints: `pnpm test:module2` verifies oversized client block, MIME rejection, UUID storage paths, good/low-res quality outcomes, payment-pending transition, waived-case processing, and idempotent quality jobs. Checklist records 8/8 checkpoints passed.

### Payment and Access Controls (internal reference: Module 3)

1. What it does: Implements Razorpay order creation, payment verification, webhook handling, refunds, and explicit pilot bypass modes: `admin_waived`, `internal_access_code`, and `test_simulated`.
2. Why it exists: It controls when a case is allowed to enter paid or approved pilot processing while keeping paid, waived, and test reporting separate.
3. Inputs: Payment-pending case, authenticated patient/admin session, Razorpay order/payment/signature data, webhook payloads, internal access code, waiver reason, simulated-payment flag.
4. Outputs: `payments` row for real payments only, payment status, refund status, activated case, SLA deadline, OCR jobs, audit rows, payment reporting category.
5. Status transitions it owns: `payment_pending -> processing`; full refund can move a case to `closed`; payment rows move `pending -> paid` or `refunded`.
6. External dependency: Razorpay for real-payment checkout, verification, webhooks, and refunds; Resend for payment confirmation email.
7. Why chosen: Razorpay is appropriate for India-focused payment flows and supports test-mode checkout, signatures, webhooks, and refunds.
8. Alternatives: Cashfree, Stripe, PayU, manual bank transfer, no payment gate.
9. Why alternatives were not chosen for the pilot: Razorpay aligns with Indian checkout and refund flows; other providers add parallel integration scope. Manual/no payment would weaken paid/waived/test segmentation.
10. Can be bypassed/optional: Razorpay is bypassed only for `admin_waived`, `internal_access_code`, and `test_simulated`. Those bypasses create no Razorpay calls and no `payments` rows.
11. Must never be bypassed: HMAC signature verification, webhook signature verification, payment-mode consistency, paid/waived/test reporting separation, audit logging, and no Razorpay/payment rows for bypassed cases.
12. Key privacy/security rules: Do not activate on tampered signatures; internal access codes are hashed and server-side only; admin waiver requires admin authorization; no patient-facing internal errors.
13. Tests/checkpoints: `pnpm test:module3` verifies waived-order block, payment conflicts, tampered signatures, valid activation, SLA, OCR job queueing, webhook idempotency, invalid webhook rejection, refunds, waiver paths, internal-code audit, and simulated activation. Checklist records 11/11 checkpoints passed.

### OCR and Extraction Pipeline (internal reference: Module 4)

1. What it does: Routes documents through Textract sync or async extraction, stages async PDF/TIFF documents in private S3 when needed, normalizes bills, policy chunks, and insurer letters, handles manual-required fallbacks, and prevents raw OCR persistence.
2. Why it exists: Downstream findings must be based on structured extraction, not raw document blobs or raw OCR dumps.
3. Inputs: Passed-quality document rows, private storage paths, file metadata, OCR processing jobs, Textract blocks, manual extraction completion.
4. Outputs: Normalized `documents.extracted_json`, OCR status, confidence metadata, reviewer notifications for manual-required documents, original approved/deducted amounts on `cases` and `outcomes`, queued rules-engine job after all required structured extraction is usable.
5. Status transitions it owns: Document `ocr_status` moves `pending/running -> completed` or `failed`; document quality can become `manual_required`; case `current_step` moves through `ocr` toward `rules_engine` only after usable extracted JSON exists.
6. External dependency: AWS Textract and AWS S3 staging.
7. Why chosen: Textract provides OCR/table extraction for scanned Indian claim documents and has sync/async modes for images and PDFs/TIFFs.
8. Alternatives: Tesseract, Google Document AI, Azure Form Recognizer, manual-only extraction.
9. Why alternatives were not chosen for the pilot: Tesseract would require more table/document heuristics; other cloud providers add new vendor setup; manual-only extraction would slow pilot learning.
10. Can be bypassed/optional: Unsupported or low-confidence extraction can go to manual-required completion. S3 staging is used only when Textract async PDF/TIFF processing requires it.
11. Must never be bypassed: No raw Textract response storage, no raw OCR text persistence for AI use, private S3 staging cleanup, retry/backoff, manual-required notification, and rules-engine gating on usable structured extraction.
12. Key privacy/security rules: AWS credentials require least privilege; staging bucket is private with public access blocked and lifecycle cleanup; raw OCR text must not be sent to the AI layer.
13. Tests/checkpoints: `pnpm test:module4` verifies env presence, S3 put/get/delete readiness, extraction routing, normalizers, manual-required fallback, retry behavior, no raw OCR persistence, idempotent OCR handling, amount propagation, rules-engine gate, and manual normalized shape. Checklist records 12/12 checkpoints passed. Live Textract smoke is still pending.

### Rules Engine and Knowledge Base (internal reference: Module 5)

1. What it does: Seeds the knowledge base, matches structured extractions to policy/bill/insurer patterns, creates findings, assigns confidence and appeal metadata, enforces benchmark gating, and queues AI draft generation only after the gate passes.
2. Why it exists: Claim findings should be deterministic, reviewable, benchmarked, and grounded in structured extraction and KB patterns before AI explains them.
3. Inputs: Normalized OCR extraction in `extracted_json`, KB clause patterns, case metadata, insurer letter deductions, bill lines, policy chunks, optional helpful documents.
4. Outputs: `findings` rows, confidence labels, `cases.confidence_overall`, `ai_draft_generation` job after gate pass, KB dashboard view data.
5. Status transitions it owns: Case `current_step` moves from `rules_engine` to `ai_draft`; it deliberately does not set `case.status='ai_draft_ready'`.
6. External dependency: Supabase PostgreSQL for KB patterns and findings. No external AI dependency.
7. Why chosen: A database-backed KB gives seeded, auditable patterns that reviewers can inspect and benchmark.
8. Alternatives: Generative AI extraction-only findings, hard-coded rules only, external rules platform.
9. Why alternatives were not chosen for the pilot: AI-only findings would be harder to audit and could drift; hard-coded rules are less maintainable; external rules platforms add operational overhead.
10. Can be bypassed/optional: Unverified KB patterns can still inform typical-policy findings but are capped at lower confidence. Optional documents can improve confidence but are not always required.
11. Must never be bypassed: Benchmark hard gate, no raw OCR consumption, idempotent findings, money-unit correctness, and no `ai_draft_ready` status from the rules engine.
12. Key privacy/security rules: Uses structured `extracted_json` only; bill amounts remain paise; claim amounts remain whole rupees; KB changes are logged.
13. Tests/checkpoints: `pnpm test:module5` verifies 16 seed patterns, unverified pattern cap, verified policy match, unseeded insufficient information, missing-document finding, confidence rollups, idempotency, benchmark match rate >= 0.70, no raw OCR consumption, money units, AI queue gate, and no premature `ai_draft_ready`. Checklist records 12/12 checkpoints passed.

### AI Explanation and Drafting (internal reference: Module 6)

1. What it does: Uses the OpenAI Responses API with strict structured outputs to draft plain-language explanations, questions, appeal points, and appeal letter language from rules-engine findings only.
2. Why it exists: It turns reviewer-safe structured findings into readable patient-facing draft material, while preserving review gates and safety constraints.
3. Inputs: Full stable `finding_id`, finding type, bill item label, amount, clause references, operative reason, confidence label, appeal strength/basis, case metadata, and token budget settings.
4. Outputs: `cases.ai_draft`, provider/token/schema/prompt audit metadata, deterministic fallback draft when needed, reviewer notification, `ai_draft_ready` status.
5. Status transitions it owns: `processing -> ai_draft_ready`; `current_step -> awaiting_review`. It does not move to `under_review` or `approved`.
6. External dependency: OpenAI API, using `OPENAI_AI_DRAFT_MODEL` and fallback model configuration.
7. Why chosen: The OpenAI Responses API supports strict structured outputs suitable for schema validation and safer downstream review.
8. Alternatives: Anthropic, local LLMs, rules-only templates, manual-only report drafting.
9. Why alternatives were not chosen for the pilot: The spec now requires OpenAI; local LLMs add hosting and quality risk; templates alone reduce usefulness; manual-only drafting slows reviewer work.
10. Can be bypassed/optional: If token budget, API, JSON, schema, or semantic validation fails, deterministic fallback is used. Fallback still requires reviewer approval.
11. Must never be bypassed: No raw OCR text to AI, no new AI-created findings, no truncated `finding_id`, token limits, strict schema, semantic safety validation, audit logging, and reviewer gating.
12. Key privacy/security rules: AI cannot claim approval/payout/legal/medical conclusions; cannot accuse fraud; must preserve confidence wording; must include Bima Bharosa reference where required; patient output remains unavailable until Reviewer Approval Workflow approval.
13. Tests/checkpoints: `pnpm test:module6` and `pnpm test:ai-regression` verify OpenAI config, strict schema, required keys, no raw OCR in prompt, token budgets, full finding IDs, forbidden phrase rejection, Bima Bharosa requirement, fallback paths, audit metadata, status transition, reviewer notification, and no patient report before approval. Checklist records 30/30 checkpoints passed. Live OpenAI smoke is still pending.

### Reviewer Approval Workflow (internal reference: Module 7)

1. What it does: Provides assigned reviewer workflow, finding confirmation, reviewer edits, expert escalations, sign-off gates, report-generation queueing, and audit trail.
2. Why it exists: V1 requires human review before any AI-assisted material is delivered to patients.
3. Inputs: `ai_draft_ready` assigned case, rules-engine findings, AI draft, reviewer/expert actors, escalation questions and responses.
4. Outputs: Confirmed or edited findings, escalations, expert responses, audit rows, `reports.signed_off_by`, `reports.signed_off_at`, queued `report_generation` job.
5. Status transitions it owns: `ai_draft_ready -> under_review`; `under_review -> escalated` where needed; escalated cases return to `under_review`; successful sign-off moves `under_review -> approved`.
6. External dependency: Supabase Auth/PostgreSQL/RLS through dashboard workflows. No external AI or payment provider.
7. Why chosen: Internal dashboard with RLS-aligned assignments is enough for V1 review and avoids external workflow-tool dependency.
8. Alternatives: Manual spreadsheet review, external case-management systems, auto-approval.
9. Why alternatives were not chosen for the pilot: Spreadsheets weaken audit/RLS; external systems add integration overhead; auto-approval violates V1 safety rules.
10. Can be bypassed/optional: Expert escalation is optional unless gates require it. Reviewer edits are optional when findings are already acceptable.
11. Must never be bypassed: Reviewer sign-off, assigned-reviewer access checks, open escalation blocks, high-value insufficient-information gates, audit logging, and patient/report delivery block before approval.
12. Key privacy/security rules: Reviewers see assigned cases only; experts see assigned escalations or cases only; patients cannot use reviewer actions; all edits preserve old values in audit metadata.
13. Tests/checkpoints: `pnpm test:module7` verifies opening review, confirmation audit, edit audit, sign-off blocks, escalation blocks, high-value gates, successful sign-off, idempotent report queueing, cross-reviewer denial, patient denial, expert escalation access, and no report-delivery trigger. Checklist records 12/12 checkpoints passed.

### Report Generation and Delivery (internal reference: Module 8)

1. What it does: Generates reviewer-approved reports, renders PDFs, stores reports securely, creates signed download access through the app, sends delivery email, schedules outcome follow-ups, and supports corrections/versioning.
2. Why it exists: Patients need a secure, human-approved report and the system needs a reliable handoff into outcome tracking.
3. Inputs: Approved case, signed-off report row, reviewer-confirmed findings, AI draft already approved by reviewer, documents metadata, patient email.
4. Outputs: PDF buffer, report storage path, delivered report metadata, delivery email job/message ID, audit rows, follow-up schedule rows at 30/60/90 days.
5. Status transitions it owns: `approved -> generating_report -> delivered`; report generation failure sets failure metadata rather than pretending delivery succeeded.
6. External dependency: React PDF for report rendering, Supabase Storage for private report storage, Resend for delivery email.
7. Why chosen: React PDF keeps report generation in TypeScript; Supabase Storage keeps report access under existing auth; Resend handles transactional email.
8. Alternatives: Browser print/Puppeteer, external PDF service, public storage URLs, direct attachments, SendGrid/Mailgun.
9. Why alternatives were not chosen for the pilot: External PDF services and browser rendering add infrastructure; public URLs/attachments weaken access control; Resend is simpler for transactional email.
10. Can be bypassed/optional: Email delivery can fail without undoing a successfully delivered report state, but it is audited/retried. Corrections are optional and versioned.
11. Must never be bypassed: Report preflight, reviewer sign-off requirement, no unreviewed AI output, no raw OCR/extraction dump, login-gated report access, signed URL TTL, and audit events.
12. Key privacy/security rules: Email contains an app link only, never a Supabase storage URL; unauthenticated or wrong-patient downloads fail; undelivered reports cannot be downloaded.
13. Tests/checkpoints: `pnpm test:module8` verifies PDF sections, fail-closed preflight, no raw OCR/extracted fields, no unreviewed AI output, app-link-only email, authenticated download gates, one-hour signed URL, 30/60/90 follow-ups, email/PDF failure handling, correction versioning, and audit events. Checklist records 14/14 checkpoints passed.

### Outcome Tracking and Value Measurement (internal reference: Module 9)

1. What it does: Collects post-report outcomes through authenticated session or one-time signed outcome tokens, stores appeal/final settlement details, supports optional evidence upload, schedules reminders, and powers outcome analytics.
2. Why it exists: Outcome tracking is core product proof, not optional reporting. It measures whether patients acted and whether amounts changed after the report.
3. Inputs: Delivered case, follow-up schedule, authenticated patient session or valid one-time token, quick action, full outcome form, optional evidence document, original approved/deducted amounts.
4. Outputs: `outcomes` updates, generated reversal amount, evidence storage path/type, manual-follow-up flag, token `used_at`, follow-up response flags, analytics queries.
5. Status transitions it owns: Outcome state moves from pending/no-action to action/submitted/response/final outcome fields. It can contribute to final outcome completion but does not reopen report approval.
6. External dependency: Supabase PostgreSQL/Storage for outcomes, tokens, and evidence; Resend for follow-up reminders.
7. Why chosen: Database-backed token verification and protected evidence storage align with existing RLS and audit controls; Resend is already used for delivery/reminders.
8. Alternatives: Raw caseRef update links, unauthenticated public forms, third-party survey tools, manual calls only.
9. Why alternatives were not chosen for the pilot: Raw caseRef/public forms are insecure for state changes; survey tools fragment data; manual-only follow-up reduces measurable product proof.
10. Can be bypassed/optional: Evidence upload is optional; quick update can capture limited action before full final outcome; reminders stop after final outcome.
11. Must never be bypassed: Authenticated session or one-time token authorization, token one-use/expiry, whole-rupee outcome amounts, generated reversal calculation, and no raw `caseRef` alone for updates.
12. Key privacy/security rules: Tokens are hashed; GET confirmation pages do not mutate state; evidence remains protected; high-value self-reported outcomes require manual follow-up; test cases are excluded from default analytics.
13. Tests/checkpoints: `pnpm test:module9` verifies follow-up schedule, unauthenticated/token failures, raw caseRef block, one-use/expired token behavior, non-mutating GET, quick/full updates, whole-rupee storage, generated reversal, evidence confidence, manual follow-up flag, analytics no `/100`, test exclusion, reminder delivery/suppression/failure audit. Checklist records 20/20 checkpoints passed.

### Operations, Monitoring, and Analytics (internal reference: Module 10)

1. What it does: Adds SLA monitoring, stale job monitoring, failed reminder handling, health checks, Sentry redaction helpers, admin audit/analytics views, reviewer notification behavior, and production-readiness guardrails.
2. Why it exists: Local pilot operation needs visibility into stalled work, SLA breaches, reminder failures, security regressions, and production blockers.
3. Inputs: Cases with SLA deadlines, processing jobs, follow-up schedule, outcomes, audit metadata, payment categories, health-check requests, Sentry events.
4. Outputs: SLA warnings/breaches, reviewer/admin/patient notifications, audit rows, health status, redacted metadata, analytics SQL, operational dashboards.
5. Status transitions it owns: Marks SLA warning/breach flags; marks stale jobs failed; does not advance claim-processing statuses except through explicit operational workflows such as admin-created intake where specified.
6. External dependency: Sentry for monitoring, Resend for operational emails/reminders, Supabase Realtime for notification UI, Railway-style health endpoint conventions.
7. Why chosen: These tools cover operational feedback with low app-level complexity and match the existing stack.
8. Alternatives: Datadog/New Relic, manual log review, cron-only scripts, no monitoring, custom email SMTP.
9. Why alternatives were not chosen for the pilot: Enterprise observability and custom SMTP add overhead; no monitoring is unsafe; cron-only scripts without dashboard/audit are hard to review.
10. Can be bypassed/optional: Production observability configuration is pending before production pilot; local health/degraded checks still run. Broker/partner operations are out of scope.
11. Must never be bypassed: Redaction, admin-only audit access, assigned-reviewer scope, outcome-token regression, whole-rupee analytics, payment segmentation, and reminder failure audit/retry behavior.
12. Key privacy/security rules: Sentry must not receive patient email, policy numbers, document content, prompts, signed URLs, or claim amounts; dashboards redact sensitive metadata; reviewers cannot see unassigned cases.
13. Tests/checkpoints: `pnpm test:module10` verifies SLA warning/breach/idempotency, follow-up dispatch rules, no pre-delivery reminder, failed reminder retry, stale job monitor, degraded health, admin audit access, non-admin denial, assigned-reviewer scope, redaction/Sentry scrubbing, whole-rupee analytics, test exclusion, outcome-token regression, and payment segmentation. Checklist records 16/16 checkpoints passed.

## Status Transition Ownership Summary

```text
Platform Foundation defines statuses and schema constraints.
Authentication and Consent gates movement out of consent_pending by requiring consent.
Document Intake and Quality Check owns documents_pending -> payment_pending or processing for waived/simulated cases.
Payment and Access Controls owns payment_pending -> processing and paid/refunded payment state.
OCR and Extraction Pipeline owns OCR job/document extraction state and current_step progression to rules_engine.
Rules Engine and Knowledge Base owns current_step rules_engine -> ai_draft and AI job queueing, not ai_draft_ready.
AI Explanation and Drafting owns processing -> ai_draft_ready and current_step -> awaiting_review.
Reviewer Approval Workflow owns ai_draft_ready -> under_review/escalated/approved and queues report_generation.
Report Generation and Delivery owns approved -> generating_report -> delivered.
Outcome Tracking and Value Measurement owns outcome fields, response flags, and follow-up completion signals.
Operations, Monitoring, and Analytics owns operational flags such as sla_warning_sent, sla_breached, and stale-job failure.
```

## Must-Never-Bypass Rules Across the System

- Do not use raw `caseRef` alone as authorization for state-changing actions.
- Do not send raw OCR text to AI.
- Do not truncate `finding_id` before or inside the AI layer.
- Do not mix money units: case and outcome amounts are whole rupees; payments and bill-line amounts are paise where specified.
- Do not expose internal stack traces or private details to patients.
- Do not bypass Reviewer Approval Workflow sign-off.
- Do not widen reviewer RLS to all internal cases.
- Do not create broker portal logic in V1.
- Do not silently change schema without migration discipline.
- Do not skip required checkpoint tests or replace them with placeholders.

## Current Pending Live-Smoke and Production-Pilot Items

These items block production-pilot readiness even though local/test-mode capability checkpoints passed:

- OCR and Extraction Pipeline AWS Textract live smoke is pending.
- AI Explanation and Drafting OpenAI live smoke is pending.
- Razorpay live checkout, webhook, and refund validation is pending.
- Resend verified sender/domain validation is pending.
- Sentry DSN and runtime configuration are pending.
- Production secrets and environment verification are pending.
- Deployment scripts and deployment configuration are pending.
- Admin seed prerequisites are pending, including `KB_SEED_ADMIN_USER_ID`.

## Verification Command Reference

```text
pnpm lint
pnpm typecheck
node --loader ts-node/esm/transpile-only --experimental-specifier-resolution=node packages/db/src/verify.ts
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
pnpm smoke:textract
```

`pnpm smoke:textract` is a live-smoke/production-readiness activity, not a local-pilot proof. The OpenAI live smoke is also still pending and should be run only with approved live credentials and an explicit production-readiness review plan.
