'use client'

import type { ReactElement } from 'react'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@claimclarity/db'

type QueueCase = {
  id: string
  case_ref: string
  insurer_name: string | null
  claim_amount_inr: number | null
  confidence_overall: 'high' | 'mixed' | 'low' | null
  status: string
  sla_deadline: string | null
  sla_breached: boolean | null
}

type QueueTableProps = {
  actorId: string
  actorRole: 'reviewer' | 'expert' | 'admin'
  cases: QueueCase[]
}

type RealtimeChannelLike = {
  on(
    event: string,
    config: Record<string, string | undefined>,
    callback: () => void
  ): RealtimeChannelLike
  subscribe(): RealtimeChannelLike
}

type RealtimeClientLike = {
  channel(name: string): RealtimeChannelLike
  removeChannel(channel: RealtimeChannelLike): Promise<unknown>
}

function formatClaim(value: number | null): string {
  return typeof value === 'number' ? `₹${value.toLocaleString('en-IN')}` : 'Not captured'
}

function confidenceClass(value: QueueCase['confidence_overall']): string {
  if (value === 'high') return 'bg-emerald-200 text-emerald-950'
  if (value === 'mixed') return 'bg-amber-200 text-amber-950'
  return 'bg-red-200 text-red-950'
}

function statusClass(status: string): string {
  if (status === 'ai_draft_ready') return 'bg-sky-200 text-sky-950'
  if (status === 'under_review') return 'bg-amber-200 text-amber-950'
  if (status === 'escalated') return 'bg-red-200 text-red-950'
  return 'bg-neutral-200 text-neutral-950'
}

function formatSla(caseRow: QueueCase): { text: string; className: string } {
  if (caseRow.sla_breached) return { text: 'OVERDUE', className: 'bg-red-500 text-white' }
  if (!caseRow.sla_deadline) return { text: 'No SLA', className: 'text-neutral-400' }

  const deadline = new Date(caseRow.sla_deadline)
  const diffMs = deadline.getTime() - Date.now()
  if (diffMs <= 0) return { text: 'OVERDUE', className: 'bg-red-500 text-white' }
  const hours = Math.floor(diffMs / 3_600_000)
  const minutes = Math.floor((diffMs % 3_600_000) / 60_000)
  if (hours < 4) {
    return {
      text: `${String(hours)}h ${String(minutes)}m left`,
      className: 'animate-pulse text-red-300',
    }
  }
  if (hours < 24) {
    return { text: `${String(hours)}h ${String(minutes)}m left`, className: 'text-amber-300' }
  }
  return {
    text: deadline.toLocaleString('en-IN', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }),
    className: 'text-neutral-300',
  }
}

export function QueueTable({ actorId, actorRole, cases }: QueueTableProps): ReactElement {
  const router = useRouter()

  useEffect(() => {
    const supabase = createBrowserClient() as unknown as RealtimeClientLike
    const filter = actorRole === 'admin' ? undefined : `assigned_reviewer_id=eq.${actorId}`
    const channel = supabase
      .channel('module7-review-queue')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cases', filter },
        () => {
          router.refresh()
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [actorId, actorRole, router])

  return (
    <div className="overflow-x-auto border-y border-neutral-800">
      <table className="w-full min-w-[900px] border-collapse text-left text-sm">
        <thead className="text-neutral-300">
          <tr>
            <th className="py-4 pr-4">Case Ref</th>
            <th className="py-4 pr-4">Insurer</th>
            <th className="py-4 pr-4">Claim ₹</th>
            <th className="py-4 pr-4">Confidence</th>
            <th className="py-4 pr-4">Status</th>
            <th className="py-4 pr-4">SLA</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((caseRow) => {
            const sla = formatSla(caseRow)
            return (
              <tr
                className="cursor-pointer border-t border-neutral-900 hover:bg-neutral-900"
                key={caseRow.id}
                onClick={() => {
                  router.push(`/cases/${caseRow.id}`)
                }}
              >
                <td className="py-4 pr-4 font-medium text-white">{caseRow.case_ref}</td>
                <td className="py-4 pr-4 text-neutral-300">{caseRow.insurer_name ?? 'Unknown'}</td>
                <td className="py-4 pr-4 text-neutral-300">{formatClaim(caseRow.claim_amount_inr)}</td>
                <td className="py-4 pr-4">
                  <span className={`rounded px-2 py-1 text-xs ${confidenceClass(caseRow.confidence_overall)}`}>
                    {caseRow.confidence_overall ?? 'low'}
                  </span>
                </td>
                <td className="py-4 pr-4">
                  <span className={`rounded px-2 py-1 text-xs ${statusClass(caseRow.status)}`}>
                    {caseRow.status}
                  </span>
                </td>
                <td className="py-4 pr-4">
                  <span className={`rounded px-2 py-1 text-xs ${sla.className}`}>{sla.text}</span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
