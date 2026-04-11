import { NextResponse, type NextRequest } from 'next/server'

import { createMiddlewareClient } from './lib/supabase/middleware'

const PROTECTED_PREFIX = '/app'

export async function middleware(request: NextRequest): Promise<NextResponse> {
  if (!request.nextUrl.pathname.startsWith(PROTECTED_PREFIX)) {
    return NextResponse.next()
  }

  const { response, userId } = await createMiddlewareClient(request)

  if (!userId) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
}
