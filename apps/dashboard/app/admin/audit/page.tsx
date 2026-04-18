import type { ReactElement } from 'react'
import Link from 'next/link'
import { createServerClient, type Json } from '@claimclarity/db'

import { requireAdminActor } from '../../../lib/ops/admin'
import { safeMetadata, truncateId } from '../../../lib/ops/redaction'

type AuditPageProps = {
  searchParams?: {
    action?: string
    entity_type?: string
    entity_id?: string
    from?: string
    to?: string
    page?: string
  }
}

type AuditRow = {
  id: string
  actor_role: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  ip_address: string | null
  metadata: Json | null
  created_at: string | null
}

function pageNumber(value: string | undefined): number {
  const parsed = Number(value ?? '1')
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

function exportHref(searchParams: AuditPageProps['searchParams']): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (value && key !== 'page') params.set(key, value)
  }
  return `/api/admin/audit/export?${params.toString()}`
}

export default async function AuditLogPage({ searchParams }: AuditPageProps): Promise<ReactElement> {
  await requireAdminActor()
  const supabase = await createServerClient()
  const page = pageNumber(searchParams?.page)
  const from = (page - 1) * 50
  const to = from + 49

  let query = supabase
    .from('audit_log')
    .select('id, actor_role, action, entity_type, entity_id, ip_address, metadata, created_at')
    .order('created_at', { ascending: false })
    .range(from, to)

  if (searchParams?.action) query = query.eq('action', searchParams.action)
  if (searchParams?.entity_type) query = query.eq('entity_type', searchParams.entity_type)
  if (searchParams?.entity_id) query = query.eq('entity_id', searchParams.entity_id)
  if (searchParams?.from) query = query.gte('created_at', searchParams.from)
  if (searchParams?.to) query = query.lte('created_at', searchParams.to)

  const { data, error } = await query
  if (error) throw new Error(error.message)
  const rows = data as AuditRow[]

  return (
    <main className="min-h-screen bg-neutral-950 px-6 py-10 text-neutral-100">
      <div className="mx-auto max-w-7xl">
        <p className="text-sm uppercase text-emerald-300">Operations</p>
        <h1 className="mt-3 text-3xl font-semibold">Audit viewer</h1>

        <form className="mt-8 grid gap-3 border-y border-neutral-800 py-5 md:grid-cols-5">
          <input
            className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
            defaultValue={searchParams?.from ?? ''}
            name="from"
            placeholder="From ISO timestamp"
          />
          <input
            className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
            defaultValue={searchParams?.to ?? ''}
            name="to"
            placeholder="To ISO timestamp"
          />
          <input
            className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
            defaultValue={searchParams?.action ?? ''}
            name="action"
            placeholder="Action"
          />
          <input
            className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
            defaultValue={searchParams?.entity_type ?? ''}
            name="entity_type"
            placeholder="Entity type"
          />
          <input
            className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
            defaultValue={searchParams?.entity_id ?? ''}
            name="entity_id"
            placeholder="Entity id"
          />
          <button className="w-fit rounded bg-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-950">
            Filter
          </button>
          <Link className="w-fit rounded border border-neutral-700 px-4 py-2 text-sm no-underline" href={exportHref(searchParams)}>
            Export CSV
          </Link>
        </form>

        <div className="mt-8 overflow-x-auto border-y border-neutral-800">
          <table className="w-full min-w-[1000px] text-left text-sm">
            <thead className="text-neutral-400">
              <tr>
                <th className="py-3 pr-4">Timestamp</th>
                <th className="py-3 pr-4">Actor role</th>
                <th className="py-3 pr-4">Action</th>
                <th className="py-3 pr-4">Entity type</th>
                <th className="py-3 pr-4">Entity</th>
                <th className="py-3 pr-4">IP</th>
                <th className="py-3 pr-4">Safe metadata</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className="border-t border-neutral-900 align-top" key={row.id}>
                  <td className="py-3 pr-4">{row.created_at ?? '-'}</td>
                  <td className="py-3 pr-4">{row.actor_role ?? '-'}</td>
                  <td className="py-3 pr-4">{row.action}</td>
                  <td className="py-3 pr-4">{row.entity_type ?? '-'}</td>
                  <td className="py-3 pr-4">{truncateId(row.entity_id)}</td>
                  <td className="py-3 pr-4">{row.ip_address ?? '-'}</td>
                  <td className="py-3 pr-4">
                    <pre className="whitespace-pre-wrap text-xs text-neutral-400">
                      {JSON.stringify(safeMetadata(row.metadata), null, 2)}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex gap-3">
          {page > 1 ? (
            <Link className="rounded border border-neutral-700 px-3 py-2 no-underline" href={`/admin/audit?page=${String(page - 1)}`}>
              Previous
            </Link>
          ) : null}
          <Link className="rounded border border-neutral-700 px-3 py-2 no-underline" href={`/admin/audit?page=${String(page + 1)}`}>
            Next
          </Link>
        </div>
      </div>
    </main>
  )
}
