'use client'

import type { ReactElement } from 'react'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '@claimclarity/db/client.browser'

export type NotificationBellItem = {
  id: string
  notification_type: string
  case_id: string | null
  message: string
  read_at: string | null
  created_at: string | null
}

type NotificationBellProps = {
  actorId: string
  initialNotifications: NotificationBellItem[]
}

type RealtimeChannelLike = {
  on(
    event: string,
    config: Record<string, string>,
    callback: () => void
  ): RealtimeChannelLike
  subscribe(): RealtimeChannelLike
}

type NotificationClientLike = {
  channel(name: string): RealtimeChannelLike
  removeChannel(channel: RealtimeChannelLike): Promise<unknown>
  from(table: 'reviewer_notifications'): {
    select(columns: string): {
      eq(field: string, value: string): {
        order(field: string, options: { ascending: boolean }): {
          limit(count: number): Promise<{ data: NotificationBellItem[] | null; error: { message: string } | null }>
        }
      }
    }
    update(values: { read_at: string }): {
      eq(field: string, value: string): {
        is(field: string, value: null): Promise<{ error: { message: string } | null }>
      }
    }
  }
}

function relativeTime(value: string | null): string {
  if (!value) return 'Just now'
  const diffMinutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000))
  if (diffMinutes < 1) return 'Just now'
  if (diffMinutes < 60) return `${String(diffMinutes)}m ago`
  return `${String(Math.floor(diffMinutes / 60))}h ago`
}

function notificationHref(item: NotificationBellItem): string {
  return item.case_id ? `/cases/${item.case_id}` : '/queue'
}

function notificationTone(type: string): 'teal' | 'attention' | 'deducted' | 'navy' {
  if (type.includes('sla') || type.includes('manual')) return 'attention'
  if (type.includes('failed')) return 'deducted'
  if (type.includes('processing')) return 'navy'
  return 'teal'
}

function dotTone(type: ReturnType<typeof notificationTone>): string {
  if (type === 'attention') return 'bg-attention-500'
  if (type === 'deducted') return 'bg-deducted-500'
  if (type === 'navy') return 'bg-navy-500'
  return 'bg-teal-500'
}

export function NotificationBell({
  actorId,
  initialNotifications,
}: NotificationBellProps): ReactElement {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState(initialNotifications)
  const [, startTransition] = useTransition()
  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.read_at).length,
    [notifications]
  )

  useEffect(() => {
    const supabase = createBrowserClient() as unknown as NotificationClientLike

    async function refreshNotifications(): Promise<void> {
      const { data } = await supabase
        .from('reviewer_notifications')
        .select('id, notification_type, case_id, message, read_at, created_at')
        .eq('recipient_id', actorId)
        .order('created_at', { ascending: false })
        .limit(10)
      setNotifications(data ?? [])
    }

    const channel = supabase
      .channel(`module10-notifications-${actorId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'reviewer_notifications',
          filter: `recipient_id=eq.${actorId}`,
        },
        () => {
          void refreshNotifications()
        }
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [actorId])

  function markAllRead(): void {
    startTransition(() => {
      const readAt = new Date().toISOString()
      setNotifications((items) => items.map((item) => ({ ...item, read_at: item.read_at ?? readAt })))
      const supabase = createBrowserClient() as unknown as NotificationClientLike
      void supabase
        .from('reviewer_notifications')
        .update({ read_at: readAt })
        .eq('recipient_id', actorId)
        .is('read_at', null)
    })
  }

  return (
    <div className="relative">
      <button
        aria-expanded={open}
        aria-label="Reviewer notifications"
        className="relative rounded-full border border-navy-700 bg-navy-900 px-3 py-2 text-sm text-white"
        onClick={() => {
          setOpen((current) => !current)
        }}
        type="button"
      >
        Alerts
        {unreadCount > 0 ? (
          <span className="ml-2 rounded-full bg-teal-200 px-2 py-0.5 text-xs font-semibold text-teal-950">
            {unreadCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-3xl border border-slate-200 bg-white p-3 shadow-2xl shadow-slate-300/70">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-navy-950">Notifications</p>
            <button className="rounded-full px-2 py-1 text-xs text-teal-700" onClick={markAllRead} type="button">
              Mark all read
            </button>
          </div>
          <div className="mt-3 max-h-80 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="py-6 text-sm text-slate-500">No notifications.</p>
            ) : null}
            {notifications.map((notification) => (
              <button
                className="block w-full rounded-2xl border border-transparent px-3 py-3 text-left transition hover:border-slate-200 hover:bg-slate-50"
                key={notification.id}
                onClick={() => {
                  setOpen(false)
                  router.push(notificationHref(notification))
                }}
                type="button"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 text-sm font-medium text-navy-950">
                    <span className={`h-2.5 w-2.5 rounded-full ${dotTone(notificationTone(notification.notification_type))}`} />
                    {notification.notification_type}
                  </span>
                  <span className="text-xs text-slate-500">{relativeTime(notification.created_at)}</span>
                </span>
                <span className="mt-1 block text-sm leading-6 text-slate-600">{notification.message}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
