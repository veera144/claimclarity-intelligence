'use client'

import type { FormEvent, ReactElement } from 'react'
import { useState, useTransition } from 'react'
import { createBrowserClient } from '@claimclarity/db'

export default function ForgotPasswordPage(): ReactElement {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setMessage(null)

    startTransition(() => {
      void (async () => {
        const supabase = createBrowserClient()
        await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/api/auth/callback?next=/app/reset-password`,
        })
        setMessage('If an account exists, a reset link has been sent.')
      })()
    })
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/80 p-8 shadow-2xl shadow-slate-950"
      >
        <p className="text-sm uppercase tracking-[0.3em] text-sky-300">Password Reset</p>
        <h1 className="mt-4 text-3xl font-semibold text-white">Reset your password</h1>
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
        {message ? <p className="mt-4 text-sm text-slate-300">{message}</p> : null}
        <button
          className="mt-6 w-full rounded-xl bg-sky-300 px-4 py-3 font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
          type="submit"
          disabled={isPending}
        >
          {isPending ? 'Sending...' : 'Send reset link'}
        </button>
      </form>
    </main>
  )
}
