import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@claimclarity/db'

import { readDashboardActor } from '../../../../../lib/review/session'
import { csvEscape } from '../../../../../lib/ops/redaction'

type AuditCsvRow = {
  created_at: string | null
  actor_role: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  ip_address: string | null
}

function csv(rows: AuditCsvRow[]): string {
  const header = ['created_at', 'actor_role', 'action', 'entity_type', 'entity_id', 'ip_address']
  const body = rows.map((row) =>
    [
      row.created_at,
      row.actor_role,
      row.action,
      row.entity_type,
      row.entity_id,
      row.ip_address,
    ]
      .map(csvEscape)
      .join(',')
  )
  return [header.join(','), ...body].join('\n')
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const actor = await readDashboardActor()
  if (actor?.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const supabase = await createServerClient()
  const params = request.nextUrl.searchParams
  let query = supabase
    .from('audit_log')
    .select('created_at, actor_role, action, entity_type, entity_id, ip_address')
    .order('created_at', { ascending: false })
    .limit(1000)

  const action = params.get('action')
  const entityType = params.get('entity_type')
  const entityId = params.get('entity_id')
  const from = params.get('from')
  const to = params.get('to')
  if (action) query = query.eq('action', action)
  if (entityType) query = query.eq('entity_type', entityType)
  if (entityId) query = query.eq('entity_id', entityId)
  if (from) query = query.gte('created_at', from)
  if (to) query = query.lte('created_at', to)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: 'Audit export failed' }, { status: 500 })

  return new NextResponse(csv(data as AuditCsvRow[]), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="claimclarity-audit.csv"',
    },
  })
}
