/**
 * @file config.ts
 * @module shared/config
 *
 * Fail-fast environment configuration for the ClaimClarity monorepo.
 *
 * DEPENDENCIES:
 *   - process.env (runtime configuration source)
 *
 * CALLED BY:
 *   - /apps/processor/src/index.ts
 *
 * CALLS:
 *   - none
 */

/**
 * Reads a required environment variable and throws when it is missing.
 *
 * SIDE EFFECTS: none
 * THROWS: Error when the requested environment variable is unset
 * IDEMPOTENT: yes, reads process state only
 *
 * @param name - Environment variable name to resolve
 * @returns The resolved non-empty environment variable value
 */
export function requireEnv(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`)
  }

  return value
}

export const config = {
  supabase: {
    url: requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    anonKey: requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    serviceRoleKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  },
  anthropic: {
    apiKey: requireEnv('ANTHROPIC_API_KEY'),
    model: 'claude-sonnet-4-20250514' as const
  },
  razorpay: {
    keyId: requireEnv('RAZORPAY_KEY_ID'),
    keySecret: requireEnv('RAZORPAY_KEY_SECRET'),
    webhookSecret: requireEnv('RAZORPAY_WEBHOOK_SECRET')
  },
  resend: {
    apiKey: requireEnv('RESEND_API_KEY'),
    fromEmail: requireEnv('RESEND_FROM_EMAIL'),
    adminEmail: requireEnv('ADMIN_EMAIL')
  },
  app: {
    url: requireEnv('NEXT_PUBLIC_APP_URL'),
    dashboardUrl: requireEnv('NEXT_PUBLIC_DASHBOARD_URL'),
    privacyVersion: requireEnv('PRIVACY_POLICY_VERSION'),
    termsVersion: requireEnv('TERMS_VERSION')
  }
} as const

/**
 * Forces all required environment variables to resolve before the processor starts.
 *
 * SIDE EFFECTS: writes a startup confirmation to stdout
 * THROWS: Error when any required environment variable is missing
 * IDEMPOTENT: yes, resolves static process environment only
 *
 * @returns Nothing
 */
export function validateConfig(): void {
  Object.values(config).forEach(section => {
    Object.values(section).forEach(value => {
      void value
    })
  })

  console.log('[Config] All required environment variables present.')
}

