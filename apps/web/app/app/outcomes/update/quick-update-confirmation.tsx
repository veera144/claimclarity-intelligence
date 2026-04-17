'use client'

import type { ReactElement } from 'react'
import { useState } from 'react'

type QuickUpdateConfirmationProps = {
  token: string
  action: string
}

export function QuickUpdateConfirmation(props: QuickUpdateConfirmationProps): ReactElement {
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle')

  async function confirm(): Promise<void> {
    setState('saving')
    const response = await fetch('/api/outcomes/quick-update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token: props.token,
        action: props.action,
      }),
    })

    setState(response.ok ? 'done' : 'error')
  }

  if (state === 'done') {
    return <p className="mt-6 font-medium text-teal-800">Thank you. Your update has been recorded.</p>
  }

  return (
    <div className="mt-8">
      <button
        type="button"
        disabled={state === 'saving'}
        onClick={() => {
          void confirm()
        }}
        className="rounded bg-teal-700 px-5 py-3 font-semibold text-white disabled:bg-zinc-400"
      >
        {state === 'saving' ? 'Saving...' : 'Confirm update'}
      </button>
      {state === 'error' ? (
        <p className="mt-4 font-medium text-red-700">
          This link could not be used. It may have expired or already been submitted.
        </p>
      ) : null}
    </div>
  )
}
