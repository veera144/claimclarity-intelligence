'use client'

import type { FormEvent, ReactElement } from 'react'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@claimclarity/db'

export default function SignupPage(): ReactElement {
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
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/api/auth/callback?next=/app/consent`,
          },
        })

        if (signUpError) {
          setError('Unable to create your account. Please try again.')
          return
        }

        router.push('/app/consent')
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
        <p className="text-sm uppercase tracking-[0.3em] text-sky-300">Patient Signup</p>
        <h1 className="mt-4 text-3xl font-semibold text-white">Create your account</h1>
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
            minLength={8}
            required
          />
        </label>
        {error ? <p className="mt-4 text-sm text-red-300">{error}</p> : null}
        <button
          className="mt-6 w-full rounded-xl bg-sky-300 px-4 py-3 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
          type="submit"
          disabled={isPending}
        >
          {isPending ? 'Creating account...' : 'Sign up'}
        </button>
        <p className="mt-5 text-sm text-slate-300">
          Already have an account? <a href="/login">Sign in</a>
        </p>
      </form>
    </main>
  )
}
