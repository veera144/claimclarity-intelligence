# IMPLEMENTATION_CHECKLIST.md
## ClaimClarity module tracking

Status legend:
- NOT STARTED
- IN PROGRESS
- READY FOR REVIEW
- BLOCKED
- DONE

| Module | Name | Status | Reviewer decision | Notes |
|---|---|---|---|---|
| 0 | Infrastructure and Schema | DONE | PASS | Scaffold complete; Supabase verification passed 46/46 checkpoints; no required fixes. |
| 1 | Auth and Consent | DONE | PASS | Module 1 checkpoints passed 7/7 during cross-module verification through Module 3. |
| 2 | Document Upload and Quality Check | DONE | PASS | Live case_ref RPC dependency resolved; /api/cases verified against live DB; lint, typecheck, and Module 2 checkpoints passed 8/8. |
| 3 | Payment Integration | DONE | PASS | Module 3 checkpoints passed 11/11; web/dashboard build compatibility restored; cross-module verification through Module 3 passed. |
| 4 | OCR and Extraction Pipeline | DONE | PASS | Module 4 checkpoints passed 12/12; live Textract smoke remains pending until AWS account activation, with fallback-first production path reviewed. |
| 5 | Rules Engine and Knowledge Base | IN PROGRESS |  | Opened after Module 4 PASS; prerequisites satisfied by rules_engine handoff checkpoint with usable extracted_json. |
| 6 | AI Explanation Layer | NOT STARTED |  |  |
| 7 | Reviewer Dashboard | NOT STARTED |  |  |
| 8 | Report Generation and Delivery | NOT STARTED |  |  |
| 9 | Outcome Tracking | NOT STARTED |  |  |
| 10 | Operations Layer | NOT STARTED |  |  |

## Notes
- Do not advance a module until reviewer decision is PASS.
- If a module is BLOCKED, create or update `SPEC_GAP.md` only if the blocker is due to spec conflict.
- Module 5 is open. Do not proceed to Module 6 until Module 5 reviewer decision is PASS, including the benchmark hard gate at match_rate >= 0.70.
- Tracking note: rerun live Textract smoke after AWS account activation completes.
