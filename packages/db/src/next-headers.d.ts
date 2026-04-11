declare module 'next/headers' {
  import type { CookieOptions } from '@supabase/ssr'

  export type RequestCookie = {
    name: string
    value: string
  }

  export type RequestCookieStore = {
    getAll(): RequestCookie[]
    set(name: string, value: string, options?: CookieOptions): void
  }

  export function cookies(): Promise<RequestCookieStore> | RequestCookieStore
}
