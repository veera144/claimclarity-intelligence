import type { ReactElement } from 'react'

export default function DashboardPage(): ReactElement {
  return (
    <main className="min-h-screen bg-gradient-to-b from-stone-950 via-stone-900 to-stone-950 px-6 py-20">
      <div className="mx-auto max-w-5xl rounded-3xl border border-stone-800 bg-stone-900/80 p-10">
        <p className="text-sm uppercase tracking-[0.3em] text-emerald-300">Internal Dashboard</p>
        <h1 className="mt-4 text-3xl font-semibold text-white">Reviewer and expert shell</h1>
        <p className="mt-4 text-stone-300">
          Middleware protects every dashboard route and only allows reviewer, expert, or admin
          roles through.
        </p>
      </div>
    </main>
  )
}
