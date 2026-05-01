'use client'

import type { FormEvent, ReactElement } from 'react'
import { Suspense, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '@claimclarity/db/client.browser'

import { PatientAuthShell } from '../../../components/patient-ui'

function LoginForm(): ReactElement {
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
    <PatientAuthShell
      eyebrow="Patient sign in"
      title="Welcome back"
      description="Sign in to continue your case, review your status, or open a delivered report."
      asideTitle="What to expect"
      asideBody="ClaimClarity keeps the workflow plain and human-reviewed. We show what is complete, what needs action, and what happens next."
      asidePoints={[
        'Reports stay behind login until reviewer sign-off is complete.',
        'You can return to the same case without starting over.',
        'Outcome sharing happens only after your report is delivered.',
      ]}
    >
      <form onSubmit={handleSubmit}>
        <p className="patient-eyebrow">Secure access</p>
        <h2 className="mt-3 text-2xl font-semibold text-navy-950">Sign in to your account</h2>
        <p className="mt-3 patient-copy">
          Use the email and password linked to your ClaimClarity case.
        </p>
        <label className="mt-8 patient-label">
          Email address
          <input
            className="patient-input"
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value)
            }}
            required
          />
        </label>
        <label className="mt-5 patient-label">
          Password
          <input
            className="patient-input"
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
          className="patient-primary-button mt-6 w-full"
          type="submit"
          disabled={isPending}
        >
          {isPending ? 'Signing in...' : 'Sign in'}
        </button>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm text-navy-600">
          <Link href="/signup">Create an account</Link>
          <Link href="/forgot-password">Forgot password?</Link>
        </div>
      </form>
    </PatientAuthShell>
  )
}

export default function LoginPage(): ReactElement {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}
