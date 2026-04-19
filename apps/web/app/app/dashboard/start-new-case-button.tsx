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
        className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
        disabled={isPending}
        onClick={startCase}
        type="button"
      >
        {isPending ? 'Starting case...' : 'Start new case'}
      </button>
      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
    </div>
  )
}
