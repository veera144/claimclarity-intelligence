/**
 * @file report-pdf.ts
 * @module processor/reports
 *
 * Renders the Module 8 approved patient report as a private PDF.
 *
 * DEPENDENCIES:
 *   - @react-pdf/renderer (server-side PDF rendering)
 *   - @fontsource/ibm-plex-sans (local font files)
 *   - /apps/processor/src/reports/approved-report-content.ts
 *
 * CALLED BY:
 *   - /apps/processor/src/jobs/reportGenerationJob.ts
 *   - /apps/processor/tests/module8.test.ts
 *
 * CALLS:
 *   - @react-pdf/renderer renderToBuffer
 */

import { createRequire } from 'node:module'

import {
  Document,
  Font,
  Page,
  StyleSheet,
  Text,
  View,
  renderToBuffer,
} from '@react-pdf/renderer'
import React, { type ReactElement } from 'react'

import {
  CANNOT_TELL_YOU_ITEMS,
  MODULE8_REQUIRED_SECTION_HEADINGS,
  type ApprovedAppealPoint,
  type ApprovedReportContent,
  type ReportTableRow,
} from './approved-report-content'

const require = createRequire(import.meta.url)
const FONT_FAMILY = 'IBM Plex Sans'
const DISCLAIMER = 'INFORMATIONAL SUPPORT ONLY — NOT INSURANCE, LEGAL, OR MEDICAL ADVICE'
const FOOTER =
  'IRDAI Bima Bharosa reference: bimabharosa.irdai.gov.in. This report is informational support only and is not insurance, legal, or medical advice.'

const styles = StyleSheet.create({
  page: {
    padding: '20mm',
    paddingTop: 78,
    paddingBottom: 58,
    fontFamily: FONT_FAMILY,
    color: '#111111',
    fontSize: 9,
    lineHeight: 1.35,
  },
  fixedHeader: {
    position: 'absolute',
    top: 24,
    left: '20mm',
    right: '20mm',
    borderBottomWidth: 1,
    borderBottomColor: '#d8d8d8',
    paddingBottom: 8,
  },
  fixedFooter: {
    position: 'absolute',
    bottom: 22,
    left: '20mm',
    right: '20mm',
    borderTopWidth: 1,
    borderTopColor: '#d8d8d8',
    paddingTop: 6,
    fontSize: 7,
    color: '#444444',
  },
  title: {
    fontSize: 13,
    fontWeight: 700,
  },
  meta: {
    marginTop: 3,
    fontSize: 8,
  },
  disclaimer: {
    marginTop: 3,
    fontSize: 7,
    fontWeight: 700,
  },
  section: {
    marginBottom: 13,
  },
  heading: {
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 6,
  },
  paragraph: {
    marginBottom: 5,
  },
  listItem: {
    marginBottom: 3,
  },
  table: {
    borderWidth: 1,
    borderColor: '#d0d0d0',
  },
  row: {
    flexDirection: 'row',
  },
  headerCell: {
    flex: 1,
    padding: 5,
    fontSize: 7,
    fontWeight: 700,
    backgroundColor: '#eeeeee',
    borderRightWidth: 1,
    borderRightColor: '#d0d0d0',
  },
  cell: {
    flex: 1,
    padding: 5,
    fontSize: 7,
    borderRightWidth: 1,
    borderRightColor: '#d0d0d0',
  },
  altRow: {
    backgroundColor: '#f7f7f7',
  },
  letterBox: {
    borderWidth: 1,
    borderColor: '#111111',
    padding: 8,
    marginTop: 4,
  },
  letterLabel: {
    fontSize: 8,
    fontWeight: 700,
    marginBottom: 5,
  },
})

function registerFonts(): void {
  Font.register({
    family: FONT_FAMILY,
    fonts: [
      {
        src: require.resolve('@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff'),
        fontWeight: 400,
      },
      {
        src: require.resolve('@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff'),
        fontWeight: 700,
      },
    ],
  })
}

function h(
  type: React.ElementType,
  props: Record<string, unknown>,
  ...children: React.ReactNode[]
): ReactElement {
  return React.createElement(type, props, ...children)
}

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(date)
}

function strengthStars(strength: ApprovedAppealPoint['strength']): string {
  if (strength === 'strong') return '★★★'
  if (strength === 'moderate') return '★★'
  return '★'
}

function section(heading: string, children: React.ReactNode): ReactElement {
  return h(
    View,
    { style: styles.section },
    h(Text, { style: styles.heading }, heading),
    children
  )
}

function bulletList(items: readonly string[]): ReactElement {
  return h(
    View,
    {},
    ...items.map((item, index) =>
      h(Text, { key: `${String(index)}-${item}`, style: styles.listItem }, `${String(index + 1)}. ${item}`)
    )
  )
}

function textLines(text: string): ReactElement {
  return h(
    View,
    {},
    ...text.split('\n').map((line, index) =>
      h(Text, { key: `${String(index)}-${line}`, style: styles.paragraph }, line || ' ')
    )
  )
}

function table(headers: readonly string[], rows: readonly string[][]): ReactElement {
  const bodyRows = rows.length > 0 ? rows : [headers.map(() => 'No reviewer-approved rows.')]
  return h(
    View,
    { style: styles.table },
    h(
      View,
      { style: styles.row },
      ...headers.map((header) => h(Text, { key: header, style: styles.headerCell }, header))
    ),
    ...bodyRows.map((row, rowIndex) =>
      h(
        View,
        {
          key: `row-${String(rowIndex)}`,
          style: rowIndex % 2 === 1 ? [styles.row, styles.altRow] : styles.row,
        },
        ...row.map((cell, cellIndex) =>
          h(Text, { key: `${String(rowIndex)}-${String(cellIndex)}`, style: styles.cell }, cell)
        )
      )
    )
  )
}

function coveredRows(rows: ReportTableRow[]): string[][] {
  return rows.map((row) => [row.billItem, row.billedAmount, row.policyClause, row.confidence])
}

function deductedRows(rows: ReportTableRow[]): string[][] {
  return rows.map((row) => [
    row.billItem,
    row.billedAmount,
    row.likelyDeduction,
    row.reasonSummary,
    row.confidence,
  ])
}

function appealRows(rows: ApprovedAppealPoint[]): string[][] {
  return rows.map((row) => [row.point, strengthStars(row.strength), row.basis])
}

function ReportDocument({ content }: { content: ApprovedReportContent }): ReactElement {
  const missingDocsText =
    content.missingDocuments.length > 0
      ? content.missingDocuments
      : ['No additional documents appear to be required.']

  return React.createElement(
    Document,
    { title: `ClaimClarity Report ${content.caseRef}` },
    React.createElement(
      Page,
      { size: 'A4', style: styles.page },
      h(
        View,
        { fixed: true, style: styles.fixedHeader },
        h(Text, { style: styles.title }, 'ClaimClarity — Claim Analysis Report'),
        h(
          Text,
          { style: styles.meta },
          `Case Ref: ${content.caseRef} | Date: ${formatDate(content.deliveryDate)}`
        ),
        h(Text, { style: styles.disclaimer }, DISCLAIMER)
      ),
      h(Text, { fixed: true, style: styles.fixedFooter }, FOOTER),
      section(
        MODULE8_REQUIRED_SECTION_HEADINGS[0],
        h(
          View,
          {},
          h(
            Text,
            { style: styles.paragraph },
            `Documents reviewed: ${
              content.documentsReviewed.length > 0
                ? content.documentsReviewed.join(', ')
                : 'No documents marked reviewed.'
            }`
          ),
          h(Text, { style: styles.paragraph }, `Missing docs: ${missingDocsText.join(', ')}`),
          content.isPartial
            ? h(
                Text,
                { style: styles.paragraph },
                `Partial report: ${content.partialReason ?? 'Reason not stated.'}`
              )
            : null
        )
      ),
      section(
        MODULE8_REQUIRED_SECTION_HEADINGS[1],
        table(
          ['Bill Item', 'Billed Amount', 'Policy Clause', 'Confidence'],
          coveredRows(content.likelyCovered)
        )
      ),
      section(
        MODULE8_REQUIRED_SECTION_HEADINGS[2],
        table(
          ['Bill Item', 'Billed Amount', 'Likely Deduction', 'Reason Summary', 'Confidence'],
          deductedRows(content.likelyDeducted)
        )
      ),
      section(
        MODULE8_REQUIRED_SECTION_HEADINGS[3],
        h(
          View,
          {},
          h(Text, { style: styles.paragraph }, 'Verify against your specific policy wording.'),
          ...(
            content.deductionExplanations.length > 0
              ? content.deductionExplanations
              : ['No reviewer-approved deductions were identified.']
          ).map((item, index) =>
            h(Text, { key: `${String(index)}-${item}`, style: styles.paragraph }, item)
          )
        )
      ),
      section(MODULE8_REQUIRED_SECTION_HEADINGS[4], bulletList(content.hospitalQuestions)),
      section(MODULE8_REQUIRED_SECTION_HEADINGS[5], bulletList(content.insurerQuestions)),
      section(MODULE8_REQUIRED_SECTION_HEADINGS[6], bulletList(missingDocsText)),
      section(
        MODULE8_REQUIRED_SECTION_HEADINGS[7],
        table(['Appeal Point', 'Strength (★★★/★★/★)', 'Basis'], appealRows(content.appealPoints))
      ),
      section(
        MODULE8_REQUIRED_SECTION_HEADINGS[8],
        h(
          View,
          { style: styles.letterBox },
          h(Text, { style: styles.letterLabel }, 'DRAFT — Review before sending'),
          h(
            Text,
            { style: styles.paragraph },
            '[PATIENT_NAME] | [DATE]'
          ),
          textLines(content.appealLetterDraft),
          h(
            Text,
            { style: styles.paragraph },
            'This draft is based solely on the findings in this report. Not legal correspondence.'
          )
        )
      ),
      section(MODULE8_REQUIRED_SECTION_HEADINGS[9], bulletList(CANNOT_TELL_YOU_ITEMS))
    )
  )
}

/**
 * Creates a PDF buffer using server-side @react-pdf/renderer.
 *
 * SIDE EFFECTS: registers local IBM Plex Sans fonts with the renderer
 * THROWS: Error when PDF rendering fails
 * IDEMPOTENT: yes for identical content
 *
 * @param content - Approved patient-facing report content
 * @returns Rendered PDF bytes
 */
export async function renderReportPdfBuffer(content: ApprovedReportContent): Promise<Buffer> {
  registerFonts()
  const document = React.createElement(ReportDocument, {
    content,
  }) as Parameters<typeof renderToBuffer>[0]
  return renderToBuffer(document)
}

/**
 * Exposes report text headings for executable checkpoint assertions.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, pure projection
 *
 * @param content - Approved patient-facing report content
 * @returns Searchable text from the report model
 */
export function getReportSearchText(content: ApprovedReportContent): string {
  return [
    ...MODULE8_REQUIRED_SECTION_HEADINGS,
    ...CANNOT_TELL_YOU_ITEMS,
    ...content.documentsReviewed,
    ...content.missingDocuments,
    ...content.likelyCovered.flatMap((row) => [
      row.billItem,
      row.billedAmount,
      row.policyClause,
      row.confidence,
    ]),
    ...content.likelyDeducted.flatMap((row) => [
      row.billItem,
      row.billedAmount,
      row.likelyDeduction,
      row.reasonSummary,
      row.confidence,
    ]),
    ...content.deductionExplanations,
    ...content.hospitalQuestions,
    ...content.insurerQuestions,
    ...content.appealPoints.flatMap((row) => [row.point, row.strength, row.basis]),
    content.appealLetterDraft,
    FOOTER,
    DISCLAIMER,
  ].join('\n')
}
