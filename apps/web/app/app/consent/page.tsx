'use client'

import type { FormEvent, ReactElement } from 'react'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { CONSENT_COPY, type ConsentType } from '../../../lib/consent'
import { PatientScaffold, StatusBadge } from '../../../components/patient-ui'

const DEFAULT_PRIVACY_POLICY_VERSION = 'v1.0-2024-04-01'
const DEFAULT_TERMS_VERSION = 'v1.0-2024-04-01'

const CONSENT_TYPES = [
  'data_processing',
  'no_training',
  'retention_policy',
  'informational_only',
  'terms_of_service',
] as const satisfies readonly ConsentType[]

export default function ConsentPage(): ReactElement {
  const router = useRouter()
  const [checked, setChecked] = useState<Record<ConsentType, boolean>>({
    data_processing: false,
    no_training: false,
    retention_policy: false,
    informational_only: false,
    terms_of_service: false,
  })
  const [showPolicy, setShowPolicy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const allChecked = CONSENT_TYPES.every((consentType) => checked[consentType])

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setError(null)

    startTransition(() => {
      void (async () => {
        const response = await fetch('/api/consents', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            consents: CONSENT_TYPES.map((consentType) => ({
              type: consentType,
              given: checked[consentType],
            })),
            privacyPolicyVersion: DEFAULT_PRIVACY_POLICY_VERSION,
            termsVersion: DEFAULT_TERMS_VERSION,
          }),
        })

        if (!response.ok) {
          setError('Consent could not be saved. Please review all boxes and try again.')
          return
        }

        router.push('/app/upload')
        router.refresh()
      })()
    })
  }

  return (
    <PatientScaffold
      eyebrow="Consent review"
      title="Before document upload"
      description="Please review each required consent item. None are pre-selected, and upload starts only after all five are accepted."
    >
      <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <form onSubmit={handleSubmit} className="patient-surface p-8 sm:p-10">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge label="Required before upload" tone="attention" />
            <StatusBadge label="Human-reviewed workflow" tone="navy" />
          </div>
          <div className="mt-8 space-y-4">
            {CONSENT_TYPES.map((consentType) => (
              <label
                key={consentType}
                className="flex gap-4 rounded-3xl border border-navy-200 bg-navy-50/70 p-5 text-sm leading-7 text-navy-800"
              >
                <input
                  className="mt-1 h-5 w-5 accent-teal-700"
                  type="checkbox"
                  checked={checked[consentType]}
                  onChange={(event) => {
                    setChecked((previous) => ({
                      ...previous,
                      [consentType]: event.target.checked,
                    }))
                  }}
                />
                <span>
                  {CONSENT_COPY[consentType]}
                  {consentType === 'terms_of_service' ? (
                    <button
                      className="ml-1 text-teal-700 underline"
                      type="button"
                      onClick={() => {
                        setShowPolicy(true)
                      }}
                    >
                      Read policy
                    </button>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
          {error ? (
            <p className="mt-4 rounded-2xl border border-deducted-500/25 bg-deducted-50 px-4 py-3 text-sm text-deducted-700">
              {error}
            </p>
          ) : null}
          <button
            className="patient-primary-button mt-8"
            type="submit"
            disabled={!allChecked || isPending}
          >
            {isPending ? 'Saving consent...' : 'Agree and continue'}
          </button>
        </form>

        <aside className="patient-surface p-8 sm:p-10">
          <p className="patient-eyebrow">What this means</p>
          <h2 className="mt-3 text-2xl font-semibold text-navy-950">Plain-language summary</h2>
          <div className="mt-6 grid gap-4">
            <div className="patient-status-card border-l-4 border-teal-500">
              <h3 className="font-semibold text-navy-950">Your documents stay within this workflow</h3>
              <p className="mt-2 text-sm leading-7 text-navy-700">
                ClaimClarity uses your claim documents to prepare a human-reviewed analysis and report.
              </p>
            </div>
            <div className="patient-status-card border-l-4 border-navy-500">
              <h3 className="font-semibold text-navy-950">AI is not the final decision-maker</h3>
              <p className="mt-2 text-sm leading-7 text-navy-700">
                Any AI-assisted draft remains internal until a reviewer checks it and signs off.
              </p>
            </div>
            <div className="patient-status-card border-l-4 border-covered-500">
              <h3 className="font-semibold text-navy-950">You can continue after this step</h3>
              <p className="mt-2 text-sm leading-7 text-navy-700">
                Once all items are accepted, you can start or resume your document upload.
              </p>
            </div>
          </div>
        </aside>
      </div>
      {showPolicy ? (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-navy-950/60 px-6 backdrop-blur-sm">
          <section className="patient-surface max-w-xl p-8 text-navy-800">
            <h2 className="text-2xl font-semibold text-navy-950">Terms and Privacy Policy</h2>
            <p className="mt-4">
              ClaimClarity processes uploaded insurance documents only to prepare a human-reviewed
              claim analysis report. Documents are not used to train AI models and are retained
              according to the stated deletion policy.
            </p>
            <button
              className="patient-primary-button mt-6"
              type="button"
              onClick={() => {
                setShowPolicy(false)
              }}
            >
              Close
            </button>
          </section>
        </div>
      ) : null}
    </PatientScaffold>
  )
}
