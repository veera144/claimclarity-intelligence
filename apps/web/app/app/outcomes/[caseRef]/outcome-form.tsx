'use client'

import type { FormEvent, ReactElement } from 'react'
import { useState } from 'react'

type OutcomeFormProps = {
  caseId: string
  caseRef: string
  token?: string
}

type SubmitState = 'idle' | 'submitting' | 'done' | 'error'

const ACTION_OPTIONS = [
  { value: 'submitted_appeal', label: 'I submitted an appeal' },
  { value: 'waiting_response', label: 'I am waiting for a response' },
  { value: 'closed_no_benefit', label: 'I decided not to appeal' },
] as const

const OUTCOME_OPTIONS = [
  { value: 'partial_reversal', label: 'They paid more than before' },
  { value: 'no_change', label: 'Same as before or rejected' },
  { value: 'full_reversal', label: 'Resolved fully' },
] as const

export function OutcomeForm(props: OutcomeFormProps): ReactElement {
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [message, setMessage] = useState('')
  const [patientActionType, setPatientActionType] =
    useState<(typeof ACTION_OPTIONS)[number]['value']>('submitted_appeal')
  const [insurerResponded, setInsurerResponded] = useState('yes')
  const [outcomeType, setOutcomeType] =
    useState<(typeof OUTCOME_OPTIONS)[number]['value']>('partial_reversal')
  const [finalAmount, setFinalAmount] = useState('')
  const [satisfaction, setSatisfaction] = useState('5')
  const [comment, setComment] = useState('')
  const [evidencePath, setEvidencePath] = useState<string | null>(null)

  async function uploadEvidence(file: File): Promise<void> {
    const formData = new FormData()
    formData.set('file', file)
    if (props.token) formData.set('token', props.token)

    const response = await fetch(`/api/outcomes/${props.caseId}/evidence`, {
      method: 'POST',
      body: formData,
    })
    if (!response.ok) {
      setMessage('We could not upload the proof. You can still submit this as self-reported.')
      return
    }

    const payload = (await response.json()) as { storagePath?: string }
    if (payload.storagePath) {
      setEvidencePath(payload.storagePath)
      setMessage('Proof uploaded. Your outcome will be marked document verified.')
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setSubmitState('submitting')
    setMessage('')

    const appealSubmitted = patientActionType !== 'closed_no_benefit'
    const body = {
      ...(props.token ? { token: props.token } : {}),
      appealSubmitted,
      patientActionType,
      insurerResponded: appealSubmitted ? insurerResponded === 'yes' : false,
      finalSettledAmountInr: finalAmount ? Number(finalAmount) : undefined,
      outcomeType: appealSubmitted && insurerResponded === 'yes' ? outcomeType : undefined,
      reportUsedInAppeal: appealSubmitted,
      userSatisfaction: Number(satisfaction),
      userComment: comment || undefined,
      evidenceStoragePath: evidencePath ?? undefined,
    }

    const response = await fetch(`/api/outcomes/${props.caseId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      setSubmitState('error')
      setMessage('This update could not be saved. Please try again.')
      return
    }

    setSubmitState('done')
    setMessage('Thank you. Your update has been recorded.')
  }

  return (
    <form
      onSubmit={(event) => {
        void onSubmit(event)
      }}
      className="mt-8 grid gap-6"
    >
      <section className="patient-surface p-6 sm:p-8">
        <h2 className="text-xl font-semibold">What action did you take?</h2>
        <div className="mt-4 grid gap-3">
          {ACTION_OPTIONS.map((option) => (
            <label key={option.value} className="flex gap-3 rounded-2xl border border-navy-200 p-4">
              <input
                type="radio"
                name="patientActionType"
                value={option.value}
                checked={patientActionType === option.value}
                onChange={() => {
                  setPatientActionType(option.value)
                }}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </section>

      {patientActionType !== 'closed_no_benefit' ? (
        <section className="patient-surface p-6 sm:p-8">
          <h2 className="text-xl font-semibold">Did the insurer or TPA respond?</h2>
          <div className="mt-4 grid gap-3">
            <label className="flex gap-3 rounded-2xl border border-navy-200 p-4">
              <input
                type="radio"
                name="insurerResponded"
                value="yes"
                checked={insurerResponded === 'yes'}
                onChange={() => {
                  setInsurerResponded('yes')
                }}
              />
              <span>Yes</span>
            </label>
            <label className="flex gap-3 rounded-2xl border border-navy-200 p-4">
              <input
                type="radio"
                name="insurerResponded"
                value="waiting"
                checked={insurerResponded === 'waiting'}
                onChange={() => {
                  setInsurerResponded('waiting')
                }}
              />
              <span>Still waiting</span>
            </label>
          </div>
        </section>
      ) : null}

      {patientActionType !== 'closed_no_benefit' && insurerResponded === 'yes' ? (
        <section className="patient-surface p-6 sm:p-8">
          <h2 className="text-xl font-semibold">What was the result?</h2>
          <div className="mt-4 grid gap-3">
            {OUTCOME_OPTIONS.map((option) => (
              <label key={option.value} className="flex gap-3 rounded-2xl border border-navy-200 p-4">
                <input
                  type="radio"
                  name="outcomeType"
                  value={option.value}
                  checked={outcomeType === option.value}
                  onChange={() => {
                    setOutcomeType(option.value)
                  }}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          <label className="patient-label mt-5">
            Final settled amount in whole rupees
            <input
              type="number"
              min="0"
              inputMode="numeric"
              placeholder="e.g. 15000"
              value={finalAmount}
              onChange={(event) => {
                setFinalAmount(event.target.value)
              }}
              className="patient-input"
            />
          </label>
          <label className="patient-label mt-5">
            Settlement proof (optional)
            <input
              className="patient-input"
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void uploadEvidence(file)
              }}
            />
          </label>
        </section>
      ) : null}

      <section className="patient-surface p-6 sm:p-8">
        <h2 className="text-xl font-semibold">Did the report help?</h2>
        <label className="patient-label mt-4">
          Helpfulness, 1 to 5
          <select
            value={satisfaction}
            onChange={(event) => {
              setSatisfaction(event.target.value)
            }}
            className="patient-select"
          >
            {[1, 2, 3, 4, 5].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="patient-label mt-5">
          Comment (optional)
          <textarea
            maxLength={500}
            value={comment}
            onChange={(event) => {
              setComment(event.target.value)
            }}
            className="patient-textarea min-h-28"
          />
        </label>
      </section>

      <button
        type="submit"
        disabled={submitState === 'submitting' || submitState === 'done'}
        className="patient-primary-button w-fit"
      >
        {submitState === 'submitting' ? 'Saving...' : 'Submit update'}
      </button>
      {message ? (
        <p
          className={
            submitState === 'error'
              ? 'rounded-2xl border border-deducted-500/25 bg-deducted-50 px-4 py-3 font-medium text-deducted-700'
              : 'rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 font-medium text-teal-800'
          }
        >
          {message}
        </p>
      ) : null}
    </form>
  )
}
