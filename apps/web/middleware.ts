import { NextResponse, type NextRequest } from 'next/server'

import { getMissingConsentTypes } from './lib/consent'
import { createMiddlewareClient } from './lib/supabase/middleware'

const PROTECTED_PREFIX = '/app'
const CONSENT_PROTECTED_PREFIX = '/app/upload'

export async function middleware(request: NextRequest): Promise<NextResponse> {
  if (!request.nextUrl.pathname.startsWith(PROTECTED_PREFIX)) {
    return NextResponse.next()
  }

  const { response, supabase, userId } = await createMiddlewareClient(request)

  if (!userId) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (request.nextUrl.pathname.startsWith(CONSENT_PROTECTED_PREFIX)) {
    const missing = await getMissingConsentTypes({
      client: supabase,
      userId,
    })

    if (missing.length > 0) {
      return NextResponse.redirect(new URL('/app/consent', request.url))
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
