import type { ReactElement } from 'react'

export default function DashboardLoginPage(): ReactElement {
  return (
    <main className="flex min-h-screen items-center justify-center bg-stone-950 px-6">
      <div className="w-full max-w-md rounded-3xl border border-stone-800 bg-stone-900/80 p-8">
        <p className="text-sm uppercase tracking-[0.3em] text-emerald-300">Dashboard Login</p>
        <h1 className="mt-4 text-3xl font-semibold text-white">
          Internal authentication lands in Module 1.
        </h1>
        <p className="mt-4 text-sm text-stone-300">
          This route exists so Module 0 access control can redirect unauthenticated staff safely.
        </p>
      </div>
    </main>
  )
}
