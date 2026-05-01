'use client'

import type { FormEvent, ReactElement } from 'react'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@claimclarity/db/client.browser'

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
    <main className="internal-page flex items-center">
      <div className="internal-shell">
        <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <section className="internal-surface flex flex-col justify-between bg-navy-950 p-8 text-white sm:p-10">
            <div>
              <p className="internal-eyebrow text-teal-300">Dashboard sign in</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight">Internal access</h1>
              <p className="mt-4 max-w-xl text-sm leading-7 text-navy-100 sm:text-base">
                Reviewer, expert, and admin access stays separate from patient routes. Use your internal account credentials to continue.
              </p>
            </div>
            <div className="mt-8 rounded-3xl bg-navy-900 p-6">
              <p className="text-lg font-semibold">Before you enter</p>
              <ul className="mt-4 grid gap-3 text-sm text-navy-100">
                <li className="flex gap-3">
                  <span className="mt-1 h-2.5 w-2.5 rounded-full bg-teal-400" />
                  <span>Reviewers see assigned cases only.</span>
                </li>
                <li className="flex gap-3">
                  <span className="mt-1 h-2.5 w-2.5 rounded-full bg-teal-400" />
                  <span>AI-assisted output stays internal until reviewer sign-off.</span>
                </li>
                <li className="flex gap-3">
                  <span className="mt-1 h-2.5 w-2.5 rounded-full bg-teal-400" />
                  <span>Manual fallback and admin controls remain role-gated.</span>
                </li>
              </ul>
            </div>
          </section>

          <form onSubmit={handleSubmit} className="internal-surface p-8 sm:p-10">
            <p className="internal-eyebrow">Secure dashboard access</p>
            <h2 className="mt-3 text-2xl font-semibold text-navy-950">Sign in to continue</h2>
            <p className="mt-3 internal-copy">Use your internal account email and password.</p>
            <label className="mt-8 block text-sm font-medium text-navy-800">
              Email address
              <input
                className="internal-input mt-2"
                type="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value)
                }}
                required
              />
            </label>
            <label className="mt-5 block text-sm font-medium text-navy-800">
              Password
              <input
                className="internal-input mt-2"
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value)
                }}
                required
              />
            </label>
            {error ? (
              <p className="mt-4 rounded-2xl border border-deducted-500/25 bg-deducted-50 px-4 py-3 text-sm text-deducted-700">
                {error}
              </p>
            ) : null}
            <button
              className="internal-primary-button mt-6 w-full"
              type="submit"
              disabled={isPending}
            >
              {isPending ? 'Signing in...' : 'Sign in'}
            </button>
            <p className="mt-5 text-sm text-slate-600">
              Patient access lives in the separate{' '}
              <Link href="http://localhost:3000/login">patient portal</Link>.
            </p>
          </form>
        </div>
      </div>
    </main>
  )
}
