/**
 * @file textract-block-utils.ts
 * @module processor/extraction
 *
 * Helpers for reading normalized Textract block relationships.
 *
 * DEPENDENCIES:
 *   - /apps/processor/src/ocr/textract-types.ts
 *
 * CALLED BY:
 *   - /apps/processor/src/extraction/*.ts
 *
 * CALLS:
 *   - none
 */

import { TextractBlockType, type TextractBlock } from '../ocr/textract-types'

/**
 * Builds a lookup map by Textract block id.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, pure transformation
 *
 * @param blocks - Normalized Textract blocks
 * @returns Block lookup map
 */
export function blocksById(blocks: TextractBlock[]): Map<string, TextractBlock> {
  return new Map(blocks.map((block) => [block.id, block]))
}

function childIds(block: TextractBlock): string[] {
  return block.relationships?.find((relationship) => relationship.type === 'CHILD')?.ids ?? []
}

/**
 * Resolves the visible text for a Textract block from its direct text or CHILD relationships.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, pure transformation
 *
 * @param block - Block whose text should be resolved
 * @param lookup - Block lookup map for CHILD relationships
 * @returns Human-readable block text
 */
export function textForBlock(block: TextractBlock, lookup: Map<string, TextractBlock>): string {
  if (block.text) {
    return block.text.trim()
  }

  return childIds(block)
    .map((id) => lookup.get(id))
    .filter((child): child is TextractBlock => Boolean(child))
    .filter(
      (child) =>
        child.blockType === TextractBlockType.WORD ||
        child.blockType === TextractBlockType.SELECTION_ELEMENT
    )
    .map((child) => child.text ?? '')
    .filter(Boolean)
    .join(' ')
    .trim()
}

/**
 * Extracts rows from Textract TABLE/CELL relationships.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, pure transformation
 *
 * @param blocks - Normalized Textract blocks
 * @returns Table rows with page metadata
 */
export function extractTableRows(blocks: TextractBlock[]): Array<{ page: number; cells: string[] }> {
  const lookup = blocksById(blocks)
  const rows: Array<{ page: number; cells: string[] }> = []

  for (const table of blocks.filter((block) => block.blockType === TextractBlockType.TABLE)) {
    const cells = childIds(table)
      .map((id) => lookup.get(id))
      .filter((block): block is TextractBlock => Boolean(block))
      .filter((block) => block.blockType === TextractBlockType.CELL)

    const byRow = new Map<number, Array<{ column: number; text: string }>>()
    for (const cell of cells) {
      const rowIndex = cell.rowIndex ?? 0
      const columnIndex = cell.columnIndex ?? 0
      const rowCells = byRow.get(rowIndex) ?? []
      rowCells.push({ column: columnIndex, text: textForBlock(cell, lookup) })
      byRow.set(rowIndex, rowCells)
    }

    Array.from(byRow.entries())
      .sort(([left], [right]) => left - right)
      .forEach(([, rowCells]) => {
        rows.push({
          page: table.page ?? 1,
          cells: rowCells.sort((left, right) => left.column - right.column).map((cell) => cell.text),
        })
      })
  }

  return rows
}

/**
 * Extracts LINE text blocks in document order.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, pure transformation
 *
 * @param blocks - Normalized Textract blocks
 * @returns Non-empty line texts
 */
export function extractLines(blocks: TextractBlock[]): string[] {
  return blocks
    .filter((block) => block.blockType === TextractBlockType.LINE)
    .map((block) => block.text?.trim() ?? '')
    .filter(Boolean)
}

