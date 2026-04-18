# IMPLEMENTATION_CHECKLIST.md

## ClaimClarity Module Tracking

Status legend:

- NOT STARTED
- IN PROGRESS
- READY FOR REVIEW
- BLOCKED
- DONE

Reviewer decision legend:

- PASS
- PASS WITH MINOR FIXES
- BLOCKED

## Module Completion State

| Module | Name                              | Status | Reviewer decision | Notes                                                                                                                                                                                  |
| ------ | --------------------------------- | ------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0      | Infrastructure and Schema         | DONE   | PASS              | Scaffold, schema, RLS, storage, audit immutability, and Module 0 verification completed; Supabase verification passed 46/46 checkpoints.                                               |
| 1      | Auth and Consent                  | DONE   | PASS              | Auth, consent capture, session middleware, privacy/terms versioning, patient deletion guardrails, and Module 1 verification completed; checkpoints passed 7/7.                         |
| 2      | Document Upload and Quality Check | DONE   | PASS              | Required document upload, quality checks, case document state, storage protections, and Module 2 verification completed; checkpoints passed 8/8.                                       |
| 3      | Payment Integration               | DONE   | PASS              | Razorpay test-mode flow, payment-mode separation, admin/internal/test waivers, webhook/refund handling, and Module 3 verification completed; checkpoints passed 11/11.                 |
| 4      | OCR and Extraction Pipeline       | DONE   | PASS              | Textract adapter, OCR job flow, normalized extraction, policy chunking, insurer letter parsing, and Module 4 verification completed; checkpoints passed 12/12.                         |
| 5      | Rules Engine and Knowledge Base   | DONE   | PASS              | Rules engine, KB seed workflow, benchmark hard gate, dashboard KB view, and Module 5 verification completed; checkpoints passed 12/12.                                                 |
| 6      | AI Explanation Layer              | DONE   | PASS              | OpenAI structured-output draft layer, prompt privacy controls, fallback path, token-budget checks, AI regression tests, and Module 6 verification completed; checkpoints passed 30/30. |
| 7      | Reviewer Dashboard                | DONE   | PASS              | Assigned-reviewer workflow, expert escalation path, finding confirmation/edit audit trail, sign-off gates, and Module 7 verification completed; checkpoints passed 12/12.              |
| 8      | Report Generation and Delivery    | DONE   | PASS              | Reviewer-gated PDF/report generation, signed report storage, secure download, delivery email flow, and Module 8 verification completed; checkpoints passed 14/14.                      |
| 9      | Outcome Tracking                  | DONE   | PASS              | Session/token-authorized outcome updates, follow-up schedule, evidence handling, whole-rupee analytics, and Module 9 verification completed; checkpoints passed 20/20.                 |
| 10     | Operations Layer                  | DONE   | PASS              | SLA monitoring, failed reminder handling, health checks, admin ops dashboards, redaction, regression checks, and Module 10 verification completed; checkpoints passed 16/16.           |

## Final Readiness

### Local Pilot Readiness

- Status: LOCAL PILOT READY.
- Modules 0-10 are complete with reviewer decision PASS.
- Local/test-mode flows are documented as ready for a controlled local pilot.
- Reviewer-gated AI output, tokenized outcome authorization, whole-rupee outcome analytics, and payment-mode segmentation remain tracked as passed review checkpoints.

### Production Pilot Blockers

The product is not PRODUCTION PILOT READY. Production pilot readiness remains blocked by:

- Live Textract smoke pending AWS activation.
- Live OpenAI smoke pending.
- Razorpay live checkout/webhook/refund validation pending.
- Resend verified sender/domain validation pending.
- Sentry DSN/config pending.
- Production env/secrets verification pending.
- Deployment scripts/config pending.
- Admin seed prerequisites pending, including `KB_SEED_ADMIN_USER_ID`.

### Non-Blocking Known Limitations

- Current readiness applies to local pilot operation only.
- Live third-party integrations have not all been validated in production mode.
- Production observability, deployment, and secret validation are tracked as blockers before any production pilot.
- V1 remains scoped to India-only, patient/admin/reviewer/expert workflows; broker/partner portal logic is intentionally out of scope per `MASTER_SPEC.md`.

## Manager Notes

- Do not mark ClaimClarity as PRODUCTION PILOT READY until every production pilot blocker above is resolved and independently reviewed.
- If a future blocker is due to spec conflict, create or update `SPEC_GAP.md` before changing implementation scope.
- Continue to preserve the red lines from `AGENTS.md`: no raw `caseRef` authorization for state changes, no raw OCR text to AI, no truncated `finding_id`, no paise/rupee mixing, no internal error exposure, no reviewer RLS widening, and no skipped module tests.
