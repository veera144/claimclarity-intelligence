# AGENTS.md
## ClaimClarity agent operating rules
### Use with MASTER_SPEC.md

This repository uses a **manager → builder → reviewer** workflow.

`MASTER_SPEC.md` is the only implementation source of truth.
Do not use earlier patch docs once this file exists.

---

## 1. ROLES

### Manager Agent
Responsible for orchestration and gating.

Must:
- decide the current module to build
- verify prerequisites for that module are already complete
- stop the process if a module has unresolved failures
- require reviewer sign-off before moving to the next module
- update `IMPLEMENTATION_CHECKLIST.md` after each module

Must not:
- implement code directly unless explicitly asked
- skip a failed checkpoint
- invent scope outside MASTER_SPEC.md

### Builder Agent
Responsible for writing code for the current module only.

Must:
- read the relevant module section in `MASTER_SPEC.md`
- read all engineering rules in `MASTER_SPEC.md`
- keep changes scoped to the current module
- run lint, typecheck, and module-specific verification before handing off
- report exactly what changed and what still fails

Must not:
- start the next module
- change unrelated files
- weaken security, validation, or money-unit rules for convenience
- replace required tests with placeholders

### Reviewer Agent
Responsible for independent compliance review.

Must:
- review code and diffs against `MASTER_SPEC.md`
- verify all checkpoints for the current module
- review schema, auth, RLS, money units, outcome security, and AI token constraints where relevant
- output one of:
  - `PASS`
  - `PASS WITH MINOR FIXES`
  - `BLOCKED`
- provide exact patch instructions for anything blocked

Must not:
- rewrite the entire implementation
- approve a module with skipped tests
- allow drift from MASTER_SPEC.md

---

## 2. MANDATORY EXECUTION LOOP

For every module, follow this sequence:

1. **Manager Agent**
   - confirms module number
   - confirms prerequisites are green
   - opens module work

2. **Builder Agent**
   - reads current module in `MASTER_SPEC.md`
   - implements only that module
   - runs:
     - lint
     - typecheck
     - module test suite
     - module verification/checkpoint script
   - produces a short completion note

3. **Reviewer Agent**
   - audits against `MASTER_SPEC.md`
   - checks code, tests, security, and correctness
   - returns PASS / PASS WITH MINOR FIXES / BLOCKED

4. **Manager Agent**
   - if PASS: marks module complete and opens next module
   - if PASS WITH MINOR FIXES: require builder to fix, then re-review
   - if BLOCKED: stop progression until fixed

Do not move forward with unresolved reviewer findings.

---

## 3. REQUIRED VALIDATION AFTER EVERY MODULE

Minimum required after each module:
- `pnpm lint`
- `pnpm typecheck`
- module-specific tests
- module-specific verification script or checkpoint suite

For modules involving schema, auth, or security:
- rerun relevant regression checks from earlier modules if affected

For modules involving the AI layer:
- rerun prompt regression tests
- confirm token budget is still within limits

For modules involving outcome tracking:
- confirm whole-rupee analytics are not divided by 100
- confirm tokenized outcome authorization still works

---

## 4. REVIEW GUIDELINES

The Reviewer Agent must explicitly check the items below whenever relevant to the current module.

### Schema and state
- schema changes follow migration discipline and do not silently drift from `MASTER_SPEC.md`
- status transitions match the defined workflow exactly
- required rows are pre-created where the spec expects them
- idempotency keys exist for queueable jobs that require them

### Auth and security
- no route uses raw `caseRef` alone as authorization for a state-changing action
- patient routes are protected by session or approved one-time token flow only
- reviewer access is restricted to assigned work, not all internal cases
- service-role usage is limited to places explicitly allowed by the spec
- no patient-facing response leaks internal stack traces or private details

### Money and data correctness
- whole-rupee fields are not divided by 100
- paise fields are never treated as whole rupees
- `finding_id` is never truncated before the AI layer
- raw OCR text is never sent to the AI layer
- outcome metrics calculate reversal amounts correctly

### AI layer
- token budget rules remain within the limits defined in `MASTER_SPEC.md`
- prompt regression tests pass after any AI or KB-related change
- fallback path exists and is still compliant with output rules
- all AI-generated output remains reviewer-gated before patient delivery

### Testing
- required module tests and verification scripts were actually run
- changed modules reran any affected earlier-module checks
- no placeholder tests were used to satisfy a checkpoint

If any of the above fails, the module is `BLOCKED` unless the issue is clearly cosmetic and non-risk-bearing.

---

## 5. RED LINES

Never:
- use raw caseRef alone as authorization for outcome submission
- send raw OCR text to the AI layer
- truncate `finding_id` before sending to the AI layer
- mix paise and rupees
- expose internal errors to patients
- bypass reviewer sign-off
- widen reviewer RLS to all internal cases
- create broker portal logic in V1
- silently change schema without migration discipline
- skip module tests because “the logic is simple”

---

## 6. CONFLICT RULE

If code, prompt text, and spec appear inconsistent:
1. stop
2. create `SPEC_GAP.md`
3. write:
   - exact conflict
   - affected module
   - recommended resolution
4. wait for explicit resolution before continuing

Do not guess.

---

## 7. MODULE COMPLETION FORMAT

After each module, the Builder Agent must output:

```text
MODULE: <number and name>
STATUS: READY FOR REVIEW

Implemented:
- ...
- ...

Verification run:
- lint: PASS/FAIL
- typecheck: PASS/FAIL
- tests: PASS/FAIL
- module checkpoints: X/Y passed

Known issues:
- none
or
- ...
```

The Reviewer Agent must output:

```text
MODULE REVIEW: <number and name>
DECISION: PASS | PASS WITH MINOR FIXES | BLOCKED

Checks performed:
- spec compliance
- test evidence
- security / RLS / validation
- money-unit correctness
- AI / token / prompt rules (if applicable)

Findings:
1. ...
2. ...

Required fixes before next module:
- ...
```

The Manager Agent must update:
- `IMPLEMENTATION_CHECKLIST.md`
- current module state
- next module eligibility

---

## 8. REPO FILES TO CREATE AT START

- `MASTER_SPEC.md`
- `AGENTS.md`
- `IMPLEMENTATION_CHECKLIST.md`
- optional: `REVIEW_AGENT_PROMPT.md`
- optional: `SPEC_GAP.md` (only when needed)
