import type { ReactElement } from 'react'
import Link from 'next/link'
import { createServiceClient } from '@claimclarity/db'

import { InternalBadge, InternalScaffold } from '../../../../../components/internal-ui'
import { requireAdminActor } from '../../../../../lib/ops/admin'

import { updateAssignmentAction } from './actions'

type PageProps = {
  params: {
    caseId: string
  }
}

type CaseAssignmentRow = {
  id: string
  case_ref: string
  status: string
  assigned_reviewer_id: string | null
  assigned_expert_id: string | null
}

type InternalUserRow = {
  id: string
  email: string
  full_name: string | null
  role: 'reviewer' | 'expert'
}

function displayUser(user: InternalUserRow): string {
  return user.full_name ? `${user.full_name} (${user.email})` : user.email
}

export default async function AdminCaseAssignmentPage({
  params,
}: PageProps): Promise<ReactElement> {
  await requireAdminActor()
  const serviceClient = createServiceClient()
  const [caseResult, usersResult] = await Promise.all([
    serviceClient
      .from('cases')
      .select('id, case_ref, status, assigned_reviewer_id, assigned_expert_id')
      .eq('id', params.caseId)
      .maybeSingle(),
    serviceClient
      .from('users')
      .select('id, email, full_name, role')
      .in('role', ['reviewer', 'expert'])
      .order('email'),
  ])

  if (caseResult.error) throw new Error(caseResult.error.message)
  if (usersResult.error) throw new Error(usersResult.error.message)
  if (!caseResult.data) throw new Error('Case not found')

  const caseRow = caseResult.data as CaseAssignmentRow
  const users = usersResult.data as InternalUserRow[]
  const reviewers = users.filter((user) => user.role === 'reviewer')
  const experts = users.filter((user) => user.role === 'expert')

  return (
    <InternalScaffold
      eyebrow="Pilot admin"
      title="Reviewer and expert assignment"
      description={`Assign internal owners for case ${caseRow.case_ref}. This page does not change review gates or expose patient documents.`}
      actions={
        <Link className="internal-secondary-button" href={`/cases/${params.caseId}`}>
          Open review page
        </Link>
      }
    >
      <section className="internal-status-card border-l-4 border-teal-500">
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-slate-500">Case</dt>
            <dd className="mt-1 font-semibold text-navy-950">{caseRow.case_ref}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Status</dt>
            <dd className="mt-1">
              <InternalBadge label={caseRow.status} tone="navy" />
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Current owner state</dt>
            <dd className="mt-1 font-semibold text-navy-950">
              {caseRow.assigned_reviewer_id ? 'Reviewer assigned' : 'Reviewer open'}
            </dd>
          </div>
        </dl>
      </section>

      <form action={updateAssignmentAction} className="internal-surface mt-8 grid gap-5 p-8">
        <input name="case_id" type="hidden" value={caseRow.id} />
        <label className="grid gap-2 text-sm font-medium text-navy-800">
          Reviewer
          <select
            className="internal-select"
            defaultValue={caseRow.assigned_reviewer_id ?? ''}
            name="reviewer_id"
          >
            <option value="">Unassigned</option>
            {reviewers.map((reviewer) => (
              <option key={reviewer.id} value={reviewer.id}>
                {displayUser(reviewer)}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-medium text-navy-800">
          Expert
          <select
            className="internal-select"
            defaultValue={caseRow.assigned_expert_id ?? ''}
            name="expert_id"
          >
            <option value="">Unassigned</option>
            {experts.map((expert) => (
              <option key={expert.id} value={expert.id}>
                {displayUser(expert)}
              </option>
            ))}
          </select>
        </label>
        <div className="internal-status-card border-l-4 border-attention-500">
          Only admins can update assignment. Reviewers cannot self-assign from this route.
        </div>
        <div className="flex flex-wrap gap-3">
          <button className="internal-primary-button">Save assignment</button>
          <Link className="internal-secondary-button" href={`/cases/${params.caseId}`}>
            Open review page
          </Link>
        </div>
      </form>
    </InternalScaffold>
  )
}
