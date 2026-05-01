/**
 * @file index.ts
 * @module processor/index
 *
 * Processor entry point for the ClaimClarity Railway service.
 *
 * DEPENDENCIES:
 *   - express (HTTP server)
 *   - /apps/processor/src/health.ts
 *   - /packages/db/src/client.server.ts
 *   - /packages/shared/src/config.ts
 *
 * CALLED BY:
 *   - Railway process startup
 *
 * CALLS:
 *   - /apps/processor/src/health.ts
 */

import express from 'express'
import { createServiceClient } from '@claimclarity/db'
import { validateConfig } from '@claimclarity/shared'

import { createHealthRouter } from './health.ts'
import { initializeProcessorSentry } from './sentry.ts'

initializeProcessorSentry()
validateConfig()

const app = express()
const port = Number(process.env.PORT ?? '3002')

app.use(createHealthRouter({ db: createServiceClient() }))

app.listen(port, () => {
  console.log(`[processor] Listening on port ${String(port)}`)
})
