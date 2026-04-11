import type { ReactElement } from 'react'

export default function AccessDeniedPage(): ReactElement {
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-950 px-6">
      <div className="w-full max-w-lg rounded-3xl border border-red-900/50 bg-stone-900/80 p-8">
        <p className="text-sm uppercase tracking-[0.3em] text-red-300">Access Denied</p>
        <h1 className="mt-4 text-3xl font-semibold text-white">
          This dashboard is restricted to internal ClaimClarity roles.
        </h1>
        <p className="mt-4 text-sm text-stone-300">
          Reviewer, expert, or admin access is required to continue.
        </p>
      </div>
    </main>
  )
}
