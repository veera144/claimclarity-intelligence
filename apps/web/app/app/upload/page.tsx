'use client'

import type { ChangeEvent, ReactElement } from 'react'
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'

import {
  type UploadDocType,
  validateUploadFile,
} from '../../../lib/validation/document.schemas'

type RequiredSlotId = 'coverage' | 'hospital_bill' | 'insurer_response'

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
      error: document.quality_failure_reason ?? 'This document needs another upload.',
    }
  }

  return { status: 'checking', documentId: document.id, error: null }
}

function statusCopy(state: SlotState): string {
  if (state.status === 'uploading') {
    return 'uploading'
  }

  if (state.status === 'checking') {
    return 'checking'
  }

  if (state.status === 'passed') {
    return 'passed'
  }

  if (state.status === 'failed') {
    return state.error ?? 'failed'
  }

  return 'empty'
}

export default function UploadPage(): ReactElement {
  const [caseId, setCaseId] = useState<string | null>(null)
  const [caseRef, setCaseRef] = useState<string | null>(null)
  const [coverageDocType, setCoverageDocType] = useState<UploadDocType>('policy')
  const [additionalDocType, setAdditionalDocType] = useState<UploadDocType>('discharge_summary')
  const [additionalOpen, setAdditionalOpen] = useState(false)
  const [slots, setSlots] = useState<Record<RequiredSlotId, SlotState>>(INITIAL_SLOT_STATE)
  const [additionalMessage, setAdditionalMessage] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const allRequiredPassed = REQUIRED_SLOTS.every((slot) => slots[slot.id].status === 'passed')

  const pollDocuments = useCallback(async (activeCaseId: string): Promise<void> => {
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
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch('/api/cases', { method: 'POST' })
        if (!response.ok) {
          setPageError('We could not create your case. Please check your consent status and try again.')
          return
        }

        const payload = (await response.json()) as { caseId: string; caseRef: string }
        setCaseId(payload.caseId)
        setCaseRef(payload.caseRef)
      } catch {
        setPageError('We could not create your case. Please try again.')
      }
    })()
  }, [])

  useEffect(() => {
    if (!caseId) {
      return undefined
    }

    const hasPendingDocument = Object.values(slots).some((slot) => slot.status === 'checking')
    if (!hasPendingDocument) {
      return undefined
    }

    const interval = window.setInterval(() => {
      void pollDocuments(caseId)
    }, 3000)

    return () => {
      window.clearInterval(interval)
    }
  }, [caseId, pollDocuments, slots])

  const caseLabel = useMemo(() => caseRef ?? 'Creating case...', [caseRef])

  function uploadFile(input: {
    file: File
    docType: UploadDocType
    slotId?: RequiredSlotId
  }): void {
    if (!caseId) {
      setPageError('Your case is still being created. Please try again in a moment.')
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

        const response = await fetch(`/api/cases/${caseId}/documents`, {
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
          setAdditionalMessage('checking')
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

  return (
    <main className="min-h-screen bg-[#f7f8f5] px-4 py-10 font-['IBM_Plex_Sans',Arial,sans-serif] text-slate-900">
      <div className="mx-auto max-w-4xl">
        <p className="text-sm font-semibold uppercase text-teal-700">ClaimClarity</p>
        <h1 className="mt-3 text-3xl font-semibold">Upload claim documents</h1>
        <p className="mt-3 max-w-2xl text-slate-700">
          Case {caseLabel}. Upload the three required documents first. Each file is checked before
          payment.
        </p>
        {pageError ? <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{pageError}</p> : null}

        <section className="mt-8 border-t border-slate-300 pt-6">
          <h2 className="text-xl font-semibold">Required documents</h2>
          <div className="mt-4 grid gap-4">
            {REQUIRED_SLOTS.map((slot) => {
              const state = slots[slot.id]
              return (
                <div key={slot.id} className="rounded-lg border border-slate-300 bg-white p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="font-semibold">{slot.title}</h3>
                      <p className="mt-1 text-sm text-slate-700">{slot.body}</p>
                      {slot.id === 'coverage' ? (
                        <label className="mt-3 block text-sm text-slate-700">
                          Document type
                          <select
                            className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2"
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
                    <p className="rounded-lg bg-teal-50 px-3 py-2 text-sm font-medium text-teal-800">
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

        <section className="mt-8 border-t border-slate-300 pt-6">
          <button
            className="rounded-lg border border-slate-400 px-4 py-2 font-medium text-slate-900"
            type="button"
            onClick={() => {
              setAdditionalOpen((open) => !open)
            }}
          >
            {additionalOpen ? 'Hide additional documents' : 'Add additional documents'}
          </button>
          {additionalOpen ? (
            <div className="mt-4 rounded-lg border border-slate-300 bg-white p-5">
              <label className="block text-sm text-slate-700">
                Document type
                <select
                  className="mt-1 block rounded-lg border border-slate-300 bg-white px-3 py-2"
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
                <p className="mt-3 text-sm text-slate-700">{additionalMessage}</p>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="mt-8 border-t border-slate-300 pt-6">
          <button
            className="rounded-lg bg-teal-700 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
            type="button"
            disabled={!allRequiredPassed || isPending}
            onClick={() => {
              if (caseRef) {
                window.location.href = `/app/cases/${caseRef}/pay`
              }
            }}
          >
            Proceed to payment
          </button>
        </section>
      </div>
    </main>
  )
}
