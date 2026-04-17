/**
 * @file route.ts
 * @module web/api/cases/report/download
 *
 * Login-gated Module 8 report download signed URL endpoint.
 *
 * DEPENDENCIES:
 *   - /apps/web/lib/report-download.ts
 *   - /packages/db/src/client.server.ts
 *
 * CALLED BY:
 *   - /apps/web/app/app/cases/[caseRef]/report/report-download-button.tsx
 *
 * CALLS:
 *   - Supabase auth, cases, reports, storage, and audit_log
 */

import { createServerClient, createServiceClient } from '@claimclarity/db'

import {
  createReportDownloadSignedUrl,
  ReportDownloadError,
} from '../../../../../../lib/report-download'

export const runtime = 'nodejs'

type RouteContext = {
  params: {
    caseId: string
  }
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const sessionClient = await createServerClient()
    const {
      data: { user },
    } = await sessionClient.auth.getUser()

    const result = await createReportDownloadSignedUrl({
      client: createServiceClient(),
      caseId: context.params.caseId,
      patientId: user?.id ?? null,
    })

    return Response.json(result)
  } catch (error) {
    if (error instanceof ReportDownloadError) {
      return Response.json({ error: error.message }, { status: error.statusCode })
    }

    console.error('[report-download] Unexpected error', error)
    return Response.json({ error: 'Report download is unavailable right now' }, { status: 500 })
  }
}
