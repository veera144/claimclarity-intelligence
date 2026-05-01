'use client'

/**
 * @file report-download-button.tsx
 * @module web/app/cases/report
 *
 * Patient report download button that fetches a transient signed URL on click.
 */

import { useState, type ReactElement } from 'react'

type ReportDownloadButtonProps = {
  caseId: string
}

export function ReportDownloadButton(props: ReportDownloadButtonProps): ReactElement {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')

  async function downloadReport(): Promise<void> {
    setStatus('loading')
    const response = await fetch(`/api/cases/${encodeURIComponent(props.caseId)}/report/download`, {
      method: 'GET',
      credentials: 'same-origin',
    })

    if (!response.ok) {
      setStatus('error')
      return
    }

    const payload = (await response.json()) as { signedUrl?: unknown }
    if (typeof payload.signedUrl !== 'string' || payload.signedUrl.length === 0) {
      setStatus('error')
      return
    }

    window.location.assign(payload.signedUrl)
    setStatus('idle')
  }

  return (
    <div className="mt-8">
      <button
        type="button"
        onClick={() => {
          void downloadReport()
        }}
        disabled={status === 'loading'}
        className="patient-primary-button disabled:cursor-wait"
      >
        {status === 'loading' ? 'Preparing download...' : 'Download report'}
      </button>
      {status === 'error' ? (
        <p className="mt-3 rounded-2xl border border-deducted-500/25 bg-deducted-50 px-4 py-3 text-sm text-deducted-700">
          We could not prepare the download. Please refresh and try again.
        </p>
      ) : null}
    </div>
  )
}
