'use client'

import type { ChangeEvent, ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import {
  type UploadDocType,
  validateUploadFile,
} from '../../../lib/validation/document.schemas'

type RequiredSlotId = 'coverage' | 'hospital_bill' | 'insurer_response'

type PatientCase = {
  id: string
  case_ref: string
  status:
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
    | 'consent_pending'
  current_step: string | null
  insurer_name: string | null
  claim_amount_inr: number | null
  created_at: string | null
}

type DocumentStatus = {
  id: string
  doc_type: string
  quality_status: 'pending' | 'pass' | 'fail' | 'manual_required' | null
  quality_failure_reason: string | null
}

type SlotState = {
  status: 'empty' | 'uploading' | 'checking' | 'passed' | 'failed'
  documentId: string | null
  error: string | null
}

const REQUIRED_SLOTS: Array<{
  id: RequiredSlotId
  title: string
  body: string
  fixedDocType?: UploadDocType
}> = [
  {
    id: 'coverage',
    title: 'Policy document or Certificate of Insurance',
    body: 'Upload the coverage document your insurer shared with you.',
  },
  {
    id: 'hospital_bill',
    title: 'Hospital bill',
    body: 'Use the itemized bill that lists charges line by line.',
    fixedDocType: 'hospital_bill',
  },
  {
    id: 'insurer_response',
    title: 'Insurer or TPA response letter',
    body: 'Upload the letter explaining the approval, deduction, or rejection.',
    fixedDocType: 'insurer_response',
  },
]

const ADDITIONAL_DOC_TYPES: Array<{ value: UploadDocType; label: string }> = [
  { value: 'discharge_summary', label: 'Discharge summary' },
  { value: 'preauth_letter', label: 'Preauth letter' },
  { value: 'investigation_report', label: 'Investigation report' },
  { value: 'prescription', label: 'Prescription' },
  { value: 'prior_policy', label: 'Prior policy' },
  { value: 'payment_receipt', label: 'Payment receipt' },
  { value: 'prior_correspondence', label: 'Prior correspondence' },
  { value: 'other', label: 'Other document' },
]

const INITIAL_SLOT_STATE: Record<RequiredSlotId, SlotState> = {
  coverage: { status: 'empty', documentId: null, error: null },
  hospital_bill: { status: 'empty', documentId: null, error: null },
  insurer_response: { status: 'empty', documentId: null, error: null },
}

function slotStatusFromDocument(document: DocumentStatus | undefined): SlotState | null {
  if (!document) {
    return null
  }

  if (document.quality_status === 'pass') {
    return { status: 'passed', documentId: document.id, error: null }
  }

  if (document.quality_status === 'fail' || document.quality_status === 'manual_required') {
    return {
      status: 'failed',
      documentId: document.id,
      error: document.quality_failure_reason ?? 'This document needs attention.',
    }
  }

  return { status: 'checking', documentId: document.id, error: null }
}

function statusCopy(state: SlotState): string {
  if (state.status === 'uploading') return 'Uploading'
  if (state.status === 'checking') return 'Checking'
  if (state.status === 'passed') return 'Quality passed'
  if (state.status === 'failed') return state.error ?? 'Needs attention'
  return 'Not uploaded'
}

function canUpload(caseRow: PatientCase | null): boolean {
  return caseRow?.status === 'documents_pending' || caseRow?.status === 'payment_pending'
}

function isResumable(caseRow: PatientCase): boolean {
  return caseRow.status === 'documents_pending' || caseRow.status === 'payment_pending'
}

export function UploadWorkspace(): ReactElement {
  const router = useRouter()
  const searchParams = useSearchParams()
  const requestedCaseId = searchParams.get('caseId')
  const [cases, setCases] = useState<PatientCase[]>([])
  const [activeCase, setActiveCase] = useState<PatientCase | null>(null)
  const [coverageDocType, setCoverageDocType] = useState<UploadDocType>('policy')
  const [additionalDocType, setAdditionalDocType] = useState<UploadDocType>('discharge_summary')
  const [additionalOpen, setAdditionalOpen] = useState(false)
  const [slots, setSlots] = useState<Record<RequiredSlotId, SlotState>>(INITIAL_SLOT_STATE)
  const [additionalMessage, setAdditionalMessage] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const allRequiredPassed = REQUIRED_SLOTS.every((slot) => slots[slot.id].status === 'passed')
  const resumableCases = cases.filter(isResumable)

  const refreshActiveCase = useCallback(async (caseId: string): Promise<void> => {
    const response = await fetch(`/api/cases?caseId=${encodeURIComponent(caseId)}`)
    if (!response.ok) {
      return
    }

    const payload = (await response.json()) as { case?: PatientCase | null }
    setActiveCase(payload.case ?? null)
  }, [])

  const pollDocuments = useCallback(
    async (activeCaseId: string): Promise<void> => {
      const response = await fetch(`/api/cases/${activeCaseId}/documents`)
      if (!response.ok) {
        return
      }

      const payload = (await response.json()) as { documents?: DocumentStatus[] }
      const documents = payload.documents ?? []
      const coverageDocument = documents.find(
        (document) => document.doc_type === 'policy' || document.doc_type === 'cis'
      )
      const hospitalBillDocument = documents.find(
        (document) => document.doc_type === 'hospital_bill'
      )
      const insurerResponseDocument = documents.find(
        (document) => document.doc_type === 'insurer_response'
      )

      setSlots((previous) => ({
        coverage: slotStatusFromDocument(coverageDocument) ?? previous.coverage,
        hospital_bill: slotStatusFromDocument(hospitalBillDocument) ?? previous.hospital_bill,
        insurer_response:
          slotStatusFromDocument(insurerResponseDocument) ?? previous.insurer_response,
      }))
      await refreshActiveCase(activeCaseId)
    },
    [refreshActiveCase]
  )

  useEffect(() => {
    void (async () => {
      const response = await fetch('/api/cases')
      if (!response.ok) {
        setPageError('We could not load your cases. Please sign in again and try later.')
        return
      }

      const payload = (await response.json()) as { cases?: PatientCase[] }
      const nextCases = payload.cases ?? []
      setCases(nextCases)
      const selected = requestedCaseId
        ? nextCases.find((caseRow) => caseRow.id === requestedCaseId) ?? null
        : null
      setActiveCase(selected)
      setSlots(INITIAL_SLOT_STATE)
      if (selected) {
        await pollDocuments(selected.id)
      }
    })()
  }, [pollDocuments, requestedCaseId])

  useEffect(() => {
    if (!activeCase) {
      return undefined
    }

    const hasPendingDocument = Object.values(slots).some((slot) => slot.status === 'checking')
    if (!hasPendingDocument) {
      return undefined
    }

    const interval = window.setInterval(() => {
      void pollDocuments(activeCase.id)
    }, 3000)

    return () => {
      window.clearInterval(interval)
    }
  }, [activeCase, pollDocuments, slots])

  const caseLabel = useMemo(() => activeCase?.case_ref ?? 'No case selected', [activeCase])

  function startNewCase(): void {
    setPageError(null)
    startTransition(() => {
      void (async () => {
        const response = await fetch('/api/cases', { method: 'POST' })
        if (!response.ok) {
          setPageError('We could not start a new case. Please check consent and try again.')
          return
        }

        const payload = (await response.json()) as { caseId: string; caseRef: string }
        const nextCase: PatientCase = {
          id: payload.caseId,
          case_ref: payload.caseRef,
          status: 'documents_pending',
          current_step: null,
          insurer_name: null,
          claim_amount_inr: null,
          created_at: new Date().toISOString(),
        }
        setCases((previous) => [nextCase, ...previous])
        setActiveCase(nextCase)
        setSlots(INITIAL_SLOT_STATE)
        router.replace(`/app/upload?caseId=${encodeURIComponent(payload.caseId)}`)
      })()
    })
  }

  function chooseCase(caseRow: PatientCase): void {
    setActiveCase(caseRow)
    setSlots(INITIAL_SLOT_STATE)
    router.replace(`/app/upload?caseId=${encodeURIComponent(caseRow.id)}`)
  }

  function uploadFile(input: {
    file: File
    docType: UploadDocType
    slotId?: RequiredSlotId
  }): void {
    if (!activeCase) {
      setPageError('Choose a case or start a new one before uploading documents.')
      return
    }

    if (!canUpload(activeCase)) {
      setPageError('This case is past the upload step. Use the status page for next actions.')
      return
    }

    const validationError = validateUploadFile(input.file)
    if (validationError) {
      const slotId = input.slotId
      if (slotId) {
        setSlots((previous) => ({
          ...previous,
          [slotId]: { ...previous[slotId], status: 'failed', error: validationError },
        }))
      } else {
        setAdditionalMessage(validationError)
      }
      return
    }

    const pendingSlotId = input.slotId
    if (pendingSlotId) {
      setSlots((previous) => ({
        ...previous,
        [pendingSlotId]: { ...previous[pendingSlotId], status: 'uploading', error: null },
      }))
    } else {
      setAdditionalMessage('Uploading')
    }

    startTransition(() => {
      void (async () => {
        const formData = new FormData()
        formData.append('file', input.file)
        formData.append('docType', input.docType)

        const response = await fetch(`/api/cases/${activeCase.id}/documents`, {
          method: 'POST',
          body: formData,
        })

        if (!response.ok) {
          const errorPayload = (await response.json().catch(() => null)) as { error?: string } | null
          const error = errorPayload?.error ?? 'Upload failed. Please try again.'
          const slotId = input.slotId
          if (slotId) {
            setSlots((previous) => ({
              ...previous,
              [slotId]: { ...previous[slotId], status: 'failed', error },
            }))
          } else {
            setAdditionalMessage(error)
          }
          return
        }

        const payload = (await response.json()) as { documentId: string }
        const slotId = input.slotId
        if (slotId) {
          setSlots((previous) => ({
            ...previous,
            [slotId]: {
              status: 'checking',
              documentId: payload.documentId,
              error: null,
            },
          }))
        } else {
          setAdditionalMessage('Checking')
        }
      })()
    })
  }

  function handleRequiredFile(slotId: RequiredSlotId, event: ChangeEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.[0]
    if (!file) {
      return
    }

    const slot = REQUIRED_SLOTS.find((candidate) => candidate.id === slotId)
    const docType = slot?.fixedDocType ?? coverageDocType
    uploadFile({ file, docType, slotId })
    event.currentTarget.value = ''
  }

  function handleAdditionalFile(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.[0]
    if (!file) {
      return
    }

    uploadFile({ file, docType: additionalDocType })
    event.currentTarget.value = ''
  }

  function continueFromUpload(): void {
    if (!activeCase) return
    if (activeCase.status === 'payment_pending') {
      router.push(`/app/cases/${encodeURIComponent(activeCase.case_ref)}/pay`)
      return
    }
    router.push(`/app/cases/${encodeURIComponent(activeCase.case_ref)}/status`)
  }

  return (
    <main className="min-h-screen bg-navy-50 px-4 py-10 font-['IBM_Plex_Sans',Arial,sans-serif] text-navy-950">
      <div className="mx-auto max-w-4xl">
        <p className="text-sm font-semibold uppercase text-teal-700">ClaimClarity</p>
        <h1 className="mt-3 text-3xl font-semibold">Upload claim documents</h1>
        <p className="mt-3 max-w-2xl text-navy-700">
          Case {caseLabel}. Start a new case only when you are ready, or resume an existing upload.
        </p>
        {pageError ? (
          <p className="mt-4 border-l-4 border-deducted-500 bg-white p-3 text-sm text-deducted-700">
            {pageError}
          </p>
        ) : null}

        {!activeCase ? (
          <section className="mt-8 grid gap-4 border-t border-navy-200 pt-6">
            <div className="border-l-4 border-teal-500 bg-white p-5">
              <h2 className="font-semibold">Choose a case</h2>
              <p className="mt-2 text-sm text-navy-700">
                Uploads are attached to one case. No case is created until you choose to start one.
              </p>
              <button
                className="mt-4 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
                disabled={isPending}
                onClick={startNewCase}
                type="button"
              >
                {isPending ? 'Starting case...' : 'Start new case'}
              </button>
            </div>
            {resumableCases.map((caseRow) => (
              <button
                className="border-l-4 border-attention-500 bg-white p-5 text-left shadow-sm"
                key={caseRow.id}
                onClick={() => {
                  chooseCase(caseRow)
                }}
                type="button"
              >
                <span className="block font-semibold">{caseRow.case_ref}</span>
                <span className="mt-2 block text-sm text-navy-700">
                  {caseRow.status === 'payment_pending'
                    ? 'Documents are ready for payment.'
                    : 'Document upload is still open.'}
                </span>
              </button>
            ))}
            <Link className="text-sm font-semibold text-teal-700" href="/app/dashboard">
              Back to your cases
            </Link>
          </section>
        ) : null}

        {activeCase ? (
          <>
            {!canUpload(activeCase) ? (
              <section className="mt-8 border-l-4 border-teal-500 bg-white p-5">
                <h2 className="font-semibold">This case is past upload</h2>
                <p className="mt-2 text-sm text-navy-700">
                  Use the status page for current steps and report or outcome actions.
                </p>
                <Link
                  className="mt-4 inline-block rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white"
                  href={`/app/cases/${encodeURIComponent(activeCase.case_ref)}/status`}
                >
                  View status
                </Link>
              </section>
            ) : null}

            {canUpload(activeCase) ? (
              <>
                <section className="mt-8 border-t border-navy-200 pt-6">
                  <h2 className="text-xl font-semibold">Required documents</h2>
                  <div className="mt-4 grid gap-4">
                    {REQUIRED_SLOTS.map((slot) => {
                      const state = slots[slot.id]
                      return (
                        <div key={slot.id} className="border-l-4 border-teal-500 bg-white p-5">
                          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <h3 className="font-semibold">{slot.title}</h3>
                              <p className="mt-1 text-sm text-navy-700">{slot.body}</p>
                              {slot.id === 'coverage' ? (
                                <label className="mt-3 block text-sm text-navy-700">
                                  Document type
                                  <select
                                    className="mt-1 block rounded-lg border border-navy-300 bg-white px-3 py-2"
                                    value={coverageDocType}
                                    onChange={(event) => {
                                      setCoverageDocType(event.target.value as UploadDocType)
                                    }}
                                  >
                                    <option value="policy">Policy document</option>
                                    <option value="cis">Certificate of Insurance</option>
                                  </select>
                                </label>
                              ) : null}
                            </div>
                            <p className="inline-flex items-center gap-2 rounded-lg border border-navy-200 px-3 py-2 text-sm font-medium text-navy-800">
                              <span className="h-2 w-2 rounded-full bg-teal-500" />
                              {statusCopy(state)}
                            </p>
                          </div>
                          <label className="mt-4 flex min-h-24 cursor-pointer items-center justify-center rounded-lg border border-dashed border-teal-700 bg-teal-50 px-4 py-5 text-center text-sm font-medium text-teal-900">
                            {state.documentId ? 'Replace document' : 'Choose file'}
                            <input
                              className="sr-only"
                              type="file"
                              accept="application/pdf,image/jpeg,image/png,image/tiff"
                              onChange={(event) => {
                                handleRequiredFile(slot.id, event)
                              }}
                            />
                          </label>
                        </div>
                      )
                    })}
                  </div>
                </section>

                <section className="mt-8 border-t border-navy-200 pt-6">
                  <button
                    className="rounded-lg border border-navy-300 px-4 py-2 font-medium text-navy-900"
                    type="button"
                    onClick={() => {
                      setAdditionalOpen((open) => !open)
                    }}
                  >
                    {additionalOpen ? 'Hide additional documents' : 'Add additional documents'}
                  </button>
                  {additionalOpen ? (
                    <div className="mt-4 border-l-4 border-teal-500 bg-white p-5">
                      <label className="block text-sm text-navy-700">
                        Document type
                        <select
                          className="mt-1 block rounded-lg border border-navy-300 bg-white px-3 py-2"
                          value={additionalDocType}
                          onChange={(event) => {
                            setAdditionalDocType(event.target.value as UploadDocType)
                          }}
                        >
                          {ADDITIONAL_DOC_TYPES.map((docType) => (
                            <option key={docType.value} value={docType.value}>
                              {docType.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="mt-4 flex min-h-20 cursor-pointer items-center justify-center rounded-lg border border-dashed border-teal-700 bg-teal-50 px-4 py-5 text-center text-sm font-medium text-teal-900">
                        Choose additional file
                        <input
                          className="sr-only"
                          type="file"
                          accept="application/pdf,image/jpeg,image/png,image/tiff"
                          onChange={handleAdditionalFile}
                        />
                      </label>
                      {additionalMessage ? (
                        <p className="mt-3 text-sm text-navy-700">{additionalMessage}</p>
                      ) : null}
                    </div>
                  ) : null}
                </section>

                <section className="mt-8 flex flex-wrap gap-3 border-t border-navy-200 pt-6">
                  <button
                    className="rounded-lg bg-teal-700 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
                    type="button"
                    disabled={(!allRequiredPassed && activeCase.status !== 'payment_pending') || isPending}
                    onClick={continueFromUpload}
                  >
                    {activeCase.status === 'payment_pending' ? 'Proceed to payment' : 'View case status'}
                  </button>
                  <Link
                    className="rounded-lg border border-navy-300 px-5 py-3 font-semibold text-navy-800"
                    href="/app/dashboard"
                  >
                    Back to cases
                  </Link>
                </section>
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  )
}
