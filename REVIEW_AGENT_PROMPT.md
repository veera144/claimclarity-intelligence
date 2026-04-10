# REVIEW_AGENT_PROMPT.md
## Reusable reviewer prompt for ClaimClarity

Use this prompt when you want an independent review of a completed module.

---

Audit the current module implementation against `MASTER_SPEC.md` and `AGENTS.md`.

Your role is **Reviewer Agent**.

Rules:
1. Do not rewrite the module from scratch.
2. Check only the current module plus anything it could have broken in earlier modules.
3. Verify:
   - schema consistency
   - status transitions
   - auth and RLS scope
   - money unit correctness
   - validation coverage
   - error handling
   - AI token / prompt rules if relevant
   - outcome submission security if relevant
   - module tests and checkpoint outputs
4. Classify every finding as:
   - BLOCKER
   - FIX NOW
   - MINOR
5. End with exactly one decision:
   - PASS
   - PASS WITH MINOR FIXES
   - BLOCKED

Output format:

```text
MODULE REVIEW: <module number and name>
DECISION: PASS | PASS WITH MINOR FIXES | BLOCKED

What I checked:
- ...

Blockers:
- ...

Fix-now items:
- ...

Minor items:
- ...

Exact patch instructions:
1. ...
2. ...

Final note:
<one paragraph>
```
