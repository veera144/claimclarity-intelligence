import type { ReactElement } from 'react'
import Link from 'next/link'
import { createServerClient } from '@claimclarity/db'

import { readDashboardActor } from '../lib/review/session'

import { NotificationBell, type NotificationBellItem } from './NotificationBell'

const INTERNAL_LINKS = [
  { href: '/queue', label: 'Queue' },
  { href: '/escalations', label: 'Escalations' },
  { href: '/admin', label: 'Ops' },
] as const

export async function DashboardHeader(): Promise<ReactElement | null> {
  const actor = await readDashboardActor()
  if (!actor) return null

  const supabase = await createServerClient()
  const { data, error } = await supabase
    .from('reviewer_notifications')
    .select('id, notification_type, case_id, message, read_at, created_at')
    .eq('recipient_id', actor.id)
    .order('created_at', { ascending: false })
    .limit(10)

  if (error) throw new Error(error.message)
  const notifications = data as NotificationBellItem[]

  return (
    <header className="sticky top-0 z-10 border-b border-neutral-800 bg-neutral-950/95 px-6 py-3 text-neutral-100">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        <Link className="text-sm font-semibold text-emerald-200 no-underline" href="/">
          ClaimClarity
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {INTERNAL_LINKS.map((link) =>
            link.href === '/admin' && actor.role !== 'admin' ? null : (
              <Link className="text-neutral-300 no-underline hover:text-white" href={link.href} key={link.href}>
                {link.label}
              </Link>
            )
          )}
          <span className="rounded bg-neutral-900 px-2 py-1 text-xs uppercase text-neutral-300">{actor.role}</span>
          <NotificationBell actorId={actor.id} initialNotifications={notifications} />
        </nav>
      </div>
    </header>
  )
}
