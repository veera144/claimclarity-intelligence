import type { ReactElement } from 'react'

export default function PatientDashboardPage(): ReactElement {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-20">
      <div className="mx-auto max-w-4xl rounded-3xl border border-slate-800 bg-slate-900/80 p-10">
        <p className="text-sm uppercase tracking-[0.3em] text-sky-300">Patient Dashboard</p>
        <h1 className="mt-4 text-3xl font-semibold text-white">Your ClaimClarity intake</h1>
        <p className="mt-4 text-slate-300">
          Complete consent before starting document upload.
        </p>
        <a className="mt-6 inline-block rounded-xl bg-sky-300 px-4 py-3 font-semibold text-slate-950" href="/app/consent">
          Review consent
        </a>
      </div>
    </main>
  )
}

