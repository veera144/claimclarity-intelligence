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

type JobQueueHealth = {
  queued: number
  running: number
  failed_last_hour: number
}

export type ProcessorHealthPayload = {
  status: 'ok' | 'degraded' | 'error'
  timestamp: string
  checks: {
    database: 'ok' | 'error'
    jobQueue: JobQueueHealth
  }
}

function oneHourAgo(): string {
  return new Date(Date.now() - 60 * 60 * 1000).toISOString()
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
      const payload = await getProcessorHealth(deps)

      return response.status(payload.status === 'error' ? 503 : 200).json(payload)
    } catch (error) {
      console.error('[health] Failed to evaluate health checks', error)

      return response.status(503).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        checks: {
          database: 'error',
          jobQueue: {
            queued: 0,
            running: 0,
            failed_last_hour: 0
          }
        }
      })
    }
  })

  return router
}

/**
 * Reads processor health and queue status.
 *
 * SIDE EFFECTS: reads processing_jobs counts from the database
 * THROWS: Error when database count queries fail
 * IDEMPOTENT: yes, read-only
 *
 * @param deps - Shared dependencies needed to query processor state
 * @returns Processor health payload
 */
export async function getProcessorHealth(deps: HealthRouterDeps): Promise<ProcessorHealthPayload> {
  const [queuedResult, runningResult, failedResult] = await Promise.all([
    deps.db.from('processing_jobs').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
    deps.db.from('processing_jobs').select('id', { count: 'exact', head: true }).eq('status', 'running'),
    deps.db
      .from('processing_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'failed')
      .gte('completed_at', oneHourAgo()),
  ])

  const databaseOk = !queuedResult.error && !runningResult.error && !failedResult.error
  const jobQueue: JobQueueHealth = {
    queued: queuedResult.count ?? 0,
    running: runningResult.count ?? 0,
    failed_last_hour: failedResult.count ?? 0,
  }

  return {
    status: databaseOk ? (jobQueue.failed_last_hour > 5 ? 'degraded' : 'ok') : 'error',
    timestamp: new Date().toISOString(),
    checks: {
      database: databaseOk ? 'ok' : 'error',
      jobQueue,
    },
  }
}
