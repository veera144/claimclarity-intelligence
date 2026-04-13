declare module 'next/headers' {
  export type RequestCookie = {
    name: string
    value: string
  }

  export type RequestCookieStore = {
    getAll(): RequestCookie[]
    set(
      name: string,
      value: string,
      options?: import('@supabase/ssr').CookieOptions
    ): void
  }

  export function cookies(): Promise<RequestCookieStore> | RequestCookieStore
}
