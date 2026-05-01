'use client'

import type { FormEvent, ReactElement } from 'react'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@claimclarity/db/client.browser'

export default function ResetPasswordPage(): ReactElement {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setError(null)

    startTransition(() => {
      void (async () => {
        const supabase = createBrowserClient()
        const { error: updateError } = await supabase.auth.updateUser({
          password,
        })

        if (updateError) {
          setError('Unable to update your password. Please request a new reset link.')
          return
        }

        router.push('/app/dashboard')
        router.refresh()
      })()
    })
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/80 p-8"
      >
        <p className="text-sm uppercase tracking-[0.3em] text-sky-300">New Password</p>
        <h1 className="mt-4 text-3xl font-semibold text-white">Choose a new password</h1>
        <label className="mt-8 block text-sm text-slate-200">
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
          {isPending ? 'Updating...' : 'Update password'}
        </button>
      </form>
    </main>
  )
}
