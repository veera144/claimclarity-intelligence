import type { ReactElement } from 'react'
import { createServerClient, type Json } from '@claimclarity/db'

import { requireAdminActor } from '../../../lib/ops/admin'
import { safeMetadata, truncateId } from '../../../lib/ops/redaction'

type AuditRow = {
  id: string
  action: string
  entity_id: string | null
  metadata: Json | null
  created_at: string | null
}

type EmailJobRow = {
  id: string
  case_id: string
  status: string
  attempt_count: number | null
  next_retry_at: string | null
  error_message: string | null
}

export default async function FailedRemindersPage(): Promise<ReactElement> {
  await requireAdminActor()
  const supabase = await createServerClient()
  const [auditsResult, jobsResult] = await Promise.all([
    supabase
      .from('audit_log')
      .select('id, action, entity_id, metadata, created_at')
      .in('action', ['followup_email_failed', 'delivery_email_failed'])
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('processing_jobs')
      .select('id, case_id, status, attempt_count, next_retry_at, error_message')
      .eq('job_type', 'email_delivery')
      .in('status', ['retrying', 'failed'])
      .order('next_retry_at', { ascending: true })
      .limit(100),
  ])

  if (auditsResult.error) throw new Error(auditsResult.error.message)
  if (jobsResult.error) throw new Error(jobsResult.error.message)
  const audits = auditsResult.data as AuditRow[]
  const jobs = jobsResult.data as EmailJobRow[]

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <div className="mx-auto max-w-7xl">
        <p className="text-sm uppercase text-emerald-300">Operations</p>
        <h1 className="mt-3 text-3xl font-semibold">Failed reminders and emails</h1>

        <section className="mt-8">
          <h2 className="text-xl font-semibold">Reminder failures</h2>
          <div className="mt-4 grid gap-3">
            {audits.map((audit) => (
              <article className="border border-neutral-800 p-4" key={audit.id}>
                <div className="flex flex-wrap justify-between gap-3 text-sm">
                  <span>{audit.action}</span>
                  <span className="text-neutral-400">{audit.created_at ?? '-'}</span>
                </div>
                <p className="mt-2 text-sm text-neutral-300">Case {truncateId(audit.entity_id)}</p>
                <pre className="mt-2 whitespace-pre-wrap text-xs text-neutral-400">
                  {JSON.stringify(safeMetadata(audit.metadata), null, 2)}
                </pre>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-semibold">Delivery retry jobs</h2>
          <div className="mt-4 overflow-x-auto border-y border-neutral-800">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead className="text-neutral-400">
                <tr>
                  <th className="py-3 pr-4">Job</th>
                  <th className="py-3 pr-4">Case</th>
                  <th className="py-3 pr-4">Status</th>
                  <th className="py-3 pr-4">Attempts</th>
                  <th className="py-3 pr-4">Next retry</th>
                  <th className="py-3 pr-4">Safe error</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr className="border-t border-neutral-900" key={job.id}>
                    <td className="py-3 pr-4">{truncateId(job.id)}</td>
                    <td className="py-3 pr-4">{truncateId(job.case_id)}</td>
                    <td className="py-3 pr-4">{job.status}</td>
                    <td className="py-3 pr-4">{job.attempt_count ?? 0}</td>
                    <td className="py-3 pr-4">{job.next_retry_at ?? '-'}</td>
                    <td className="py-3 pr-4">{job.error_message?.slice(0, 120) ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}
