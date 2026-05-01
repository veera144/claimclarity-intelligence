import type { ReactElement } from 'react'
import { createServerClient, type Json } from '@claimclarity/db'

import { InternalBadge } from '../../../components/internal-ui'
import { requireDashboardActor } from '../../../lib/review/session'
import { createSupabaseReviewStore } from '../../../lib/review/supabase-store'
import { startCaseReview, type ReviewFinding } from '../../../lib/review/workflow'

import {
  confirmFindingAction,
  draftSectionAction,
  editFindingAction,
  escalateAction,
  missingDocumentAction,
  signOffAction,
  unassessableFindingAction,
} from './actions'

type PageProps = {
  params: {
    caseId: string
  }
}

type DocumentRow = {
  id: string
  doc_type: string
  storage_path: string
  mime_type: string | null
  quality_status: string | null
  quality_failure_reason: string | null
}

type ExpertRow = {
  id: string
  full_name: string | null
  email: string
}

type EscalationRow = {
  id: string
  finding_id: string | null
  question_text: string
  status: string
  expert_response: string | null
}

function isRecord(value: Json | null): value is Record<string, Json | undefined> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function claimAmount(value: number | null): string {
  return typeof value === 'number' ? `Rs ${value.toLocaleString('en-IN')}` : 'Not captured'
}

function paiseAmount(value: number | null): string {
  return typeof value === 'number' ? `Rs ${(value / 100).toLocaleString('en-IN')}` : 'Not captured'
}

function confidenceTone(value: string | null): 'covered' | 'attention' | 'deducted' {
  if (value === 'high' || value === 'clause_found_matched') return 'covered'
  if (value === 'mixed' || value === 'based_on_typical_policy') return 'attention'
  return 'deducted'
}

function statusTone(status: string): 'teal' | 'attention' | 'deducted' | 'neutral' {
  if (status === 'ai_draft_ready') return 'teal'
  if (status === 'under_review') return 'attention'
  if (status === 'escalated') return 'deducted'
  return 'neutral'
}

function formatLabel(value: string): string {
  return value
    .split('_')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function draftArray(draft: Json | null, key: string): string[] {
  if (!isRecord(draft)) return []
  const value = draft[key]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function draftString(draft: Json | null, key: string): string {
  if (!isRecord(draft)) return ''
  const value = draft[key]
  return typeof value === 'string' ? value : ''
}

function draftJson(draft: Json | null, key: string): string {
  if (!isRecord(draft)) return '[]'
  return JSON.stringify(draft[key] ?? [], null, 2)
}

function reviewComplete(finding: ReviewFinding): boolean {
  return (
    finding.reviewer_confirmed === true ||
    (finding.reviewer_unassessable === true &&
      typeof finding.reviewer_unassessable_reason === 'string' &&
      finding.reviewer_unassessable_reason.trim().length > 0)
  )
}

function hiddenCase(caseId: string): ReactElement {
  return <input name="case_id" type="hidden" value={caseId} />
}

function panelTitle(title: string, description?: string): ReactElement {
  return (
    <div className="mb-4">
      <h3 className="text-xl font-semibold text-navy-950">{title}</h3>
      {description ? <p className="mt-2 text-sm leading-7 text-slate-600">{description}</p> : null}
    </div>
  )
}

export default async function CaseReviewPage({ params }: PageProps): Promise<ReactElement> {
  const actor = await requireDashboardActor()
  const store = createSupabaseReviewStore()
  await startCaseReview(actor, store, params.caseId)

  const supabase = await createServerClient()
  const [caseRow, findings, documentsResult, escalationsResult, expertsResult] = await Promise.all([
    store.readCase(params.caseId),
    store.listFindings(params.caseId),
    supabase
      .from('documents')
      .select('id, doc_type, storage_path, mime_type, quality_status, quality_failure_reason')
      .eq('case_id', params.caseId)
      .order('doc_type', { ascending: true }),
    supabase
      .from('escalations')
      .select('id, finding_id, question_text, status, expert_response')
      .eq('case_id', params.caseId)
      .order('created_at', { ascending: false }),
    supabase.from('users').select('id, full_name, email').eq('role', 'expert').order('email'),
  ])
  if (!caseRow) throw new Error('Case not found after review start')
  if (documentsResult.error) throw new Error(documentsResult.error.message)
  if (escalationsResult.error) throw new Error(escalationsResult.error.message)
  if (expertsResult.error) throw new Error(expertsResult.error.message)

  const documents = documentsResult.data as DocumentRow[]
  const escalations = escalationsResult.data as EscalationRow[]
  const experts = expertsResult.data as ExpertRow[]
  const allFindingsReady = findings.every(reviewComplete)
  const hasOpenEscalations = escalations.some((escalation) => escalation.status === 'open')

  return (
    <main className="internal-page">
      <div className="internal-shell">
        <section className="mb-8 flex flex-col gap-5 border-b border-slate-200 pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-4xl">
            <p className="internal-eyebrow">Human approval workflow</p>
            <h1 className="internal-title">{caseRow.case_ref}</h1>
            <p className="mt-4 internal-copy">
              Review structured findings, approve only what is supportable, and keep the report gated until sign-off is complete.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <InternalBadge label={claimAmount(caseRow.claim_amount_inr)} tone="navy" />
            <InternalBadge
              label={caseRow.confidence_overall ?? 'low'}
              tone={confidenceTone(caseRow.confidence_overall)}
            />
            <InternalBadge label={formatLabel(caseRow.status)} tone={statusTone(caseRow.status)} />
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[0.88fr_1.12fr]">
          <section className="internal-surface p-6 sm:p-8">
            <div className="mb-6">
              <p className="internal-eyebrow">Document viewer</p>
              <h2 className="mt-3 text-2xl font-semibold text-navy-950">Case documents</h2>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                Review the document context without exposing raw OCR or internal processing output in the UI.
              </p>
            </div>
            <div className="mb-6 flex flex-wrap gap-2">
              {documents.map((document) => (
                <a
                  className="internal-badge"
                  href={`#doc-${document.id}`}
                  key={document.id}
                >
                  {formatLabel(document.doc_type)}
                </a>
              ))}
            </div>
            <div className="grid gap-6">
              {documents.map((document) => (
                <article
                  className="rounded-3xl border border-slate-200 bg-slate-50 p-5"
                  id={`doc-${document.id}`}
                  key={document.id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-semibold text-navy-950">{formatLabel(document.doc_type)}</h3>
                      <p className="mt-1 text-sm text-slate-500">{document.mime_type ?? 'document'}</p>
                    </div>
                    {document.quality_status ? (
                      <InternalBadge
                        label={formatLabel(document.quality_status)}
                        tone={document.quality_status === 'manual_required' ? 'attention' : 'teal'}
                      />
                    ) : null}
                  </div>
                  {document.quality_status === 'manual_required' ? (
                    <p className="mt-4 rounded-2xl border border-attention-500/25 bg-attention-50 px-4 py-3 text-sm text-attention-700">
                      {document.quality_failure_reason ?? 'Manual document review required'}
                    </p>
                  ) : null}
                  <object
                    className="mt-4 h-[520px] w-full rounded-2xl border border-slate-200 bg-white"
                    data={document.storage_path}
                    type={document.mime_type ?? 'application/pdf'}
                  >
                    <p className="p-4 text-sm text-slate-500">
                      Preview unavailable for this private storage object.
                    </p>
                  </object>
                </article>
              ))}
            </div>
          </section>

          <section className="grid gap-6">
            <div className="internal-surface p-6 sm:p-8">
              {panelTitle(
                'Escalate case-wide question',
                'Use this only when the reviewer needs expert input before proceeding.'
              )}
              <form action={escalateAction} className="grid gap-3">
                {hiddenCase(params.caseId)}
                <textarea
                  className="internal-textarea min-h-24"
                  name="question_text"
                  placeholder="Your specific question for the domain expert"
                  required
                />
                <select
                  className="internal-select"
                  name="expert_id"
                  defaultValue={caseRow.assigned_expert_id ?? ''}
                >
                  <option value="">Assigned expert</option>
                  {experts.map((expert) => (
                    <option key={expert.id} value={expert.id}>
                      {expert.full_name ?? expert.email}
                    </option>
                  ))}
                </select>
                <button className="internal-danger-button w-fit">
                  Escalate entire case to expert
                </button>
              </form>
            </div>

            <div className="internal-surface p-6 sm:p-8">
              {panelTitle('Findings', 'Confirm, edit, or mark findings unassessable before sign-off.')}
              <div className="grid gap-5">
                {findings.map((finding) => (
                  <article className="rounded-3xl border border-slate-200 bg-slate-50 p-5" key={finding.id}>
                    <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                      <div>
                        <p className="text-sm uppercase tracking-[0.18em] text-slate-500">
                          {formatLabel(finding.finding_type)}
                        </p>
                        <h4 className="mt-2 text-lg font-semibold text-navy-950">
                          {finding.bill_line_item ?? 'Finding'}
                        </h4>
                        <p className="mt-3 text-sm leading-7 text-slate-600">
                          {finding.plain_language_explanation}
                        </p>
                      </div>
                      <div className="space-y-2 text-left text-sm md:text-right">
                        <p className="font-semibold tabular-nums text-navy-950">
                          {paiseAmount(finding.bill_amount_inr)}
                        </p>
                        <div className="flex flex-wrap gap-2 md:justify-end">
                          <InternalBadge
                            label={finding.confidence_label}
                            tone={confidenceTone(finding.confidence_label)}
                          />
                          <InternalBadge
                            label={reviewComplete(finding) ? 'Confirmed' : 'Needs review'}
                            tone={reviewComplete(finding) ? 'covered' : 'attention'}
                          />
                        </div>
                      </div>
                    </div>
                    {finding.reviewer_unassessable ? (
                      <p className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                        Unassessable: {finding.reviewer_unassessable_reason}
                      </p>
                    ) : null}
                    <div className="mt-5 grid gap-3">
                      <form action={confirmFindingAction}>
                        {hiddenCase(params.caseId)}
                        <input name="finding_id" type="hidden" value={finding.id} />
                        <button className="internal-primary-button">Confirm</button>
                      </form>
                      <form action={editFindingAction} className="grid gap-2">
                        {hiddenCase(params.caseId)}
                        <input name="finding_id" type="hidden" value={finding.id} />
                        <textarea
                          className="internal-textarea min-h-24"
                          name="explanation"
                          defaultValue={finding.plain_language_explanation ?? ''}
                          required
                        />
                        <button className="internal-secondary-button w-fit">
                          Save explanation edit
                        </button>
                      </form>
                      <form action={unassessableFindingAction} className="grid gap-2">
                        {hiddenCase(params.caseId)}
                        <input name="finding_id" type="hidden" value={finding.id} />
                        <input
                          className="internal-input"
                          name="reason"
                          placeholder="Reason this finding is unassessable"
                          required
                        />
                        <button className="internal-secondary-button w-fit">
                          Mark unassessable
                        </button>
                      </form>
                      <form action={escalateAction} className="grid gap-2">
                        {hiddenCase(params.caseId)}
                        <input name="finding_id" type="hidden" value={finding.id} />
                        <textarea
                          className="internal-textarea min-h-24"
                          name="question_text"
                          placeholder="Your specific question for the domain expert"
                          required
                        />
                        <select
                          className="internal-select"
                          name="expert_id"
                          defaultValue={caseRow.assigned_expert_id ?? ''}
                        >
                          <option value="">Assigned expert</option>
                          {experts.map((expert) => (
                            <option key={expert.id} value={expert.id}>
                              {expert.full_name ?? expert.email}
                            </option>
                          ))}
                        </select>
                        <button className="internal-danger-button w-fit">Escalate finding</button>
                      </form>
                    </div>
                  </article>
                ))}
              </div>
            </div>

            <div className="internal-surface p-6 sm:p-8">
              {panelTitle('Questions review')}
              <div className="grid gap-4">
                <form action={draftSectionAction} className="grid gap-2">
                  {hiddenCase(params.caseId)}
                  <input name="section" type="hidden" value="hospital_questions" />
                  <label className="text-sm font-medium text-navy-800" htmlFor="hospital_questions">
                    Hospital questions
                  </label>
                  <textarea
                    className="internal-textarea min-h-32"
                    id="hospital_questions"
                    name="value"
                    defaultValue={draftArray(caseRow.ai_draft, 'hospital_questions').join('\n')}
                  />
                  <button className="internal-secondary-button w-fit">Save hospital questions</button>
                </form>
                <form action={draftSectionAction} className="grid gap-2">
                  {hiddenCase(params.caseId)}
                  <input name="section" type="hidden" value="insurer_questions" />
                  <label className="text-sm font-medium text-navy-800" htmlFor="insurer_questions">
                    Insurer questions
                  </label>
                  <textarea
                    className="internal-textarea min-h-32"
                    id="insurer_questions"
                    name="value"
                    defaultValue={draftArray(caseRow.ai_draft, 'insurer_questions').join('\n')}
                  />
                  <button className="internal-secondary-button w-fit">Save insurer questions</button>
                </form>
                <form action={missingDocumentAction} className="grid gap-2">
                  {hiddenCase(params.caseId)}
                  <input
                    className="internal-input"
                    name="request_text"
                    placeholder="Missing document request"
                    required
                  />
                  <button className="internal-secondary-button w-fit">Request missing document</button>
                </form>
              </div>
            </div>

            <div className="internal-surface p-6 sm:p-8">
              {panelTitle(
                'Appeal points',
                'Keep each point, strength, and basis reviewer-approved before sign-off.'
              )}
              <form action={draftSectionAction} className="grid gap-2">
                {hiddenCase(params.caseId)}
                <input name="section" type="hidden" value="appeal_points" />
                <textarea
                  className="internal-textarea min-h-56 font-mono text-sm"
                  name="value"
                  defaultValue={draftJson(caseRow.ai_draft, 'appeal_points')}
                />
                <button className="internal-secondary-button w-fit">Save appeal points</button>
              </form>
            </div>

            <div className="internal-surface p-6 sm:p-8">
              {panelTitle('Appeal letter')}
              <p className="rounded-2xl border border-attention-500/25 bg-attention-50 px-4 py-3 text-sm text-attention-700">
                Reviewer must confirm this letter before sign-off.
              </p>
              <form action={draftSectionAction} className="mt-4 grid gap-2">
                {hiddenCase(params.caseId)}
                <input name="section" type="hidden" value="appeal_letter_draft" />
                <textarea
                  className="internal-textarea min-h-64"
                  name="value"
                  defaultValue={draftString(caseRow.ai_draft, 'appeal_letter_draft')}
                />
                <button className="internal-secondary-button w-fit">Save appeal letter</button>
              </form>
              <form action={draftSectionAction} className="mt-3">
                {hiddenCase(params.caseId)}
                <input name="section" type="hidden" value="reviewer_letter_confirmed" />
                <input name="value" type="hidden" value="true" />
                <button className="internal-primary-button">Confirm letter</button>
              </form>
            </div>

            <div className="internal-surface p-6 sm:p-8">
              {panelTitle('Expert escalations')}
              <div className="grid gap-3">
                {escalations.length === 0 ? (
                  <p className="text-sm text-slate-500">No escalations.</p>
                ) : null}
                {escalations.map((escalation) => (
                  <article className="rounded-3xl border border-slate-200 bg-slate-50 p-4" key={escalation.id}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="font-medium text-navy-950">{escalation.question_text}</p>
                      <InternalBadge
                        label={formatLabel(escalation.status)}
                        tone={escalation.status === 'open' ? 'attention' : 'covered'}
                      />
                    </div>
                    {escalation.expert_response ? (
                      <p className="mt-3 text-sm leading-7 text-slate-600">{escalation.expert_response}</p>
                    ) : null}
                  </article>
                ))}
              </div>
            </div>

            <div className="internal-surface p-6 sm:p-8">
              {panelTitle(
                'Sign-off',
                'The server repeats every gate before approval and only queues report generation.'
              )}
              <ul className="grid gap-3 text-sm text-slate-600">
                <li className="flex items-center gap-3">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      allFindingsReady ? 'bg-covered-500' : 'bg-attention-500'
                    }`}
                  />
                  <span>
                    {allFindingsReady ? 'Ready' : 'Blocked'}: all findings confirmed or unassessable
                  </span>
                </li>
                <li className="flex items-center gap-3">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      hasOpenEscalations ? 'bg-deducted-500' : 'bg-covered-500'
                    }`}
                  />
                  <span>{hasOpenEscalations ? 'Blocked' : 'Ready'}: no open expert escalations</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-teal-500" />
                  <span>Ready: AI output remains internal until Module 8 delivery</span>
                </li>
              </ul>
              <form action={signOffAction} className="mt-5">
                {hiddenCase(params.caseId)}
                <button
                  className="internal-primary-button disabled:cursor-not-allowed disabled:bg-slate-400 disabled:text-slate-100"
                  disabled={!allFindingsReady || hasOpenEscalations}
                >
                  Sign off and generate report
                </button>
              </form>
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}
