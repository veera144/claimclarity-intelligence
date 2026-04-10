# ClaimClarity — Start Here

This repository is driven by one source of truth and one execution workflow.

## Active files

Use these files only:
- `MASTER_SPEC.md` — full product, architecture, module, schema, test, and standards source of truth
- `AGENTS.md` — manager → builder → reviewer operating rules
- `IMPLEMENTATION_CHECKLIST.md` — progress tracker for modules 0–10
- `REVIEW_AGENT_PROMPT.md` — optional reusable reviewer prompt

Do not use older BRD patch files once `MASTER_SPEC.md` exists.

## What each file does

### `MASTER_SPEC.md`
Defines:
- what to build
- what not to build
- schema and money-unit rules
- auth, RLS, AI, delivery, and outcome-tracking rules
- module order
- per-module checkpoints

### `AGENTS.md`
Defines:
- agent roles
- mandatory build → review → gate loop
- validation after every module
- review guidelines
- red lines and stop conditions

### `IMPLEMENTATION_CHECKLIST.md`
Use this to track:
- current module
- build status
- review result
- next module eligibility

### `REVIEW_AGENT_PROMPT.md`
Use this when you want a dedicated reviewer agent to audit a module independently.

## Recommended execution flow

1. Read `MASTER_SPEC.md`
2. Read `AGENTS.md`
3. Open `IMPLEMENTATION_CHECKLIST.md`
4. Start with Module 0 only
5. Do not move to the next module until:
   - lint passes
   - typecheck passes
   - module tests pass
   - module checkpoint script passes
   - reviewer returns `PASS`

## Codex / Claude Code usage

Use this sentence at the top of every implementation request:

```text
Before writing any code:
1. Read MASTER_SPEC.md
2. Read AGENTS.md
3. Build only the requested module
4. Run required validations
5. Stop after module completion and hand off for review
```

## If something conflicts

If code, prompt text, and spec do not agree:
- stop
- create `SPEC_GAP.md`
- record the exact conflict
- do not guess

## Suggested repo root layout

```text
/MASTER_SPEC.md
/AGENTS.md
/IMPLEMENTATION_CHECKLIST.md
/REVIEW_AGENT_PROMPT.md
/README_START_HERE.md
/apps
/packages
```

## Final rule

`MASTER_SPEC.md` is the only implementation source of truth.
Everything else supports execution, review, and tracking.
