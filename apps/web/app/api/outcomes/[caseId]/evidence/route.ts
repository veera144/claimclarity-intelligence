/**
 * @file route.ts
 * @module web/api/outcomes/evidence
 *
 * Private optional outcome evidence upload endpoint.
 *
 * DEPENDENCIES:
 *   - node:crypto (storage path UUID)
 *   - @claimclarity/db (Supabase clients and token inspection)
 *   - @claimclarity/shared/constants (MIME and size limits)
 *
 * CALLED BY:
 *   - /apps/web/app/app/outcomes/[caseRef]/outcome-form.tsx
 *
 * CALLS:
 *   - Supabase cases, outcome_tokens, outcome-evidence storage, audit_log
 */

import { randomUUID } from 'node:crypto'

import { createServerClient, createServiceClient } from '@claimclarity/db'
import { inspectOutcomeToken } from '@claimclarity/db/outcome-tokens'
import {
  ACCEPTED_OUTCOME_EVIDENCE_MIME_TYPES,
  MAX_OUTCOME_EVIDENCE_SIZE_BYTES,
} from '@claimclarity/shared/constants'

import { AuthorizationError, ExternalServiceError, toApiResponse, ValidationError } from '../../../../../lib/errors'
import { rateLimitRequest } from '../../../../../lib/rateLimit'
import { getRequestIp } from '../../../../../lib/request'

export const runtime = 'nodejs'

type EvidenceRouteContext = {
  params: {
    caseId: string
  }
}

const BUCKET_NAME = 'outcome-evidence'
const EXTENSION_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}

function isAcceptedMimeType(value: string): boolean {
  return (ACCEPTED_OUTCOME_EVIDENCE_MIME_TYPES as readonly string[]).includes(value)
}

async function authorizeEvidenceUpload(input: {
  caseId: string
  token: string | null
  patientId: string | null
}): Promise<void> {
  const serviceClient = createServiceClient()

  if (input.token) {
    const inspected = await inspectOutcomeToken(input.token, serviceClient)
    if (!inspected || inspected.caseId !== input.caseId || inspected.tokenType !== 'full_outcome') {
      throw new AuthorizationError('Invalid or expired outcome link')
    }
    return
  }

  if (!input.patientId) {
    throw new AuthorizationError('Authentication required for evidence upload')
  }

  const { data, error } = await serviceClient
    .from('cases')
    .select('patient_id')
    .eq('id', input.caseId)
    .maybeSingle()

  if (error) throw new ExternalServiceError('Supabase', error.message, { caseId: input.caseId })
  if (!data || data.patient_id !== input.patientId) {
    throw new AuthorizationError('Authentication required for evidence upload')
  }
}

export async function POST(request: Request, context: EvidenceRouteContext): Promise<Response> {
  try {
    const limited = await rateLimitRequest(request, 'upload')
    if (limited) return limited

    const sessionClient = await createServerClient()
    const {
      data: { user },
    } = await sessionClient.auth.getUser()
    const formData = await request.formData()
    const maybeFile = formData.get('file')
    const token = formData.get('token')
    if (!(maybeFile instanceof File)) {
      throw new ValidationError('Evidence file is required')
    }
    if (!isAcceptedMimeType(maybeFile.type)) {
      throw new ValidationError('Evidence must be a PDF, JPEG, or PNG file')
    }
    if (maybeFile.size > MAX_OUTCOME_EVIDENCE_SIZE_BYTES) {
      throw new ValidationError('Evidence file is too large')
    }

    await authorizeEvidenceUpload({
      caseId: context.params.caseId,
      token: typeof token === 'string' ? token : null,
      patientId: user?.id ?? null,
    })

    const extension = EXTENSION_BY_MIME[maybeFile.type] ?? 'bin'
    const objectPath = `${context.params.caseId}/${randomUUID()}.${extension}`
    const storagePath = `${BUCKET_NAME}/${objectPath}`
    const serviceClient = createServiceClient()
    const { error } = await serviceClient.storage.from(BUCKET_NAME).upload(objectPath, maybeFile, {
      contentType: maybeFile.type,
      upsert: false,
    })

    if (error) {
      await serviceClient.from('audit_log').insert({
        actor_id: user?.id ?? null,
        actor_role: user ? 'patient' : 'patient_token',
        action: 'evidence_upload_failed',
        entity_type: 'case',
        entity_id: context.params.caseId,
        ip_address: getRequestIp(request),
        metadata: {
          reason: error.message,
          mime_type: maybeFile.type,
          file_size_bytes: maybeFile.size,
        },
      })
      throw new ExternalServiceError('Supabase Storage', error.message, { caseId: context.params.caseId })
    }

    await serviceClient.from('audit_log').insert({
      actor_id: user?.id ?? null,
      actor_role: user ? 'patient' : 'patient_token',
      action: 'evidence_uploaded',
      entity_type: 'case',
      entity_id: context.params.caseId,
      ip_address: getRequestIp(request),
      metadata: {
        storage_path: storagePath,
        mime_type: maybeFile.type,
        file_size_bytes: maybeFile.size,
      },
    })

    return Response.json({ storagePath })
  } catch (error) {
    return toApiResponse(error)
  }
}
