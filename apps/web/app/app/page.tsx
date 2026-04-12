import type { ReactElement } from 'react'

export default function AppPage(): ReactElement {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-20">
      <div className="mx-auto max-w-4xl rounded-3xl border border-slate-800 bg-slate-900/80 p-10">
        <p className="text-sm uppercase tracking-[0.3em] text-sky-300">Protected</p>
        <h1 className="mt-4 text-3xl font-semibold text-white">Patient application shell</h1>
        <p className="mt-4 text-slate-300">
          Middleware protects this route and refreshes the Supabase session on every request.
        </p>
      </div>
    </main>
  )
}
