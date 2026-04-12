import type { ReactElement } from 'react'

export default function HomePage(): ReactElement {
  return (
    <main className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 px-6 py-20">
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <p className="text-sm uppercase tracking-[0.3em] text-sky-300">ClaimClarity</p>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-white">
          Module 0 scaffold for the patient-facing Next.js app.
        </h1>
        <p className="max-w-2xl text-lg text-slate-300">
          The public shell, login route, authenticated app area, and Supabase SSR middleware are in
          place for later modules.
        </p>
        <div className="flex gap-4 text-sm text-slate-300">
          <a href="/login">Login</a>
          <a href="/app">Open protected area</a>
        </div>
      </div>
    </main>
  )
}
