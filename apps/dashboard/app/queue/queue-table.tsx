'use client'

import type { ReactElement } from 'react'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@claimclarity/db/client.browser'

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
  return typeof value === 'number' ? `Rs ${value.toLocaleString('en-IN')}` : 'Not captured'
}

function confidenceTone(value: QueueCase['confidence_overall']): 'covered' | 'attention' | 'deducted' {
  if (value === 'high') return 'covered'
  if (value === 'mixed') return 'attention'
  return 'deducted'
}

function statusTone(status: string): 'teal' | 'attention' | 'deducted' | 'neutral' {
  if (status === 'ai_draft_ready') return 'teal'
  if (status === 'under_review') return 'attention'
  if (status === 'escalated') return 'deducted'
  return 'neutral'
}

function toneDot(tone: 'teal' | 'attention' | 'deducted' | 'covered' | 'neutral'): string {
  if (tone === 'covered') return 'bg-covered-500'
  if (tone === 'attention') return 'bg-attention-500'
  if (tone === 'deducted') return 'bg-deducted-500'
  if (tone === 'neutral') return 'bg-slate-400'
  return 'bg-teal-500'
}

function formatSla(caseRow: QueueCase): { text: string; className: string } {
  if (caseRow.sla_breached) return { text: 'Overdue', className: 'text-deducted-700' }
  if (!caseRow.sla_deadline) return { text: 'No SLA', className: 'text-slate-500' }

  const deadline = new Date(caseRow.sla_deadline)
  const diffMs = deadline.getTime() - Date.now()
  if (diffMs <= 0) return { text: 'Overdue', className: 'text-deducted-700' }
  const hours = Math.floor(diffMs / 3_600_000)
  const minutes = Math.floor((diffMs % 3_600_000) / 60_000)
  if (hours < 4) {
    return {
      text: `${String(hours)}h ${String(minutes)}m left`,
      className: 'text-deducted-700',
    }
  }
  if (hours < 24) {
    return { text: `${String(hours)}h ${String(minutes)}m left`, className: 'text-attention-700' }
  }

  return {
    text: deadline.toLocaleString('en-IN', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    }),
    className: 'text-slate-600',
  }
}

function formatStatus(status: string): string {
  return status
    .split('_')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
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
    <div className="internal-surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-6 py-4 pr-4">Case Ref</th>
              <th className="py-4 pr-4">Insurer</th>
              <th className="py-4 pr-4">Claim</th>
              <th className="py-4 pr-4">Confidence</th>
              <th className="py-4 pr-4">Status</th>
              <th className="py-4 pr-6">SLA</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((caseRow) => {
              const sla = formatSla(caseRow)
              const confidence = confidenceTone(caseRow.confidence_overall)
              const status = statusTone(caseRow.status)

              return (
                <tr
                  className="cursor-pointer border-t border-slate-200 transition hover:bg-slate-50"
                  key={caseRow.id}
                  onClick={() => {
                    router.push(`/cases/${caseRow.id}`)
                  }}
                >
                  <td className="px-6 py-4 pr-4 font-medium text-navy-950">{caseRow.case_ref}</td>
                  <td className="py-4 pr-4 text-slate-600">{caseRow.insurer_name ?? 'Unknown'}</td>
                  <td className="py-4 pr-4 tabular-nums text-slate-600">
                    {formatClaim(caseRow.claim_amount_inr)}
                  </td>
                  <td className="py-4 pr-4">
                    <span className="internal-badge">
                      <span className={`internal-dot ${toneDot(confidence)}`} />
                      {caseRow.confidence_overall ?? 'low'}
                    </span>
                  </td>
                  <td className="py-4 pr-4">
                    <span className="internal-badge">
                      <span className={`internal-dot ${toneDot(status)}`} />
                      {formatStatus(caseRow.status)}
                    </span>
                  </td>
                  <td className={`py-4 pr-6 text-sm font-medium ${sla.className}`}>{sla.text}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
