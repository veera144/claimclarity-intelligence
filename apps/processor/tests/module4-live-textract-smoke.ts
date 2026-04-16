/**
 * @file module4-live-textract-smoke.ts
 * @module processor/tests
 *
 * Pending live Textract smoke check for Module 4 AWS account activation.
 *
 * DEPENDENCIES:
 *   - @aws-sdk/client-textract
 *
 * CALLED BY:
 *   - pnpm smoke:textract
 *
 * CALLS:
 *   - AWS Textract only when TEXTRACT_LIVE_SMOKE=1
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { AnalyzeDocumentCommand, TextractClient } from '@aws-sdk/client-textract'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function loadRootEnv(): void {
  const content = readFileSync(resolve(rootDir, '.env.local'), 'utf8')
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) continue
    const key = line.slice(0, separatorIndex)
    const value = line.slice(separatorIndex + 1)
    if (!process.env[key]) process.env[key] = value
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Required environment variable ${name} is not set`)
  return value
}

const transparentPng = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
  0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 15, 4, 0, 9,
  251, 3, 253, 167, 180, 173, 109, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
])

async function main(): Promise<void> {
  loadRootEnv()

  if (process.env.TEXTRACT_LIVE_SMOKE !== '1') {
    console.log('LIVE TEXTRACT SMOKE: PENDING - set TEXTRACT_LIVE_SMOKE=1 after AWS activation')
    process.exit(0)
  }

  const client = new TextractClient({ region: requireEnv('AWS_REGION') })
  await client.send(
    new AnalyzeDocumentCommand({
      Document: { Bytes: transparentPng },
      FeatureTypes: ['TABLES', 'FORMS'],
    })
  )

  console.log('LIVE TEXTRACT SMOKE: PASS')
}

main().catch((error: unknown) => {
  console.error('LIVE TEXTRACT SMOKE: FAIL', error)
  process.exit(1)
})

