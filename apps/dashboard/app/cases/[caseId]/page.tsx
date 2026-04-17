import type { ReactElement } from 'react'
import { createServerClient, type Json } from '@claimclarity/db'

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
  return typeof value === 'number' ? `₹${value.toLocaleString('en-IN')}` : 'Not captured'
}

function paiseAmount(value: number | null): string {
  return typeof value === 'number' ? `₹${(value / 100).toLocaleString('en-IN')}` : 'Not captured'
}

function confidenceClass(value: string | null): string {
  if (value === 'high' || value === 'clause_found_matched') return 'bg-emerald-200 text-emerald-950'
  if (value === 'mixed' || value === 'based_on_typical_policy') return 'bg-amber-200 text-amber-950'
  return 'bg-red-200 text-red-950'
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
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="grid min-h-screen lg:grid-cols-2">
        <section className="border-r border-neutral-800 p-6">
          <p className="text-sm uppercase text-emerald-300">Document viewer</p>
          <h1 className="mt-3 text-2xl font-semibold">{caseRow.case_ref}</h1>
          <div className="mt-6 flex flex-wrap gap-2">
            {documents.map((document) => (
              <a
                className="rounded border border-neutral-700 px-3 py-2 text-sm text-neutral-200"
                href={`#doc-${document.id}`}
                key={document.id}
              >
                {document.doc_type}
              </a>
            ))}
          </div>
          <div className="mt-6 grid gap-6">
            {documents.map((document) => (
              <article className="border-b border-neutral-800 pb-6" id={`doc-${document.id}`} key={document.id}>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold">{document.doc_type}</h2>
                  <span className="rounded bg-neutral-800 px-2 py-1 text-xs">{document.mime_type ?? 'document'}</span>
                </div>
                {document.quality_status === 'manual_required' ? (
                  <p className="mt-3 rounded bg-amber-200 px-3 py-2 text-sm text-amber-950">
                    {document.quality_failure_reason ?? 'Manual document review required'}
                  </p>
                ) : null}
                <object
                  className="mt-4 h-[520px] w-full border border-neutral-800 bg-neutral-900"
                  data={document.storage_path}
                  type={document.mime_type ?? 'application/pdf'}
                >
                  <p className="p-4 text-sm text-neutral-300">Preview unavailable for this private storage object.</p>
                </object>
              </article>
            ))}
          </div>
        </section>

        <section className="max-h-screen overflow-y-auto p-6">
          <div className="border-b border-neutral-800 pb-6">
            <p className="text-sm uppercase text-emerald-300">Human approval workflow</p>
            <h2 className="mt-3 text-2xl font-semibold">{caseRow.insurer_name ?? 'Unknown insurer'}</h2>
            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              <span>{claimAmount(caseRow.claim_amount_inr)}</span>
              <span className={`rounded px-2 py-1 ${confidenceClass(caseRow.confidence_overall)}`}>
                {caseRow.confidence_overall ?? 'low'}
              </span>
              <span className="rounded bg-neutral-800 px-2 py-1">{caseRow.status}</span>
            </div>
            <form action={escalateAction} className="mt-5 grid gap-3">
              {hiddenCase(params.caseId)}
              <textarea
                className="min-h-20 rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
                name="question_text"
                placeholder="Your specific question for the domain expert"
                required
              />
              <select className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2" name="expert_id" defaultValue={caseRow.assigned_expert_id ?? ''}>
                <option value="">Assigned expert</option>
                {experts.map((expert) => (
                  <option key={expert.id} value={expert.id}>
                    {expert.full_name ?? expert.email}
                  </option>
                ))}
              </select>
              <button className="w-fit rounded bg-red-200 px-4 py-2 text-sm font-semibold text-red-950">
                Escalate entire case to expert
              </button>
            </form>
          </div>

          <section className="border-b border-neutral-800 py-6">
            <h3 className="text-xl font-semibold">Findings</h3>
            <div className="mt-4 grid gap-5">
              {findings.map((finding) => (
                <article className="border border-neutral-800 p-4" key={finding.id}>
                  <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                    <div>
                      <p className="text-sm uppercase text-neutral-400">{finding.finding_type}</p>
                      <h4 className="mt-1 font-semibold">{finding.bill_line_item ?? 'Finding'}</h4>
                      <p className="mt-2 text-sm text-neutral-300">{finding.plain_language_explanation}</p>
                    </div>
                    <div className="space-y-2 text-right text-sm">
                      <p>{paiseAmount(finding.bill_amount_inr)}</p>
                      <span className={`rounded px-2 py-1 ${confidenceClass(finding.confidence_label)}`}>
                        {finding.confidence_label}
                      </span>
                      <p>{reviewComplete(finding) ? 'Confirmed' : 'Needs review'}</p>
                    </div>
                  </div>
                  {finding.reviewer_unassessable ? (
                    <p className="mt-3 rounded bg-neutral-800 px-3 py-2 text-sm text-neutral-200">
                      Unassessable: {finding.reviewer_unassessable_reason}
                    </p>
                  ) : null}
                  <div className="mt-4 grid gap-3">
                    <form action={confirmFindingAction}>
                      {hiddenCase(params.caseId)}
                      <input name="finding_id" type="hidden" value={finding.id} />
                      <button className="rounded bg-emerald-200 px-3 py-2 text-sm font-semibold text-emerald-950">
                        Confirm
                      </button>
                    </form>
                    <form action={editFindingAction} className="grid gap-2">
                      {hiddenCase(params.caseId)}
                      <input name="finding_id" type="hidden" value={finding.id} />
                      <textarea className="min-h-20 rounded border border-neutral-700 bg-neutral-900 px-3 py-2" name="explanation" defaultValue={finding.plain_language_explanation ?? ''} required />
                      <button className="w-fit rounded border border-neutral-500 px-3 py-2 text-sm">
                        Save explanation edit
                      </button>
                    </form>
                    <form action={unassessableFindingAction} className="grid gap-2">
                      {hiddenCase(params.caseId)}
                      <input name="finding_id" type="hidden" value={finding.id} />
                      <input className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2" name="reason" placeholder="Reason this finding is unassessable" required />
                      <button className="w-fit rounded border border-amber-400 px-3 py-2 text-sm text-amber-200">
                        Mark unassessable
                      </button>
                    </form>
                    <form action={escalateAction} className="grid gap-2">
                      {hiddenCase(params.caseId)}
                      <input name="finding_id" type="hidden" value={finding.id} />
                      <textarea className="min-h-20 rounded border border-neutral-700 bg-neutral-900 px-3 py-2" name="question_text" placeholder="Your specific question for the domain expert" required />
                      <select className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2" name="expert_id" defaultValue={caseRow.assigned_expert_id ?? ''}>
                        <option value="">Assigned expert</option>
                        {experts.map((expert) => (
                          <option key={expert.id} value={expert.id}>
                            {expert.full_name ?? expert.email}
                          </option>
                        ))}
                      </select>
                      <button className="w-fit rounded border border-red-400 px-3 py-2 text-sm text-red-200">
                        Escalate finding
                      </button>
                    </form>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="border-b border-neutral-800 py-6">
            <h3 className="text-xl font-semibold">Questions review</h3>
            <div className="mt-4 grid gap-4">
              <form action={draftSectionAction} className="grid gap-2">
                {hiddenCase(params.caseId)}
                <input name="section" type="hidden" value="hospital_questions" />
                <label className="text-sm text-neutral-300" htmlFor="hospital_questions">
                  Hospital questions
                </label>
                <textarea
                  className="min-h-32 rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
                  id="hospital_questions"
                  name="value"
                  defaultValue={draftArray(caseRow.ai_draft, 'hospital_questions').join('\n')}
                />
                <button className="w-fit rounded border border-neutral-500 px-3 py-2 text-sm">
                  Save hospital questions
                </button>
              </form>
              <form action={draftSectionAction} className="grid gap-2">
                {hiddenCase(params.caseId)}
                <input name="section" type="hidden" value="insurer_questions" />
                <label className="text-sm text-neutral-300" htmlFor="insurer_questions">
                  Insurer questions
                </label>
                <textarea
                  className="min-h-32 rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
                  id="insurer_questions"
                  name="value"
                  defaultValue={draftArray(caseRow.ai_draft, 'insurer_questions').join('\n')}
                />
                <button className="w-fit rounded border border-neutral-500 px-3 py-2 text-sm">
                  Save insurer questions
                </button>
              </form>
              <form action={missingDocumentAction} className="grid gap-2">
                {hiddenCase(params.caseId)}
                <input className="rounded border border-neutral-700 bg-neutral-900 px-3 py-2" name="request_text" placeholder="Missing document request" required />
                <button className="w-fit rounded border border-amber-400 px-3 py-2 text-sm text-amber-200">
                  Request missing document
                </button>
              </form>
            </div>
          </section>

          <section className="border-b border-neutral-800 py-6">
            <h3 className="text-xl font-semibold">Appeal points</h3>
            <p className="mt-2 text-sm text-neutral-300">
              Keep each point, strength, and basis reviewer-approved before sign-off.
            </p>
            <form action={draftSectionAction} className="mt-4 grid gap-2">
              {hiddenCase(params.caseId)}
              <input name="section" type="hidden" value="appeal_points" />
              <textarea
                className="min-h-56 rounded border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-sm"
                name="value"
                defaultValue={draftJson(caseRow.ai_draft, 'appeal_points')}
              />
              <button className="w-fit rounded border border-neutral-500 px-3 py-2 text-sm">
                Save appeal points
              </button>
            </form>
          </section>

          <section className="border-b border-neutral-800 py-6">
            <h3 className="text-xl font-semibold">Appeal letter</h3>
            <p className="mt-2 rounded bg-amber-200 px-3 py-2 text-sm text-amber-950">
              Reviewer must confirm this letter before sign-off.
            </p>
            <form action={draftSectionAction} className="mt-4 grid gap-2">
              {hiddenCase(params.caseId)}
              <input name="section" type="hidden" value="appeal_letter_draft" />
              <textarea
                className="min-h-64 rounded border border-neutral-700 bg-neutral-900 px-3 py-2"
                name="value"
                defaultValue={draftString(caseRow.ai_draft, 'appeal_letter_draft')}
              />
              <button className="w-fit rounded border border-neutral-500 px-3 py-2 text-sm">
                Save appeal letter
              </button>
            </form>
            <form action={draftSectionAction} className="mt-3">
              {hiddenCase(params.caseId)}
              <input name="section" type="hidden" value="reviewer_letter_confirmed" />
              <input name="value" type="hidden" value="true" />
              <button className="rounded bg-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-950">
                Confirm letter
              </button>
            </form>
          </section>

          <section className="border-b border-neutral-800 py-6">
            <h3 className="text-xl font-semibold">Expert escalations</h3>
            <div className="mt-4 grid gap-3">
              {escalations.length === 0 ? <p className="text-sm text-neutral-400">No escalations.</p> : null}
              {escalations.map((escalation) => (
                <article className="border border-neutral-800 p-3" key={escalation.id}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">{escalation.question_text}</p>
                    <span className="rounded bg-neutral-800 px-2 py-1 text-xs">{escalation.status}</span>
                  </div>
                  {escalation.expert_response ? (
                    <p className="mt-2 text-sm text-neutral-300">{escalation.expert_response}</p>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          <section className="py-6">
            <h3 className="text-xl font-semibold">Sign-off</h3>
            <p className="mt-2 text-sm text-neutral-300">
              The server repeats every gate before approval and only queues report generation.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-neutral-300">
              <li>{allFindingsReady ? 'Ready' : 'Blocked'}: all findings confirmed or unassessable</li>
              <li>{hasOpenEscalations ? 'Blocked' : 'Ready'}: no open expert escalations</li>
              <li>Ready: AI output remains internal until Module 8 delivery</li>
            </ul>
            <form action={signOffAction} className="mt-5">
              {hiddenCase(params.caseId)}
              <button
                className="rounded bg-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-950 disabled:cursor-not-allowed disabled:bg-neutral-700 disabled:text-neutral-300"
                disabled={!allFindingsReady || hasOpenEscalations}
              >
                Sign off and generate report
              </button>
            </form>
          </section>
        </section>
      </div>
    </main>
  )
}
