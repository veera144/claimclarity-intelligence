'use client'

import type { FormEvent, ReactElement } from 'react'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@claimclarity/db/client.browser'

import { PatientAuthShell } from '../../../components/patient-ui'

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
    <PatientAuthShell
      eyebrow="Patient sign up"
      title="Create your account"
      description="Set up secure access for your case, consent steps, report delivery, and outcome follow-up."
      asideTitle="How the pilot works"
      asideBody="You stay in control of the timeline. We do not start a case until you choose to begin and upload documents."
      asidePoints={[
        'Consent is reviewed before document upload opens.',
        'Human review remains required before any report is delivered.',
        'You can return later to finish uploads or share an outcome update.',
      ]}
    >
      <form onSubmit={handleSubmit}>
        <p className="patient-eyebrow">Secure account setup</p>
        <h2 className="mt-3 text-2xl font-semibold text-navy-950">Create a patient login</h2>
        <p className="mt-3 patient-copy">
          Use an email address you can access during the pilot.
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
            minLength={8}
            required
          />
        </label>
        <p className="mt-3 text-sm text-navy-600">Use at least 8 characters.</p>
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
          {isPending ? 'Creating account...' : 'Sign up'}
        </button>
        <p className="mt-5 text-sm text-navy-600">
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      </form>
    </PatientAuthShell>
  )
}
