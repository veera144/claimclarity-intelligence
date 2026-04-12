/**
 * @file request.ts
 * @module web/lib/request
 *
 * Request metadata helpers for privacy-preserving audit and consent capture.
 *
 * DEPENDENCIES:
 *   - none
 *
 * CALLED BY:
 *   - /apps/web/app/api/consents/route.ts
 *   - /apps/web/app/api/patients/delete-my-data/route.ts
 *
 * CALLS:
 *   - none
 */

/**
 * Extracts the best-effort client IP from proxy-aware request headers.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, derives a value from immutable request headers
 *
 * @param request - Incoming HTTP request
 * @returns The first forwarded IP address when present, otherwise null
 */
export function getRequestIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const [firstIp] = forwarded.split(',')
    return firstIp?.trim() || null
  }

  return request.headers.get('x-real-ip')
}

/**
 * Masks an IP address before it is stored.
 *
 * SIDE EFFECTS: none
 * THROWS: none
 * IDEMPOTENT: yes, deterministic for the same IP address
 *
 * @param ipAddress - Raw client IP address from request metadata
 * @returns A masked IP prefix, such as 192.168., or null when unavailable
 */
export function maskIpAddress(ipAddress: string | null): string | null {
  if (!ipAddress) {
    return null
  }

  if (ipAddress.includes(':')) {
    const [first, second] = ipAddress.split(':')
    return first && second ? `${first}:${second}:` : null
  }

  const [first, second] = ipAddress.split('.')
  return first && second ? `${first}.${second}.` : null
}
