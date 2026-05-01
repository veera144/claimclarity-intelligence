'use client'

import type { ReactElement } from 'react'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

export function StartNewCaseButton(): ReactElement {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function startCase(): void {
    setError(null)
    startTransition(() => {
      void (async () => {
        const response = await fetch('/api/cases', { method: 'POST' })
        if (!response.ok) {
          setError('We could not start a new case. Please check consent and try again.')
          return
        }

        const payload = (await response.json()) as { caseId: string }
        router.push(`/app/upload?caseId=${encodeURIComponent(payload.caseId)}`)
        router.refresh()
      })()
    })
  }

  return (
    <div>
      <button
        className="patient-primary-button"
        disabled={isPending}
        onClick={startCase}
        type="button"
      >
        {isPending ? 'Starting case...' : 'Start new case'}
      </button>
      {error ? (
        <p className="mt-3 rounded-2xl border border-deducted-500/25 bg-deducted-50 px-4 py-3 text-sm text-deducted-700">
          {error}
        </p>
      ) : null}
    </div>
  )
}
