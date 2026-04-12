'use client'

import type { FormEvent, ReactElement } from 'react'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@claimclarity/db'

export default function DashboardLoginPage(): ReactElement {
  const router = useRouter()
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
          setError('Unable to sign in. Please check your internal account credentials.')
          return
        }

        router.push('/')
        router.refresh()
      })()
    })
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-950 px-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-3xl border border-stone-800 bg-stone-900/80 p-8"
      >
        <p className="text-sm uppercase tracking-[0.3em] text-emerald-300">Dashboard Login</p>
        <h1 className="mt-4 text-3xl font-semibold text-white">Sign in to the dashboard</h1>
        <label className="mt-8 block text-sm text-stone-200">
          Email
          <input
            className="mt-2 w-full rounded-xl border border-stone-700 bg-stone-950 px-4 py-3 text-white"
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
            }}
            required
          />
        </label>
        <label className="mt-4 block text-sm text-stone-200">
          Password
          <input
            className="mt-2 w-full rounded-xl border border-stone-700 bg-stone-950 px-4 py-3 text-white"
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
          className="mt-6 w-full rounded-xl bg-emerald-300 px-4 py-3 font-semibold text-stone-950 disabled:cursor-not-allowed disabled:opacity-50"
          type="submit"
          disabled={isPending}
        >
          {isPending ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
