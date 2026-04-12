/**
 * @file route.ts
 * @module web/api/cases/caseId/documents
 *
 * Handles patient document upload and status polling for Module 2.
 *
 * DEPENDENCIES:
 *   - node:crypto (AES-256-GCM filename encryption)
 *   - /apps/web/lib/errors.ts
 *   - /apps/web/lib/rateLimit.ts
 *   - /apps/web/lib/validation/document.schemas.ts
 *   - /packages/db/src/client.server.ts
 *   - /packages/db/src/queries/cases.queries.ts
 *   - /packages/db/src/queries/documents.queries.ts
 *
 * CALLED BY:
 *   - /apps/web/app/app/upload/page.tsx
 *   - /apps/processor/src/jobs/quality-check.ts tests
 *
 * CALLS:
 *   - Supabase Storage, documents, cases, and processing_jobs
 */

import { randomBytes, randomUUID, createCipheriv } from 'node:crypto'
import { extname } from 'node:path'

import {
  createServerClient,
  createServiceClient,
  getCaseForPatientAction,
  listDocumentsForCase,
  queueProcessingJob,
} from '@claimclarity/db'
import { ACCEPTED_DOCUMENT_MIME_TYPES, MAX_FILE_SIZE_BYTES } from '@claimclarity/shared/constants'

import { AuthorizationError, ExternalServiceError, NotFoundError, ValidationError, toApiResponse } from '../../../../../lib/errors'
import { rateLimitRequest } from '../../../../../lib/rateLimit'
import {
  DOCUMENT_UPLOAD_SCHEMA,
  isRequiredUploadDocType,
} from '../../../../../lib/validation/document.schemas'

export const runtime = 'nodejs'

type RouteContext = {
  params: {
    caseId: string
  }
}

const MIME_TO_EXTENSION: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/tiff': 'tiff',
}

const ACCEPTED_MIME_TYPES = new Set<string>(ACCEPTED_DOCUMENT_MIME_TYPES)

function getRequiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`)
  }
  return value
}

function encryptOriginalFilename(filename: string): string {
  const key = Buffer.from(getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY').slice(0, 32), 'utf8')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(filename, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return Buffer.concat([iv, tag, encrypted]).toString('base64url')
}

function inferMimeType(buffer: Buffer): string | null {
  if (buffer.subarray(0, 4).toString('utf8') === '%PDF') {
    return 'application/pdf'
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return 'image/jpeg'
  }

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png'
  }

  const tiffLittleEndian = buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00
  const tiffBigEndian = buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a
  return tiffLittleEndian || tiffBigEndian ? 'image/tiff' : null
}

async function getAuthenticatedPatientId(): Promise<string> {
  const sessionClient = await createServerClient()
  const {
    data: { user },
  } = await sessionClient.auth.getUser()

  if (!user) {
    throw new AuthorizationError('Authentication required')
  }

  return user.id
}

async function assertPatientOwnsCase(input: {
  caseId: string
  patientId: string
}): Promise<void> {
  const serviceClient = createServiceClient()
  const caseRow = await getCaseForPatientAction({
    client: serviceClient,
    caseId: input.caseId,
  })

  if (!caseRow) {
    throw new NotFoundError('Case', input.caseId)
  }

  if (caseRow.patient_id !== input.patientId) {
    throw new AuthorizationError('Case access denied')
  }
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const patientId = await getAuthenticatedPatientId()
    await assertPatientOwnsCase({ caseId: context.params.caseId, patientId })

    const documents = await listDocumentsForCase({
      client: createServiceClient(),
      caseId: context.params.caseId,
    })

    return Response.json({ documents })
  } catch (error) {
    return toApiResponse(error)
  }
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const limited = await rateLimitRequest(request, 'upload')
    if (limited) {
      return limited
    }

    const patientId = await getAuthenticatedPatientId()
    await assertPatientOwnsCase({ caseId: context.params.caseId, patientId })

    const formData = await request.formData()
    const file = formData.get('file')
    const parsed = DOCUMENT_UPLOAD_SCHEMA.safeParse({
      docType: formData.get('docType'),
    })

    if (!parsed.success) {
      throw new ValidationError('Invalid document type', { issues: parsed.error.issues })
    }

    if (!(file instanceof File)) {
      throw new ValidationError('Document file is required')
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      const sizeInMb = Math.ceil(file.size / (1024 * 1024))
      throw new ValidationError(`This file is ${String(sizeInMb)}MB. Maximum is 20MB.`)
    }

    if (!ACCEPTED_MIME_TYPES.has(file.type)) {
      throw new ValidationError('Only PDF, JPEG, PNG, and TIFF files are accepted.')
    }

    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const inferredMimeType = inferMimeType(buffer)
    if (!inferredMimeType || inferredMimeType !== file.type) {
      throw new ValidationError('Only PDF, JPEG, PNG, and TIFF files are accepted.')
    }

    const extension = MIME_TO_EXTENSION[inferredMimeType] ?? extname(file.name).replace('.', '')
    const documentUuid = randomUUID()
    const objectPath = `${context.params.caseId}/${documentUuid}.${extension}`
    const storagePath = `case-documents/${objectPath}`
    const serviceClient = createServiceClient()

    const { error: uploadError } = await serviceClient.storage
      .from('case-documents')
      .upload(objectPath, buffer, {
        contentType: inferredMimeType,
        upsert: false,
      })

    if (uploadError) {
      throw new ExternalServiceError('Supabase Storage', uploadError.message, {
        caseId: context.params.caseId,
      })
    }

    const docType = parsed.data.docType
    const { data: documentRow, error: documentError } = await serviceClient
      .from('documents')
      .insert({
        case_id: context.params.caseId,
        doc_type: docType,
        is_required: isRequiredUploadDocType(docType),
        storage_path: storagePath,
        original_filename_encrypted: encryptOriginalFilename(file.name),
        file_size_bytes: file.size,
        mime_type: inferredMimeType,
        quality_status: 'pending',
        uploaded_by: patientId,
      })
      .select('id')
      .single()

    if (documentError) {
      throw new ExternalServiceError('Supabase', documentError.message, {
        caseId: context.params.caseId,
      })
    }

    await queueProcessingJob({
      client: serviceClient,
      caseId: context.params.caseId,
      documentId: documentRow.id,
      jobType: 'quality_check',
      idempotencyKey: `quality_check:${context.params.caseId}:${documentRow.id}`,
    })

    return Response.json({ documentId: documentRow.id, status: 'checking' })
  } catch (error) {
    return toApiResponse(error)
  }
}
