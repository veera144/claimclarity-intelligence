import type { ReactElement } from 'react'
import Link from 'next/link'
import { createServerClient } from '@claimclarity/db'

import { readDashboardActor } from '../lib/review/session'

import { NotificationBell, type NotificationBellItem } from './NotificationBell'
import { InternalBadge } from './internal-ui'

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
    <header className="sticky top-0 z-20 border-b border-navy-800 bg-navy-950/95 text-white backdrop-blur">
      <div className="internal-shell flex flex-col gap-4 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <Link className="text-lg font-semibold text-white no-underline" href="/">
            ClaimClarity Dashboard
          </Link>
          <p className="mt-1 text-sm text-navy-200">
            Internal review, operations, and pilot controls.
          </p>
        </div>
        <nav className="flex flex-wrap items-center gap-3 text-sm">
          {INTERNAL_LINKS.map((link) =>
            link.href === '/admin' && actor.role !== 'admin' ? null : (
              <Link
                className="rounded-full px-3 py-2 text-navy-100 no-underline transition hover:bg-navy-900 hover:text-white"
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            )
          )}
          <InternalBadge label={actor.role} tone="teal" />
          <NotificationBell actorId={actor.id} initialNotifications={notifications} />
        </nav>
      </div>
    </header>
  )
}
