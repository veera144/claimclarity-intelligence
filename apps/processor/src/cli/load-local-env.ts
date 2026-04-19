/**
 * @file load-local-env.ts
 * @module processor/cli
 *
 * Minimal CLI-only .env.local loader for local operator scripts.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function parseEnvLine(line: string): { key: string; value: string } | null {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return null
  const separatorIndex = trimmed.indexOf('=')
  if (separatorIndex <= 0) return null

  const key = trimmed.slice(0, separatorIndex).trim()
  const rawValue = trimmed.slice(separatorIndex + 1).trim()
  const value =
    (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
    (rawValue.startsWith("'") && rawValue.endsWith("'"))
      ? rawValue.slice(1, -1)
      : rawValue

  return key ? { key, value } : null
}

/**
 * Loads root .env.local values for one-shot local CLI commands.
 *
 * SIDE EFFECTS: populates missing process.env keys from .env.local
 * THROWS: never; absent files are allowed
 * IDEMPOTENT: yes, existing environment variables are not overwritten
 *
 * @returns Nothing
 */
export function loadLocalEnv(): void {
  const envPath = join(process.cwd(), '.env.local')
  if (!existsSync(envPath)) return

  const lines = readFileSync(envPath, 'utf8').split(/\r?\n/u)
  for (const line of lines) {
    const parsed = parseEnvLine(line)
    if (parsed && process.env[parsed.key] === undefined) {
      process.env[parsed.key] = parsed.value
    }
  }
}
