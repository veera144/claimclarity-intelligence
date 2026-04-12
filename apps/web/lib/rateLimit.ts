/**
 * @file rateLimit.ts
 * @module web/lib/rate-limit
 *
 * Public API rate limiting with optional Upstash Redis and in-memory pilot fallback.
 *
 * DEPENDENCIES:
 *   - @upstash/ratelimit
 *   - @upstash/redis
 *   - /apps/web/lib/request.ts
 *
 * CALLED BY:
 *   - /apps/web/app/api/auth/callback/route.ts
 *   - /apps/web/app/api/consents/route.ts
 *   - /apps/web/app/api/patients/delete-my-data/route.ts
 *
 * CALLS:
 *   - Upstash rate-limit when configured
 */

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

import { getRequestIp } from './request'

type RateLimitKind = 'auth' | 'upload'

type MemoryBucket = {
  resetAt: number
  count: number
}

const memoryBuckets = new Map<string, MemoryBucket>()

const RATE_LIMIT_CONFIG: Record<RateLimitKind, { maxRequests: number; windowMs: number }> = {
  auth: { maxRequests: 10, windowMs: 10_000 },
  upload: { maxRequests: 30, windowMs: 60_000 },
}

function getUpstashLimiter(kind: RateLimitKind): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN

  if (!url || !token) {
    return null
  }

  const redis = new Redis({ url, token })
  const limiter =
    kind === 'auth' ? Ratelimit.slidingWindow(10, '10 s') : Ratelimit.slidingWindow(30, '60 s')

  return new Ratelimit({
    redis,
    limiter,
    prefix: `claimclarity:${kind}`,
  })
}

function checkMemoryLimit(kind: RateLimitKind, identifier: string): boolean {
  const config = RATE_LIMIT_CONFIG[kind]
  const key = `${kind}:${identifier}`
  const now = Date.now()
  const current = memoryBuckets.get(key)

  if (!current || current.resetAt <= now) {
    memoryBuckets.set(key, {
      count: 1,
      resetAt: now + config.windowMs,
    })
    return true
  }

  if (current.count >= config.maxRequests) {
    return false
  }

  current.count += 1
  return true
}

/**
 * Applies the configured public route rate limit.
 *
 * SIDE EFFECTS: writes to Redis when Upstash is configured, otherwise mutates in-memory counters
 * THROWS: never, falls back to in-memory limiting when Redis fails
 * IDEMPOTENT: no, each call consumes one quota unit
 *
 * @param request - Incoming public API request
 * @param kind - Rate-limit profile to apply
 * @returns Null when allowed, otherwise a 429 Response
 */
export async function rateLimitRequest(
  request: Request,
  kind: RateLimitKind
): Promise<Response | null> {
  const identifier = getRequestIp(request) ?? 'unknown'
  const upstashLimiter = getUpstashLimiter(kind)

  if (upstashLimiter) {
    try {
      const result = await upstashLimiter.limit(identifier)
      if (!result.success) {
        return Response.json({ error: 'Too many requests' }, { status: 429 })
      }
      return null
    } catch (error) {
      console.error('[rate-limit] Upstash failed; using in-memory fallback', error)
    }
  }

  return checkMemoryLimit(kind, identifier)
    ? null
    : Response.json({ error: 'Too many requests' }, { status: 429 })
}
