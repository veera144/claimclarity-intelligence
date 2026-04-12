'use client'

import type { FormEvent, ReactElement } from 'react'
import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@claimclarity/db'

export default function LoginPage(): ReactElement {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setError(null)

    startTransition(() => {
      void (async () => {
        const supabase = createBrowserClient()
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        })

        if (signInError) {
          setError('Unable to sign in. Please check your email and password.')
          return
        }

        router.push(searchParams.get('next') ?? '/app/dashboard')
        router.refresh()
      })()
    })
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl shadow-slate-950"
      >
        <p className="text-sm uppercase tracking-[0.3em] text-sky-300">Patient Login</p>
        <h1 className="mt-4 text-3xl font-semibold text-white">Welcome back</h1>
        <label className="mt-8 block text-sm text-slate-200">
          Email
          <input
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
            }}
            required
          />
        </label>
        <label className="mt-4 block text-sm text-slate-200">
          Password
          <input
            className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white"
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
            }}
            required
          />
        </label>
        {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
        <button
          className="mt-6 w-full rounded-xl bg-sky-300 px-4 py-3 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
          type="submit"
          disabled={isPending}
        >
          {isPending ? 'Signing in...' : 'Sign in'}
        </button>
        <div className="mt-5 flex justify-between text-sm text-slate-300">
          <a href="/signup">Sign up</a>
          <a href="/forgot-password">Forgot password?</a>
        </div>
      </form>
    </main>
  )
}
