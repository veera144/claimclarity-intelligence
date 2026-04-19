import type { ReactElement } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient, createServiceClient } from '@claimclarity/db'

type StatusPageProps = {
  params: {
    caseRef: string
  }
}

type CaseStatusRow = {
  id: string
  case_ref: string
  patient_id: string
  status:
    | 'consent_pending'
    | 'documents_pending'
    | 'payment_pending'
    | 'processing'
    | 'ai_draft_ready'
    | 'under_review'
    | 'escalated'
    | 'approved'
    | 'generating_report'
    | 'delivered'
    | 'closed'
  current_step:
    | 'quality_check'
    | 'ocr'
    | 'rules_engine'
    | 'ai_draft'
    | 'awaiting_review'
    | 'report_generation'
    | 'complete'
    | 'failed'
    | null
  insurer_name: string | null
  claim_amount_inr: number | null
  created_at: string | null
}

type DocumentStatusRow = {
  id: string
  doc_type: string
  is_required: boolean | null
  quality_status: 'pending' | 'pass' | 'fail' | 'manual_required' | null
  quality_failure_reason: string | null
  ocr_status: 'pending' | 'running' | 'completed' | 'failed' | null
  uploaded_at: string | null
}

type ReportStatusRow = {
  signed_off_at: string | null
  delivered_at: string | null
}

type OutcomeStatusRow = {
  outcome_type: string | null
  patient_action_type: string | null
}

function titleCase(value: string): string {
  return value
    .split('_')
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function formatDate(value: string | null): string {
  if (!value) return 'Not yet'
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value))
}

function formatWholeRupees(value: number | null): string {
  return typeof value === 'number' ? `Rs ${value.toLocaleString('en-IN')}` : 'Not captured'
}

function stageCopy(caseRow: CaseStatusRow): { title: string; body: string; tone: string } {
  if (caseRow.status === 'documents_pending') {
    return {
      title: 'Documents are needed',
      body: 'Upload the required documents so quality checks can run.',
      tone: 'border-attention-500',
    }
  }

  if (caseRow.status === 'payment_pending') {
    return {
      title: 'Payment is the next step',
      body: 'Your required documents passed the first checks. Payment starts processing.',
      tone: 'border-teal-500',
    }
  }

  if (caseRow.status === 'processing') {
    return {
      title: 'Your case is being processed',
      body: 'Structured extraction and rules checks are running. We will keep the report gated for review.',
      tone: 'border-teal-500',
    }
  }

  if (caseRow.status === 'ai_draft_ready' || caseRow.status === 'under_review') {
    return {
      title: 'Reviewer check is in progress',
      body: 'A reviewer checks the findings and draft before anything is delivered to you.',
      tone: 'border-navy-500',
    }
  }

  if (caseRow.status === 'escalated') {
    return {
      title: 'Expert input is being collected',
      body: 'The team is checking a point that needs extra review.',
      tone: 'border-attention-500',
    }
  }

  if (caseRow.status === 'approved' || caseRow.status === 'generating_report') {
    return {
      title: 'Report preparation is underway',
      body: 'Your report has reviewer sign-off and is being prepared for secure delivery.',
      tone: 'border-teal-500',
    }
  }

  if (caseRow.status === 'delivered') {
    return {
      title: 'Your report is ready',
      body: 'Open the report after login. The download link is created only when you request it.',
      tone: 'border-covered-500',
    }
  }

  if (caseRow.status === 'closed') {
    return {
      title: 'This case is closed',
      body: 'The case is no longer being processed.',
      tone: 'border-slate-400',
    }
  }

  return {
    title: 'Case started',
    body: 'Complete consent and upload steps to continue.',
    tone: 'border-teal-500',
  }
}

function qualityCopy(document: DocumentStatusRow): { label: string; dot: string; text: string } {
  if (document.quality_status === 'pass') {
    return { label: 'Quality passed', dot: 'bg-covered-500', text: 'Readable for processing.' }
  }

  if (document.quality_status === 'manual_required') {
    return {
      label: 'Manual review',
      dot: 'bg-attention-500',
      text: 'The team will complete structured extraction if allowed.',
    }
  }

  if (document.quality_status === 'fail') {
    return {
      label: 'Needs replacement',
      dot: 'bg-deducted-500',
      text: document.quality_failure_reason ?? 'Please upload a clearer document.',
    }
  }

  return { label: 'Quality pending', dot: 'bg-teal-500', text: 'Waiting for quality check.' }
}

function ocrCopy(document: DocumentStatusRow): { label: string; dot: string } {
  if (document.ocr_status === 'completed') {
    return { label: 'Extraction complete', dot: 'bg-covered-500' }
  }

  if (document.ocr_status === 'running') {
    return { label: 'Extraction running', dot: 'bg-teal-500' }
  }

  if (document.ocr_status === 'failed') {
    return { label: 'Extraction needs help', dot: 'bg-attention-500' }
  }

  return { label: 'Extraction pending', dot: 'bg-slate-400' }
}

function actionLinks(input: {
  caseRow: CaseStatusRow
  report: ReportStatusRow | null
}): ReactElement {
  const caseRef = encodeURIComponent(input.caseRow.case_ref)
  const uploadHref = `/app/upload?caseId=${encodeURIComponent(input.caseRow.id)}`

  if (input.caseRow.status === 'documents_pending') {
    return (
      <Link className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white" href={uploadHref}>
        Resume upload
      </Link>
    )
  }

  if (input.caseRow.status === 'payment_pending') {
    return (
      <Link className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white" href={`/app/cases/${caseRef}/pay`}>
        Continue to payment
      </Link>
    )
  }

  if (input.caseRow.status === 'delivered' && input.report?.delivered_at) {
    return (
      <div className="flex flex-wrap gap-3">
        <Link className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white" href={`/app/cases/${caseRef}/report`}>
          Open report
        </Link>
        <Link className="rounded-lg border border-navy-300 px-4 py-2 text-sm font-semibold text-navy-800" href={`/app/outcomes/${caseRef}`}>
          Share outcome
        </Link>
      </div>
    )
  }

  return (
    <Link className="rounded-lg border border-navy-300 px-4 py-2 text-sm font-semibold text-navy-800" href="/app/dashboard">
      Back to cases
    </Link>
  )
}

export default async function PatientCaseStatusPage(
  props: StatusPageProps
): Promise<ReactElement> {
  const sessionClient = await createServerClient()
  const {
    data: { user },
  } = await sessionClient.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const caseRef = decodeURIComponent(props.params.caseRef)
  const serviceClient = createServiceClient()
  const { data: caseRow, error: caseError } = await serviceClient
    .from('cases')
    .select(
      'id, case_ref, patient_id, status, current_step, insurer_name, claim_amount_inr, created_at'
    )
    .eq('case_ref', caseRef)
    .maybeSingle()

  if (caseError || !caseRow || caseRow.patient_id !== user.id) {
    redirect('/app/dashboard')
  }

  const [documentsResult, reportResult, outcomeResult] = await Promise.all([
    serviceClient
      .from('documents')
      .select(
        'id, doc_type, is_required, quality_status, quality_failure_reason, ocr_status, uploaded_at'
      )
      .eq('case_id', caseRow.id)
      .order('uploaded_at', { ascending: true }),
    serviceClient
      .from('reports')
      .select('signed_off_at, delivered_at')
      .eq('case_id', caseRow.id)
      .maybeSingle(),
    serviceClient
      .from('outcomes')
      .select('outcome_type, patient_action_type')
      .eq('case_id', caseRow.id)
      .maybeSingle(),
  ])

  if (documentsResult.error) throw new Error(documentsResult.error.message)
  if (reportResult.error) throw new Error(reportResult.error.message)
  if (outcomeResult.error) throw new Error(outcomeResult.error.message)

  const documents = documentsResult.data as DocumentStatusRow[]
  const report = reportResult.data as ReportStatusRow | null
  const outcome = outcomeResult.data as OutcomeStatusRow | null
  const stage = stageCopy(caseRow as CaseStatusRow)

  return (
    <main className="min-h-screen bg-navy-50 px-4 py-10 font-['IBM_Plex_Sans',Arial,sans-serif] text-navy-950">
      <div className="mx-auto max-w-5xl">
        <div className={`border-l-4 bg-white p-6 shadow-sm ${stage.tone}`}>
          <p className="text-sm font-semibold uppercase text-teal-700">Case status</p>
          <div className="mt-3 grid gap-5 md:grid-cols-[1fr_auto]">
            <div>
              <h1 className="text-3xl font-semibold">{caseRow.case_ref}</h1>
              <p className="mt-3 max-w-2xl text-navy-700">{stage.body}</p>
            </div>
            <div className="flex items-start">{actionLinks({ caseRow: caseRow as CaseStatusRow, report })}</div>
          </div>
        </div>

        <section className="mt-6 grid gap-4 md:grid-cols-4">
          <div className="bg-white p-4">
            <p className="text-sm font-medium text-navy-500">Current state</p>
            <p className="mt-2 font-semibold">{stage.title}</p>
          </div>
          <div className="bg-white p-4">
            <p className="text-sm font-medium text-navy-500">Current step</p>
            <p className="mt-2 font-semibold">
              {caseRow.current_step ? titleCase(caseRow.current_step) : 'Not started'}
            </p>
          </div>
          <div className="bg-white p-4">
            <p className="text-sm font-medium text-navy-500">Claim amount</p>
            <p className="mt-2 font-semibold tabular-nums">
              {formatWholeRupees(caseRow.claim_amount_inr)}
            </p>
          </div>
          <div className="bg-white p-4">
            <p className="text-sm font-medium text-navy-500">Started</p>
            <p className="mt-2 font-semibold">{formatDate(caseRow.created_at)}</p>
          </div>
        </section>

        <section className="mt-8 border-t border-navy-200 pt-6">
          <h2 className="text-xl font-semibold">Documents</h2>
          <div className="mt-4 grid gap-4">
            {documents.length === 0 ? (
              <div className="border-l-4 border-attention-500 bg-white p-5">
                <p className="font-semibold">No documents uploaded yet</p>
                <p className="mt-2 text-sm text-navy-700">
                  Upload the required policy, hospital bill, and insurer response documents.
                </p>
              </div>
            ) : null}
            {documents.map((document) => {
              const quality = qualityCopy(document)
              const ocr = ocrCopy(document)
              return (
                <article className="border-l-4 border-teal-500 bg-white p-5" key={document.id}>
                  <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                    <div>
                      <h3 className="font-semibold">
                        {titleCase(document.doc_type)}
                        {document.is_required ? ' (required)' : ''}
                      </h3>
                      <p className="mt-2 text-sm text-navy-700">{quality.text}</p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-sm">
                      <span className="inline-flex items-center gap-2 rounded-lg border border-navy-200 px-2 py-1">
                        <span className={`h-2 w-2 rounded-full ${quality.dot}`} />
                        {quality.label}
                      </span>
                      <span className="inline-flex items-center gap-2 rounded-lg border border-navy-200 px-2 py-1">
                        <span className={`h-2 w-2 rounded-full ${ocr.dot}`} />
                        {ocr.label}
                      </span>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <section className="mt-8 grid gap-4 border-t border-navy-200 pt-6 md:grid-cols-3">
          <div className="border-l-4 border-teal-500 bg-white p-5">
            <h2 className="font-semibold">Payment</h2>
            <p className="mt-2 text-sm text-navy-700">
              {caseRow.status === 'payment_pending'
                ? 'Payment is ready when you are.'
                : 'Payment is either not due yet, complete, or waived for this case.'}
            </p>
          </div>
          <div className="border-l-4 border-navy-500 bg-white p-5">
            <h2 className="font-semibold">Report</h2>
            <p className="mt-2 text-sm text-navy-700">
              {report?.delivered_at
                ? `Delivered on ${formatDate(report.delivered_at)}.`
                : report?.signed_off_at
                  ? 'Reviewer sign-off is complete. Report delivery is next.'
                  : 'Reviewer sign-off is required before report delivery.'}
            </p>
          </div>
          <div className="border-l-4 border-covered-500 bg-white p-5">
            <h2 className="font-semibold">Outcome</h2>
            <p className="mt-2 text-sm text-navy-700">
              {outcome?.outcome_type && outcome.outcome_type !== 'pending'
                ? `Outcome recorded: ${titleCase(outcome.outcome_type)}.`
                : 'Outcome sharing opens after your report is delivered.'}
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}
