# ClaimClarity Intelligence

ClaimClarity is a private, local-pilot repository for an India-only, human-reviewed claim clarity and appeal drafting workflow. It helps patients and internal reviewers organize claim documents, extract structured findings, prepare plain-language explanations, generate reviewer-approved reports, and track post-report outcomes.

The platform is designed to support claim understanding and appeal preparation. It does not provide medical advice, legal advice, insurance approval predictions, fraud determinations, or final claim decisions.

## Readiness Status

**LOCAL PILOT READY**

The full local-pilot capability set is complete and marked `DONE` with reviewer decision `PASS` in `IMPLEMENTATION_CHECKLIST.md`. Local/test-mode flows are ready for a controlled local pilot with reviewer-gated output, token-secured outcome updates, and separated payment reporting for paid, waived, and simulated cases.

**NOT PRODUCTION PILOT READY**

Production pilot readiness is still blocked by live third-party validation, production secrets, deployment configuration, observability configuration, and admin seed prerequisites. Do not describe this repository as production-ready until those blockers are resolved and independently reviewed.

## How To Read This Repository

Product and architecture documents use capability names such as Document Intake and Quality Check, AI Explanation and Drafting, and Reviewer Approval Workflow.

`IMPLEMENTATION_CHECKLIST.md` remains the internal implementation tracker. It uses module numbers for build tracking, checkpoint history, and test-script mapping.

## Problem Statement

Health insurance claim denials, deductions, and missing-document responses are difficult for patients to interpret. Policy clauses, hospital bills, insurer letters, and appeal options are often spread across several documents and written in language that is hard to act on.

ClaimClarity addresses that gap by turning uploaded claim material into structured, reviewer-checked findings and patient-facing explanations. The goal is to make the claim position clearer and produce a human-reviewed appeal draft where appropriate, without claiming decision authority over the insurer, treating doctor, hospital, regulator, or patient.

## What The Platform Does

- Captures patient consent and claim intake details.
- Accepts required insurance and claim documents.
- Runs document quality checks before processing.
- Supports Razorpay test-mode payment, admin waivers, internal access-code waivers, and simulated local test activation.
- Uses OCR and extraction to normalize claim information.
- Applies a knowledge-base and rules engine to identify covered, deducted, at-risk, missing-document, and appeal-point findings.
- Uses the OpenAI API only on structured findings, not raw OCR text, to draft plain-language explanations and appeal language.
- Routes AI-assisted output through reviewer and expert workflows before patient delivery.
- Generates secure, login-gated reports.
- Tracks patient outcomes through authenticated sessions or signed one-time outcome tokens.
- Provides operations tooling for SLA monitoring, reviewer notifications, health checks, audit visibility, redaction, and local readiness checks.

## High-Level Architecture

This repository is a pnpm workspace monorepo:

```text
apps/
  web/          Patient-facing Next.js app
  dashboard/    Internal reviewer, expert, admin, and operations dashboard
  processor/    Node.js TypeScript processing service

packages/
  db/           Supabase clients, database types, queries, verification helpers
  shared/       Shared constants, config, feature flags, result helpers, Sentry helpers
```

Core flow:

```text
Patient intake and consent
  -> document intake and quality checks
  -> payment or approved pilot waiver
  -> OCR and structured extraction
  -> rules engine and knowledge-base matching
  -> OpenAI draft generation from structured findings only
  -> reviewer or expert sign-off
  -> secure report generation and delivery
  -> outcome follow-up and analytics
```

Supabase provides auth, PostgreSQL state, row-level security, storage, and realtime support. The processor service handles OCR, extraction, AI draft generation, report generation, follow-up scheduling, health checks, and operational jobs. Patient report access is gated by login and does not rely on public report URLs.

## Capability Summary

| Capability | Summary |
| --- | --- |
| Platform Foundation | pnpm workspace scaffold, Supabase schema, RLS, storage buckets, audit immutability, environment template, and server-side verification. |
| Authentication and Consent | Patient auth, Supabase SSR session middleware, consent capture, privacy and terms versioning, and deletion guardrails. |
| Document Intake and Quality Check | Required document upload flow, storage protections, document quality status, and case progression to payment readiness. |
| Payment and Access Controls | Razorpay test-mode checkout, payment verification, webhook/refund handling, and explicit pilot waiver modes without Razorpay calls. |
| OCR and Extraction Pipeline | AWS Textract adapter, OCR processing jobs, normalized extraction, policy chunking, insurer letter parsing, and OCR failure handling. |
| Rules Engine and Knowledge Base | Knowledge-base seed workflow, rules matching, benchmark gate, finding generation, and dashboard knowledge-base view. |
| AI Explanation and Drafting | OpenAI structured-output draft generation from rules-engine findings only, privacy controls, fallback behavior, token-budget checks, and AI regression tests. |
| Reviewer Approval Workflow | Assigned-reviewer workflow, expert escalation, finding confirmation and edits, audit trail, and sign-off gates. |
| Report Generation and Delivery | Reviewer-gated PDF/report generation, signed storage access, secure download, and delivery email flow. |
| Outcome Tracking and Value Measurement | Session or token-authorized outcome updates, follow-up scheduling, evidence handling, and whole-rupee outcome analytics. |
| Operations, Monitoring, and Analytics | SLA monitoring, failed reminder handling, Sentry integration points, health checks, admin operations dashboards, redaction, and regression checks. |

## Tech Stack

- pnpm workspaces
- TypeScript
- Next.js 14 App Router
- React 18
- Tailwind CSS
- Node.js processing service
- Express for processor health and service endpoints
- Supabase Auth, PostgreSQL, Storage, RLS, and Realtime
- Zod for validation
- AWS SDK for S3 and Textract
- OpenAI Responses API with strict structured outputs
- Razorpay for payment test/live integration paths
- Resend for transactional email
- Sentry for error monitoring and operational context
- React PDF for report generation
- ESLint, Prettier, and TypeScript typechecking

## External Dependencies

| Dependency | High-level use |
| --- | --- |
| Supabase | Authentication, PostgreSQL case state, row-level security, protected storage, service-role operations where explicitly allowed, and local readiness verification. |
| Razorpay | Report-fee checkout, payment verification, webhooks, and refunds for real-payment cases. Waived and simulated cases bypass Razorpay completely. |
| AWS S3/Textract | Textract performs OCR and table extraction. S3 is used for private temporary staging when Textract async PDF/TIFF processing requires object input. |
| OpenAI API | Generates structured, plain-language draft explanations, questions, and appeal language from reviewer-safe structured findings only. |
| Resend | Sends transactional email such as payment confirmation, report delivery notices, document-quality follow-up, and outcome reminders. |
| Sentry | Captures operational errors and service context without patient PII, document contents, policy numbers, or claim amounts. |

## Local Development Setup

1. Install dependencies:

```bash
pnpm install
```

2. Create local environment files from the placeholder template:

```bash
cp .env.example .env.local
cp .env.example apps/web/.env.local
cp .env.example apps/dashboard/.env.local
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
Copy-Item .env.example apps/web/.env.local
Copy-Item .env.example apps/dashboard/.env.local
```

3. Fill local/test credentials only. Do not commit real secrets. Use Supabase local/test project values, Razorpay test-mode credentials, and test-safe provider credentials where required.

4. Start local apps as needed:

```bash
pnpm --filter @claimclarity/web dev
pnpm --filter @claimclarity/dashboard dev
pnpm --filter @claimclarity/processor dev
```

By convention, the patient app uses `NEXT_PUBLIC_APP_URL` such as `http://localhost:3000`, and the dashboard uses `NEXT_PUBLIC_DASHBOARD_URL` such as `http://localhost:3001`.

## Environment Variable Categories

Use `.env.example` as the placeholder reference. Keep all real values out of git.

- Supabase: project URL, anon key, service-role key.
- AWS: access key, secret key, region, Textract/S3 staging configuration.
- OpenAI: API key, primary AI draft model, fallback AI draft model.
- Razorpay: key ID, key secret, webhook secret.
- Resend: API key, sender email, sending domain, admin email.
- Sentry: DSN and runtime configuration for web, dashboard, and processor services.
- App URLs and versions: patient URL, dashboard URL, privacy policy version, terms version.
- Internal service controls: internal webhook secret, internal access-code hash list, local simulated payment flag.
- Admin seed prerequisites: admin user identifiers required by seed or knowledge-base workflows.
- Operational settings: health-check path, OCR polling and timeout settings, deployment-specific runtime values.

## Validation Commands

Run lint and typecheck from the repository root:

```bash
pnpm lint
pnpm typecheck
```

Build the Next.js apps:

```bash
pnpm --filter @claimclarity/web build
pnpm --filter @claimclarity/dashboard build
```

The processor is TypeScript-first and is covered by root typecheck plus processor capability tests.

## Known Pending Production Blockers

ClaimClarity is not production-pilot ready until all of the following are completed and reviewed:

- Live Textract smoke.
- Live OpenAI smoke.
- Razorpay live checkout, webhook, and refund validation.
- Resend sender/domain verification.
- Sentry DSN and runtime configuration.
- Production secrets and environment verification.
- Deployment scripts and deployment configuration.
- Admin seed prerequisites, including required admin identifiers for seed workflows.

## Security And Privacy Principles

- Raw OCR text is not sent to the AI layer.
- AI receives structured findings only, with full stable `finding_id` values preserved.
- Reports are not exposed through public report URLs.
- Patient report delivery is login-gated.
- Outcome updates require either an authenticated patient session or a signed one-time outcome token.
- Reviewer sign-off is required before AI-assisted content becomes patient-visible.
- Reviewers are scoped to assigned cases; experts are scoped to escalations or assignments.
- Service-role usage is limited to explicitly allowed server-side workflows.
- Patient-facing responses must not leak stack traces, private details, or internal failure context.
- Money units are strict: claim and outcome amounts use whole INR, while payment and bill-line amounts use paise where specified.

## Scope Notes

ClaimClarity V1 is India-only and pilot-first. Broker and partner portal logic is intentionally out of scope. The platform supports patient, reviewer, expert, admin, and operations workflows for claim clarity and appeal drafting, but final insurance decisions remain outside the system.
