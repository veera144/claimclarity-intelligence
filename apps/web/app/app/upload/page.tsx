import type { ReactElement } from 'react'
import { Suspense } from 'react'

import { UploadWorkspace } from './upload-workspace'

export default function UploadPage(): ReactElement {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-navy-50 px-4 py-10 font-['IBM_Plex_Sans',Arial,sans-serif] text-navy-950">
          <div className="mx-auto max-w-4xl">
            <p className="text-sm font-semibold uppercase text-teal-700">ClaimClarity</p>
            <h1 className="mt-3 text-3xl font-semibold">Upload claim documents</h1>
            <p className="mt-3 text-navy-700">Loading your cases...</p>
          </div>
        </main>
      }
    >
      <UploadWorkspace />
    </Suspense>
  )
}
