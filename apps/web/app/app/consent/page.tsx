'use client'

import type { FormEvent, ReactElement } from 'react'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { CONSENT_COPY, type ConsentType } from '../../../lib/consent'

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
    <main className="min-h-screen bg-slate-950 px-6 py-16">
      <form
        onSubmit={handleSubmit}
        className="mx-auto max-w-3xl rounded-3xl border border-slate-800 bg-slate-900/80 p-8"
      >
        <p className="text-sm uppercase tracking-[0.3em] text-sky-300">Consent</p>
        <h1 className="mt-4 text-3xl font-semibold text-white">Before document upload</h1>
        <p className="mt-4 text-slate-300">
          Please review each DPDP consent item. None are pre-selected.
        </p>
        <div className="mt-8 space-y-4">
          {CONSENT_TYPES.map((consentType) => (
            <label
              key={consentType}
              className="flex gap-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-200"
            >
              <input
                className="mt-1 h-5 w-5 accent-sky-300"
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
                    className="ml-1 text-sky-300 underline"
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
        {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
        <button
          className="mt-8 rounded-xl bg-sky-300 px-5 py-3 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
          type="submit"
          disabled={!allChecked || isPending}
        >
          {isPending ? 'Saving consent...' : 'Agree and continue'}
        </button>
      </form>
      {showPolicy ? (
        <div className="fixed inset-0 flex items-center justify-center bg-slate-950/80 px-6">
          <section className="max-w-xl rounded-3xl border border-slate-700 bg-slate-900 p-8 text-slate-200">
            <h2 className="text-2xl font-semibold text-white">Terms and Privacy Policy</h2>
            <p className="mt-4">
              ClaimClarity processes uploaded insurance documents only to prepare a human-reviewed
              claim analysis report. Documents are not used to train AI models and are retained
              according to the stated deletion policy.
            </p>
            <button
              className="mt-6 rounded-xl bg-sky-300 px-4 py-2 font-semibold text-slate-950"
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
    </main>
  )
}
