import type { ReactElement } from 'react'
import { Suspense } from 'react'

import { PatientScaffold } from '../../../components/patient-ui'

import { UploadWorkspace } from './upload-workspace'

export default function UploadPage(): ReactElement {
  return (
    <Suspense
      fallback={
        <PatientScaffold
          eyebrow="Document upload"
          title="Upload claim documents"
          description="Loading your cases..."
        >
          <div className="patient-empty-state">Preparing your upload workspace.</div>
        </PatientScaffold>
      }
    >
      <UploadWorkspace />
    </Suspense>
  )
}
