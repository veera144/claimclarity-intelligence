/**
 * @file run-job.ts
 * @module processor/cli
 *
 * One-shot local operator command for existing processing job functions.
 */

import { createServiceClient } from '@claimclarity/db'

import { processQueuedAiDraftJobs } from '../jobs/aiDraftJob'
import { processQueuedOcrJobs } from '../jobs/ocr-job'
import { processQueuedQualityCheckJobs } from '../jobs/quality-check'
import {
  processQueuedEmailDeliveryJobs,
  processQueuedReportGenerationJobs,
} from '../jobs/reportGenerationJob'
import { runSlaMonitor, runStaleProcessingJobMonitor } from '../ops/sla-monitor'
import { processDueFollowUpReminders } from '../outcomes/follow-up-reminders'
import { processQueuedRulesEngineJobs } from '../rulesEngine/engine'

import { loadLocalEnv } from './load-local-env'

type JobName =
  | 'quality'
  | 'ocr'
  | 'rules'
  | 'ai'
  | 'report'
  | 'email'
  | 'followups'
  | 'sla'
  | 'stale'
  | 'all-once'

type JobSummary = {
  job: string
  status: 'PASS' | 'FAIL'
  processed: number | string
}

const JOBS = new Set<JobName>([
  'quality',
  'ocr',
  'rules',
  'ai',
  'report',
  'email',
  'followups',
  'sla',
  'stale',
  'all-once',
])

loadLocalEnv()

function readJobName(): JobName {
  const raw = process.argv[2]
  if (JOBS.has(raw as JobName)) return raw as JobName
  throw new Error(
    'Usage: run-job.ts quality|ocr|rules|ai|report|email|followups|sla|stale|all-once'
  )
}

function printSummary(summary: JobSummary): void {
  console.log(`${summary.status} ${summary.job}: ${String(summary.processed)}`)
}

async function runSingle(job: Exclude<JobName, 'all-once'>, caseId?: string): Promise<JobSummary> {
  if (job === 'quality') {
    const processed = await processQueuedQualityCheckJobs(createServiceClient(), caseId)
    return { job, status: 'PASS', processed }
  }

  if (job === 'ocr') {
    const processed = await processQueuedOcrJobs(createServiceClient(), caseId)
    return { job, status: 'PASS', processed }
  }

  if (job === 'rules') {
    const processed = await processQueuedRulesEngineJobs(createServiceClient(), caseId)
    return { job, status: 'PASS', processed }
  }

  if (job === 'ai') {
    const processed = await processQueuedAiDraftJobs(createServiceClient(), caseId)
    return { job, status: 'PASS', processed }
  }

  if (job === 'report') {
    const processed = await processQueuedReportGenerationJobs(undefined, caseId)
    return { job, status: 'PASS', processed }
  }

  if (job === 'email') {
    const processed = await processQueuedEmailDeliveryJobs(undefined, undefined, caseId)
    return { job, status: 'PASS', processed }
  }

  if (job === 'followups') {
    const processed = await processDueFollowUpReminders()
    return { job, status: 'PASS', processed }
  }

  if (job === 'sla') {
    const processed = await runSlaMonitor()
    return {
      job,
      status: 'PASS',
      processed: `warnings=${String(processed.warningsSent)} breaches=${String(
        processed.breachesSent
      )}`,
    }
  }

  const processed = await runStaleProcessingJobMonitor()
  return {
    job,
    status: 'PASS',
    processed: `failed=${String(processed.jobsMarkedFailed)} notifications=${String(
      processed.notificationsInserted
    )}`,
  }
}

async function main(): Promise<void> {
  const job = readJobName()
  const caseId = process.env.CASE_ID

  if (job !== 'all-once') {
    printSummary(await runSingle(job, caseId))
    return
  }

  const orderedJobs: Array<Exclude<JobName, 'all-once'>> = [
    'quality',
    'ocr',
    'rules',
    'ai',
    'report',
    'email',
    'followups',
    'sla',
    'stale',
  ]

  for (const nextJob of orderedJobs) {
    // Sequential: all-once mirrors the existing local E2E operator handoff order.
    printSummary(await runSingle(nextJob, caseId))
  }

}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`FAIL processor job runner: ${message}`)
  process.exitCode = 1
})
