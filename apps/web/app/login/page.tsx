import type { ReactElement } from 'react'

export default function LoginPage(): ReactElement {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900/80 p-8">
        <p className="text-sm uppercase tracking-[0.3em] text-sky-300">Patient Login</p>
        <h1 className="mt-4 text-3xl font-semibold text-white">Sign in will be added in Module 1.</h1>
        <p className="mt-4 text-sm text-slate-300">
          This route exists now so Module 0 middleware can redirect unauthenticated users safely.
        </p>
      </div>
    </main>
  )
}
