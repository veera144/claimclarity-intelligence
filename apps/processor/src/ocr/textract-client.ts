/**
 * @file textract-client.ts
 * @module processor/ocr
 *
 * Textract adapter that keeps live AWS calls behind injectable boundaries.
 *
 * DEPENDENCIES:
 *   - @aws-sdk/client-s3
 *   - @aws-sdk/client-textract
 *   - /packages/db/src/types.ts
 *   - /packages/shared/src/constants.ts
 *
 * CALLED BY:
 *   - /apps/processor/src/jobs/ocr-job.ts
 *   - Module 4 checkpoint tests
 *
 * CALLS:
 *   - Supabase Storage
 *   - AWS Textract
 *   - AWS S3 temporary staging bucket
 */

import {
  AnalyzeDocumentCommand,
  GetDocumentAnalysisCommand,
  StartDocumentAnalysisCommand,
  TextractClient as AwsTextractClient,
  type Block,
  type FeatureType,
} from '@aws-sdk/client-textract'
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import type { DbClient } from '@claimclarity/db'
import { OCR_CONFIDENCE_THRESHOLD } from '@claimclarity/shared/constants'

import { selectExtractionRoute } from './document-routing'
import {
  calculateWordConfidence,
  hasHandwritingBlock,
  hasTableBlock,
  type ExtractionResult,
  type TextractBlock,
} from './textract-types'

const TEXTRACT_FEATURE_TYPES: FeatureType[] = ['TABLES', 'FORMS']
const DEFAULT_AWS_REGION = 'ap-south-1'
const DEFAULT_STAGING_PREFIX = 'ocr-staging'
const DEFAULT_ASYNC_POLL_INTERVAL_MS = 5000
const DEFAULT_ASYNC_TIMEOUT_MS = 120000

type StagedS3Object = {
  bucket: string
  key: string
}

type StreamingPayload = {
  transformToByteArray: () => Promise<Uint8Array>
}

export type TextractGateway = {
  analyzeBytes: (documentBytes: Uint8Array) => Promise<TextractBlock[]>
  startAnalysis: (document: StagedS3Object) => Promise<string>
  getAnalysisPage: (jobId: string, nextToken?: string) => Promise<TextractPollPage>
}

export type TextractPollPage = {
  status: 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'PARTIAL_SUCCESS'
  blocks: TextractBlock[]
  nextToken?: string
  statusMessage?: string
}

export type S3StagingGateway = {
  putObject: (object: StagedS3Object & { body: Uint8Array; contentType: string }) => Promise<void>
  getObject?: (object: StagedS3Object) => Promise<Uint8Array>
  deleteObject: (object: StagedS3Object) => Promise<void>
}

export type StorageReader = {
  download: (storagePath: string) => Promise<Buffer>
}

export type ExtractDocumentInput = {
  storagePath: string
  docType: string
  caseId: string
  documentId: string
  jobId: string
  mimeType: string | null
  pageCount: number | null
  fileSizeBytes: number | null
  storage: StorageReader
  textract: TextractGateway
  s3: S3StagingGateway
  config?: Partial<TextractRuntimeConfig>
}

export type TextractRuntimeConfig = {
  awsRegion: string
  stagingBucket: string
  stagingPrefix: string
  asyncPollIntervalMs: number
  asyncTimeoutMs: number
}

function requireOptionalEnv(name: string): string | null {
  const value = process.env[name]
  return value && value.trim().length > 0 ? value : null
}

/**
 * Reads Module 4 Textract runtime configuration from process.env.
 *
 * SIDE EFFECTS: reads process.env
 * THROWS: Error when the staging bucket is missing
 * IDEMPOTENT: yes, returns a value derived from environment state
 *
 * @returns Textract runtime configuration
 */
export function readTextractRuntimeConfig(): TextractRuntimeConfig {
  const stagingBucket = requireOptionalEnv('AWS_TEXTRACT_STAGING_BUCKET')
  if (!stagingBucket) {
    throw new Error('Required environment variable AWS_TEXTRACT_STAGING_BUCKET is not set')
  }

  return {
    awsRegion: requireOptionalEnv('AWS_REGION') ?? DEFAULT_AWS_REGION,
    stagingBucket,
    stagingPrefix: requireOptionalEnv('AWS_TEXTRACT_STAGING_PREFIX') ?? DEFAULT_STAGING_PREFIX,
    asyncPollIntervalMs: Number(
      requireOptionalEnv('TEXTRACT_ASYNC_POLL_INTERVAL_MS') ?? DEFAULT_ASYNC_POLL_INTERVAL_MS
    ),
    asyncTimeoutMs: Number(
      requireOptionalEnv('TEXTRACT_ASYNC_TIMEOUT_MS') ?? DEFAULT_ASYNC_TIMEOUT_MS
    ),
  }
}

function mergedConfig(partial?: Partial<TextractRuntimeConfig>): TextractRuntimeConfig {
  const envConfig = readTextractRuntimeConfig()
  return {
    ...envConfig,
    ...partial,
  }
}

function objectPathFromStoragePath(storagePath: string): string {
  return storagePath.startsWith('case-documents/')
    ? storagePath.slice('case-documents/'.length)
    : storagePath
}

/**
 * Creates a Supabase Storage reader for canonical case documents.
 *
 * SIDE EFFECTS: reads private Supabase Storage through service-role access
 * THROWS: Error when storage download fails
 * IDEMPOTENT: yes for the same immutable uploaded object
 *
 * @param client - Service-role Supabase client
 * @returns Storage reader used by the Textract adapter
 */
export function createSupabaseStorageReader(client: DbClient): StorageReader {
  return {
    async download(storagePath: string): Promise<Buffer> {
      const { data, error } = await client.storage
        .from('case-documents')
        .download(objectPathFromStoragePath(storagePath))

      if (error) {
        throw new Error(error.message)
      }

      return Buffer.from(await data.arrayBuffer())
    },
  }
}

function toTextractBlock(block: Block): TextractBlock {
  return {
    id: block.Id ?? '',
    blockType: block.BlockType ?? 'UNKNOWN',
    ...(block.Text ? { text: block.Text } : {}),
    ...(typeof block.Confidence === 'number' ? { confidence: block.Confidence } : {}),
    ...(typeof block.Page === 'number' ? { page: block.Page } : {}),
    ...(typeof block.RowIndex === 'number' ? { rowIndex: block.RowIndex } : {}),
    ...(typeof block.ColumnIndex === 'number' ? { columnIndex: block.ColumnIndex } : {}),
    ...(block.TextType ? { textType: block.TextType } : {}),
    ...(block.EntityTypes ? { entityTypes: block.EntityTypes } : {}),
    ...(block.Relationships
      ? {
          relationships: block.Relationships.map((relationship) => ({
            type: relationship.Type ?? '',
            ids: relationship.Ids ?? [],
          })),
        }
      : {}),
  }
}

function normalizeBlocks(blocks: Block[] | undefined): TextractBlock[] {
  return (blocks ?? []).map(toTextractBlock).filter((block) => block.id.length > 0)
}

/**
 * Creates an AWS-backed Textract gateway.
 *
 * SIDE EFFECTS: creates AWS SDK client and sends live Textract commands
 * THROWS: AWS SDK errors when Textract rejects a request
 * IDEMPOTENT: no, async job creation starts a live Textract job
 *
 * @param config - Runtime AWS configuration
 * @returns Textract gateway
 */
export function createAwsTextractGateway(config: Pick<TextractRuntimeConfig, 'awsRegion'>): TextractGateway {
  const client = new AwsTextractClient({ region: config.awsRegion })

  return {
    async analyzeBytes(documentBytes: Uint8Array): Promise<TextractBlock[]> {
      const response = await client.send(
        new AnalyzeDocumentCommand({
          Document: { Bytes: documentBytes },
          FeatureTypes: TEXTRACT_FEATURE_TYPES,
        })
      )
      return normalizeBlocks(response.Blocks)
    },

    async startAnalysis(document: StagedS3Object): Promise<string> {
      const response = await client.send(
        new StartDocumentAnalysisCommand({
          DocumentLocation: {
            S3Object: {
              Bucket: document.bucket,
              Name: document.key,
            },
          },
          FeatureTypes: TEXTRACT_FEATURE_TYPES,
        })
      )

      if (!response.JobId) {
        throw new Error('Textract did not return a JobId')
      }

      return response.JobId
    },

    async getAnalysisPage(jobId: string, nextToken?: string): Promise<TextractPollPage> {
      const response = await client.send(
        new GetDocumentAnalysisCommand({
          JobId: jobId,
          ...(nextToken ? { NextToken: nextToken } : {}),
        })
      )

      return {
        status: response.JobStatus ?? 'FAILED',
        blocks: normalizeBlocks(response.Blocks),
        ...(response.NextToken ? { nextToken: response.NextToken } : {}),
        ...(response.StatusMessage ? { statusMessage: response.StatusMessage } : {}),
      }
    },
  }
}

function isStreamingPayload(payload: unknown): payload is StreamingPayload {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    'transformToByteArray' in payload &&
    typeof (payload as { transformToByteArray?: unknown }).transformToByteArray === 'function'
  )
}

async function streamingPayloadToBytes(payload: unknown): Promise<Uint8Array> {
  if (!isStreamingPayload(payload)) {
    throw new Error('S3 returned an unreadable object body')
  }

  return new Uint8Array(await payload.transformToByteArray())
}

/**
 * Creates an AWS-backed S3 staging gateway for temporary Textract handoff objects.
 *
 * SIDE EFFECTS: creates AWS SDK client and sends live S3 commands
 * THROWS: AWS SDK errors when S3 rejects a request
 * IDEMPOTENT: no, writes and deletes temporary S3 objects
 *
 * @param config - Runtime AWS configuration
 * @returns S3 staging gateway
 */
export function createAwsS3StagingGateway(config: Pick<TextractRuntimeConfig, 'awsRegion'>): S3StagingGateway {
  const client = new S3Client({ region: config.awsRegion })

  return {
    async putObject(object): Promise<void> {
      await client.send(
        new PutObjectCommand({
          Bucket: object.bucket,
          Key: object.key,
          Body: object.body,
          ContentType: object.contentType,
        })
      )
    },

    async getObject(object): Promise<Uint8Array> {
      const response = await client.send(
        new GetObjectCommand({
          Bucket: object.bucket,
          Key: object.key,
        })
      )
      if (!response.Body) {
        throw new Error('S3 returned no object body')
      }
      return streamingPayloadToBytes(response.Body)
    },

    async deleteObject(object): Promise<void> {
      await client.send(
        new DeleteObjectCommand({
          Bucket: object.bucket,
          Key: object.key,
        })
      )
    },
  }
}

/**
 * Creates live AWS gateways for the processor.
 *
 * SIDE EFFECTS: creates AWS SDK clients
 * THROWS: Error when required config is missing
 * IDEMPOTENT: yes, client construction only
 *
 * @returns Textract, S3, and runtime configuration
 */
export function createLiveTextractDependencies(): {
  textract: TextractGateway
  s3: S3StagingGateway
  config: TextractRuntimeConfig
} {
  const config = readTextractRuntimeConfig()
  return {
    textract: createAwsTextractGateway(config),
    s3: createAwsS3StagingGateway(config),
    config,
  }
}

function stagingKey(input: {
  prefix: string
  caseId: string
  documentId: string
  jobId: string
  storagePath: string
}): string {
  const cleanedPrefix = input.prefix.replace(/^\/+|\/+$/gu, '')
  const filename = input.storagePath.split('/').filter(Boolean).at(-1) ?? 'document'
  return `${cleanedPrefix}/${input.caseId}/${input.documentId}/${input.jobId}/${filename}`
}

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function pollAsyncAnalysis(input: {
  textract: TextractGateway
  jobId: string
  pollIntervalMs: number
  timeoutMs: number
}): Promise<TextractBlock[]> {
  const startedAt = Date.now()
  const blocks: TextractBlock[] = []
  let nextToken: string | undefined

  while (Date.now() - startedAt <= input.timeoutMs) {
    const page = await input.textract.getAnalysisPage(input.jobId, nextToken)

    if (page.status === 'FAILED' || page.status === 'PARTIAL_SUCCESS') {
      throw new Error(page.statusMessage ?? `Textract async job ended with ${page.status}`)
    }

    if (page.status === 'SUCCEEDED') {
      blocks.push(...page.blocks)
      if (page.nextToken) {
        nextToken = page.nextToken
        continue
      }

      return blocks
    }

    await sleep(input.pollIntervalMs)
  }

  throw new Error('Textract async polling timed out')
}

function resultFromBlocks(input: {
  blocks: TextractBlock[]
  mode: 'sync_image_bytes' | 'async_s3_document_location'
}): ExtractionResult {
  const confidence = calculateWordConfidence(input.blocks)
  if (confidence === null || confidence < OCR_CONFIDENCE_THRESHOLD) {
    return {
      status: 'manual_required',
      mode: 'manual_required',
      reason: 'Textract confidence is below the manual-review threshold.',
      confidence,
    }
  }

  return {
    status: 'succeeded',
    mode: input.mode,
    blocks: input.blocks,
    confidence,
    hasTables: hasTableBlock(input.blocks),
    hasHandwriting: hasHandwritingBlock(input.blocks),
  }
}

/**
 * Extracts a document through Textract or returns a manual-required result.
 *
 * The adapter never persists raw Textract responses. Callers receive normalized block data only and
 * decide how to persist the final structured `extracted_json`.
 *
 * SIDE EFFECTS: downloads from Supabase Storage, may stage/delete an S3 handoff object, may call Textract
 * THROWS: none for expected OCR failures; unexpected errors become manual_required results
 * IDEMPOTENT: no for live Textract async job creation, but staging keys are deterministic per job
 *
 * @param input - Document metadata and injectable gateways
 * @returns Textract extraction result or manual-required fallback
 */
export async function extractDocument(input: ExtractDocumentInput): Promise<ExtractionResult> {
  const route = selectExtractionRoute({
    mimeType: input.mimeType,
    pageCount: input.pageCount,
    fileSizeBytes: input.fileSizeBytes,
  })

  if (route.mode === 'manual_required') {
    return {
      status: 'manual_required',
      mode: 'manual_required',
      reason: route.reason ?? 'Document requires manual extraction.',
      confidence: null,
    }
  }

  let documentBytes: Buffer
  try {
    documentBytes = await input.storage.download(input.storagePath)
  } catch (error) {
    return {
      status: 'manual_required',
      mode: 'manual_required',
      reason: `Document is unreadable from canonical storage: ${
        error instanceof Error ? error.message : String(error)
      }`,
      confidence: null,
    }
  }

  try {
    if (route.mode === 'sync_image_bytes') {
      const blocks = await input.textract.analyzeBytes(documentBytes)
      return resultFromBlocks({ blocks, mode: route.mode })
    }

    const config = mergedConfig(input.config)
    const stagedObject = {
      bucket: config.stagingBucket,
      key: stagingKey({
        prefix: config.stagingPrefix,
        caseId: input.caseId,
        documentId: input.documentId,
        jobId: input.jobId,
        storagePath: input.storagePath,
      }),
    }

    try {
      await input.s3.putObject({
        ...stagedObject,
        body: documentBytes,
        contentType: input.mimeType ?? 'application/octet-stream',
      })
      const jobId = await input.textract.startAnalysis(stagedObject)
      const blocks = await pollAsyncAnalysis({
        textract: input.textract,
        jobId,
        pollIntervalMs: config.asyncPollIntervalMs,
        timeoutMs: config.asyncTimeoutMs,
      })
      return resultFromBlocks({ blocks, mode: route.mode })
    } finally {
      await input.s3.deleteObject(stagedObject)
    }
  } catch (error) {
    return {
      status: 'manual_required',
      mode: 'manual_required',
      reason: `Textract is unavailable or could not process the document: ${
        error instanceof Error ? error.message : String(error)
      }`,
      confidence: null,
    }
  }
}
