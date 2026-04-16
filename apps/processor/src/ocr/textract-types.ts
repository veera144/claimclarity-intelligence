/**
 * @file textract-types.ts
 * @module processor/ocr
 *
 * Shared Textract adapter types used by Module 4 extraction and tests.
 *
 * DEPENDENCIES:
 *   - none
 *
 * CALLED BY:
 *   - /apps/processor/src/ocr/textract-client.ts
 *   - /apps/processor/src/extraction/*.ts
 *
 * CALLS:
 *   - none
 */

export const TextractBlockType = {
  LINE: 'LINE',
  WORD: 'WORD',
  TABLE: 'TABLE',
  CELL: 'CELL',
  KEY_VALUE_SET: 'KEY_VALUE_SET',
  SELECTION_ELEMENT: 'SELECTION_ELEMENT',
} as const

export type TextractBlockType = (typeof TextractBlockType)[keyof typeof TextractBlockType]

export const TextractTextType = {
  HANDWRITING: 'HANDWRITING',
  PRINTED: 'PRINTED',
} as const

export type TextractTextType = (typeof TextractTextType)[keyof typeof TextractTextType]

export type TextractRelationship = {
  type: string
  ids: string[]
}

export type TextractBlock = {
  id: string
  blockType: string
  text?: string
  confidence?: number
  page?: number
  rowIndex?: number
  columnIndex?: number
  relationships?: TextractRelationship[]
  entityTypes?: string[]
  textType?: string
}

export type TextractAnalysis = {
  blocks: TextractBlock[]
  confidence: number | null
  hasTables: boolean
  hasHandwriting: boolean
}

export type ExtractionMode =
  | 'sync_image_bytes'
  | 'async_s3_document_location'
  | 'manual_required'

export type ExtractionSuccess = TextractAnalysis & {
  status: 'succeeded'
  mode: Exclude<ExtractionMode, 'manual_required'>
}

export type ExtractionManualRequired = {
  status: 'manual_required'
  mode: 'manual_required'
  reason: string
  confidence: number | null
}

export type ExtractionResult = ExtractionSuccess | ExtractionManualRequired

export type NormalizedExtractionValue =
  | string
  | number
  | boolean
  | null
  | NormalizedExtractionValue[]
  | { [key: string]: NormalizedExtractionValue | undefined }

export type NormalizedExtractionJson = {
  schema_version: 'module4.v1'
  extraction_source: 'textract' | 'manual'
  doc_type: string
  confidence: number | null
  has_tables: boolean
  has_handwriting: boolean
  data: { [key: string]: NormalizedExtractionValue | undefined }
}

/**
 * Calculates the average confidence for WORD blocks only.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, pure calculation
 *
 * @param blocks - Normalized Textract blocks from one document
 * @returns Average WORD confidence in 0..1 form, or null when no WORD confidence exists
 */
export function calculateWordConfidence(blocks: TextractBlock[]): number | null {
  const wordConfidences = blocks
    .filter((block) => block.blockType === TextractBlockType.WORD)
    .map((block) => block.confidence)
    .filter((confidence): confidence is number => typeof confidence === 'number')

  if (wordConfidences.length === 0) {
    return null
  }

  const averagePercent =
    wordConfidences.reduce((sum, confidence) => sum + confidence, 0) / wordConfidences.length
  return Math.round((averagePercent / 100) * 1000) / 1000
}

/**
 * Reports whether a Textract block list contains any TABLE block.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, pure predicate
 *
 * @param blocks - Normalized Textract blocks from one document
 * @returns True when a TABLE block exists
 */
export function hasTableBlock(blocks: TextractBlock[]): boolean {
  return blocks.some((block) => block.blockType === TextractBlockType.TABLE)
}

/**
 * Reports whether any WORD block is marked as handwriting.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, pure predicate
 *
 * @param blocks - Normalized Textract blocks from one document
 * @returns True when Textract marked any text as handwriting
 */
export function hasHandwritingBlock(blocks: TextractBlock[]): boolean {
  return blocks.some((block) => block.textType === TextractTextType.HANDWRITING)
}
