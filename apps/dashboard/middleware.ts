import { NextResponse, type NextRequest } from 'next/server'

import { createMiddlewareClient } from './lib/supabase/middleware'

const PUBLIC_PATHS = new Set(['/login', '/access-denied'])

export async function middleware(request: NextRequest): Promise<NextResponse> {
  if (PUBLIC_PATHS.has(request.nextUrl.pathname)) {
    return NextResponse.next()
  }

  const { response, supabase, userId } = await createMiddlewareClient(request)

  if (!userId) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const { data, error } = await supabase.from('users').select('role').eq('id', userId).single()

  const isAllowedRole =
    data?.role === 'reviewer' || data?.role === 'expert' || data?.role === 'admin'

  if (error || !isAllowedRole) {
    return NextResponse.redirect(new URL('/access-denied', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
}
