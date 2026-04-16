/**
 * @file aiRegression.ts
 * @module processor/tests
 *
 * Module 6 prompt regression entry point.
 *
 * DEPENDENCIES:
 *   - /apps/processor/tests/module6.test.ts
 *
 * CALLED BY:
 *   - pnpm test:ai-regression
 *
 * CALLS:
 *   - /apps/processor/tests/module6.test.ts
 */

import { runModule6Checkpoints } from './module6.test'

runModule6Checkpoints('MODULE 6 AI PROMPT REGRESSION REPORT')
  .then((exitCode) => {
    process.exit(exitCode)
  })
  .catch((error: unknown) => {
    console.error('Module 6 AI regression runner crashed:', error)
    process.exit(1)
  })
