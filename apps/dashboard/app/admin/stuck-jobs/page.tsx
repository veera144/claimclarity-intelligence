import type { ReactElement } from 'react'
import { createServerClient } from '@claimclarity/db'

import { requireAdminActor } from '../../../lib/ops/admin'
import { truncateId } from '../../../lib/ops/redaction'

type JobRow = {
  id: string
  case_id: string
  job_type: string
  status: string
  attempt_count: number | null
  started_at: string | null
  next_retry_at: string | null
  error_message: string | null
}

export default async function StuckJobsPage(): Promise<ReactElement> {
  await requireAdminActor()
  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('processing_jobs')
    .select('id, case_id, job_type, status, attempt_count, started_at, next_retry_at, error_message')
    .in('status', ['running', 'retrying', 'failed'])
    .order('started_at', { ascending: true })
    .limit(100)

  if (error) throw new Error(error.message)
  const jobs = data as JobRow[]

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <div className="mx-auto max-w-7xl">
        <p className="text-sm uppercase text-emerald-300">Operations</p>
        <h1 className="mt-3 text-3xl font-semibold">Stuck jobs</h1>
        <div className="mt-8 overflow-x-auto border-y border-neutral-800">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="text-neutral-400">
              <tr>
                <th className="py-3 pr-4">Job</th>
                <th className="py-3 pr-4">Case</th>
                <th className="py-3 pr-4">Type</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">Attempts</th>
                <th className="py-3 pr-4">Started</th>
                <th className="py-3 pr-4">Next retry</th>
                <th className="py-3 pr-4">Safe error</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr className="border-t border-neutral-900" key={job.id}>
                  <td className="py-3 pr-4">{truncateId(job.id)}</td>
                  <td className="py-3 pr-4">{truncateId(job.case_id)}</td>
                  <td className="py-3 pr-4">{job.job_type}</td>
                  <td className="py-3 pr-4">{job.status}</td>
                  <td className="py-3 pr-4">{job.attempt_count ?? 0}</td>
                  <td className="py-3 pr-4">{job.started_at ?? '-'}</td>
                  <td className="py-3 pr-4">{job.next_retry_at ?? '-'}</td>
                  <td className="py-3 pr-4">{job.error_message?.slice(0, 120) ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}
