/**
 * @file health.ts
 * @module processor/health
 *
 * Express health route for Railway liveness and readiness checks.
 *
 * DEPENDENCIES:
 *   - express (router primitives)
 *   - /packages/db/src/types.ts
 *
 * CALLED BY:
 *   - /apps/processor/src/index.ts
 *
 * CALLS:
 *   - Supabase processing_jobs table
 */

import { Router } from 'express'
import type { DbClient } from '@claimclarity/db'

export type HealthRouterDeps = {
  db: DbClient
}

/**
 * Builds the processor health router with a database-backed queue snapshot.
 *
 * SIDE EFFECTS: reads processing_jobs counts from the database
 * THROWS: never, errors are converted into a 503 health response
 * IDEMPOTENT: yes, reads health state only
 *
 * @param deps - Shared dependencies needed to query processor state
 * @returns An Express router exposing GET /health
 */
export function createHealthRouter(deps: HealthRouterDeps): Router {
  const router = Router()

  router.get('/health', async (_request, response) => {
    try {
      const [queuedResult, runningResult] = await Promise.all([
        deps.db.from('processing_jobs').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
        deps.db
          .from('processing_jobs')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'running')
      ])

      const databaseOk = !queuedResult.error && !runningResult.error
      const payload = {
        status: databaseOk ? 'ok' : 'error',
        timestamp: new Date().toISOString(),
        checks: {
          database: databaseOk ? 'ok' : 'error',
          jobQueue: {
            queued: queuedResult.count ?? 0,
            running: runningResult.count ?? 0
          }
        }
      }

      return response.status(databaseOk ? 200 : 503).json(payload)
    } catch (error) {
      console.error('[health] Failed to evaluate health checks', error)

      return response.status(503).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        checks: {
          database: 'error',
          jobQueue: {
            queued: 0,
            running: 0
          }
        }
      })
    }
  })

  return router
}
