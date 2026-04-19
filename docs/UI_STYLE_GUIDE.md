# ClaimClarity UI Style Guide

## Purpose

ClaimClarity screens should feel calm, trustworthy, and serious. Patients may be reading these screens while dealing with denied or partially paid medical claims, so the interface must avoid playful patterns, fear-based copy, and generic enterprise styling.

This guide applies to new or touched local E2E enablement screens, especially patient case list/resume, patient case status, admin assignment, and manual OCR fallback pages.

## Color System

- Navy is the primary brand anchor for headers, navigation, page structure, and trusted emphasis.
- Teal is the primary action and guidance color.
- Semantic colors must keep fixed meanings:
  - Green: covered, recovered, positive.
  - Amber: at-risk, needs attention.
  - Red: deducted, failed, blocked.
  - Teal: informational, action, neutral guidance.
- Use Tailwind tokens from `tailwind.config.ts`, such as `bg-navy-800`, `text-teal-500`, and `border-teal-200`.
- Avoid scattered hardcoded hex values in components.

## Cards And Status

- Finding and status cards should use a 4px left border as the primary status indicator.
- Do not flood a full card background with red, amber, or green.
- Keep card surfaces neutral so deduction-heavy screens do not feel catastrophic.
- Use direct labels such as `Needs reviewer attention`, `Report ready`, `More information needed`, and `Potential deduction`.

## Confidence Badges

- Use a dot plus label pattern.
- Avoid tiny status icons that patients or reviewers must decode.
- Recommended labels:
  - Green dot: `Clause found`
  - Amber dot: `Typical-policy match`
  - Red or neutral dot: `Needs review`

## Money Display

- Important money values must use tabular numerals.
- Prefer a reusable class or component with `font-variant-numeric: tabular-nums`.
- Use color for direction only:
  - Green for recovered or positive movement.
  - Red for deducted or negative movement.
- Do not use oversized typography to make one amount feel more emotionally important than another.

## UX Tone

- Use calm, plain language.
- Avoid fear-based warnings and celebration patterns.
- Do not expose internal logs, raw OCR text, AI prompts, token metadata, provider traces, or technical failure details.
- Patient-facing pages should explain what is complete, what needs action, and what happens next.
- Dashboard pages may be denser, but must preserve role boundaries and the same semantic color meanings.

## Scope Discipline

- Apply this style to new and touched screens only.
- Do not redesign every existing page as part of E2E enablement.
- Prefer reusable classes and small shared components over one-off styling.
- Do not weaken existing security gates or expose internal workflows to patient routes.
